import { DomainError } from '../domain/domain-error.js';
import { Money } from '../domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { InboxMessage } from '../domain/inbox-message.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { WagerTransactionFailed } from '../domain/events/wager-transaction-failed.js';
import { payloadHash } from './canonical-payload.js';
import { resolveIdempotency } from './idempotency.js';
import type { FinancialUnitOfWork } from './ports/financial-unit-of-work.js';
import type { Telemetry } from './ports/telemetry.js';
import type { WagerInput, InboxInput } from './process-wager.js';
import type { EventContext } from '../domain/events/integration-event.js';
import type { SubmissionResult } from './transaction-result.js';

// Auditoria de falha permanente em uma transação nova, depois do rollback financeiro.
// Se o banco também impedir esta gravação, o consumidor não deve confirmar a mensagem.
export class FailWager {
  constructor(
    private readonly uow: FinancialUnitOfWork,
    private readonly telemetry: Telemetry,
  ) {}

  async execute(
    input: WagerInput,
    key: string,
    context: EventContext,
    transport: InboxInput,
  ): Promise<SubmissionResult> {
    const hash = payloadHash(input);
    const result = await this.uow.run(input.walletId, async (session) => {
      const inbox = await session.inbox(transport.messageId, transport.consumerName);

      if (inbox && !inbox.matchesPayload(transport.payloadHash)) {
        throw new DomainError('INBOX_CONFLICT', 'Conteúdo de mensagem divergente.');
      }

      const replay = await resolveIdempotency(
        session,
        key,
        hash,
        input.providerId,
        input.externalTransactionId,
      );
      const previous = await session.transactionByKey(key);
      let result = replay;

      // Uma falha tardia do transporte não pode substituir um resultado terminal já válido.
      if (!previous?.transaction.isTerminal()) {
        const tx =
          previous?.transaction ??
          WagerTransaction.create({
            ...input,
            id: crypto.randomUUID(),
            money: Money.from(input.money),
            idempotencyKey: key,
            payloadHash: hash,
          });
        tx.fail('INFRASTRUCTURE_PERMANENT_FAILURE');
        result = {
          statusCode: 503,
          body: {
            transactionId: tx.id,
            status: tx.status,
            balance: session.wallet!.balance.toJSON(),
            failureCode: tx.failureCode!,
            idempotentReplay: false,
          },
        };
        await session.saveTransaction(tx, result);
        await session.appendOutbox([
          OutboxMessage.enqueue(WagerTransactionFailed.from(tx, session.wallet!, context)),
        ]);
      }
      if (!inbox) {
        const received = InboxMessage.receive({ ...transport, receivedAt: new Date() });
        received.markProcessed(new Date());
        await session.saveInbox(received);
      }

      return result!;
    });

    if (!result.body.idempotentReplay) {
      this.telemetry.count('transactions_total', { status: result.body.status });
    }

    this.telemetry.log('error', 'wager_failure_audited', {
      correlationId: context.correlationId,
      messageId: transport.messageId,
      transactionId: result.body.transactionId,
      walletId: input.walletId,
      providerId: input.providerId,
      code: result.body.status,
    });

    return result;
  }
}

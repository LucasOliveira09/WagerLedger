import { Money } from '../domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { InboxMessage } from '../domain/inbox-message.js';
import { DomainError } from '../domain/domain-error.js';
import { payloadHash } from './canonical-payload.js';
import { resolveIdempotency } from './idempotency.js';
import type { MoneyProps } from '../domain/money.js';
import type { WagerKind } from '../domain/wager-transaction.js';
import { applyWager } from './apply-wager.js';
import type { EventContext } from '../domain/events/integration-event.js';
import type { FinancialUnitOfWork } from './ports/financial-unit-of-work.js';
import type { SubmissionResult } from './transaction-result.js';
import { nullTelemetry } from './ports/telemetry.js';
import type { Telemetry } from './ports/telemetry.js';
import { FailWager } from './fail-wager.js';

export interface WagerInput {
  providerId: string; externalTransactionId: string; walletId: string; playerId: string;
  roundId: string; gameId: string; kind: Exclude<WagerKind, 'OPENING'>; money: MoneyProps;
  referenceExternalTransactionId?: string;
}
export interface InboxInput { messageId: string; consumerName: string; payloadHash: string }
export class ProcessWager {
  constructor(private readonly uow: FinancialUnitOfWork, private readonly telemetry: Telemetry = nullTelemetry) {}
  recordFailure(input: WagerInput, key: string, context: EventContext, transport: InboxInput): Promise<SubmissionResult> {
    return new FailWager(this.uow, this.telemetry).execute(input, key, context, transport);
  }
  async execute(input: WagerInput, key: string, context: EventContext, transport?: InboxInput): Promise<SubmissionResult> {
    const money = Money.from(input.money); const hash = payloadHash(input);
    const started = performance.now();
    try {
    const result = await this.uow.run(input.walletId, async session => {
      const inbox = transport ? await session.inbox(transport.messageId, transport.consumerName) : undefined;
      if (inbox && (!inbox.matchesPayload(transport!.payloadHash) || !inbox.isProcessed())) throw new DomainError('INBOX_CONFLICT', 'Identidade de mensagem reutilizada com conteúdo ou estado divergente.');
      const replay = await resolveIdempotency(session, key, hash, input.providerId, input.externalTransactionId);
      if (inbox && !replay) throw new DomainError('INBOX_CONFLICT', 'Mensagem confirmada sem operação correspondente.');
      const result = replay ?? await applyWager(session, WagerTransaction.create({ ...input, id: crypto.randomUUID(), money, idempotencyKey: key, payloadHash: hash }), context);
      if (transport && !inbox) {
        const received = InboxMessage.receive({ ...transport, receivedAt: new Date() });
        received.markProcessed(new Date()); await session.saveInbox(received);
      }
      const currentStatus = replay ? (await session.transactionByKey(key))!.transaction.status : result.body.status;
      return { ...result, currentStatus };
    });
    this.telemetry.count(result.body.idempotentReplay ? 'duplicates_total' : 'transactions_total', result.body.idempotentReplay ? { source: transport ? 'sqs' : 'http' } : { status: result.body.status });
    this.telemetry.log('info', result.body.idempotentReplay ? 'wager_replayed' : 'wager_committed', { correlationId: context.correlationId, ...(transport ? { messageId: transport.messageId } : {}), transactionId: result.body.transactionId, walletId: input.walletId, providerId: input.providerId });
    return result;
    } finally { this.telemetry.observe('processing_seconds', (performance.now() - started) / 1000, { source: transport ? 'sqs' : 'http' }); }
  }
}

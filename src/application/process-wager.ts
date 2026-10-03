import { DomainError } from '../domain/domain-error.js';
import { Money } from '../domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { payloadHash } from './canonical-payload.js';
import { resolveIdempotency } from './idempotency.js';
import type { MoneyProps } from '../domain/money.js';
import type { WagerKind } from '../domain/wager-transaction.js';
import { applyWager } from './apply-wager.js';
import type { EventContext } from '../domain/events/integration-event.js';
import type { FinancialUnitOfWork } from './ports/financial-unit-of-work.js';
import type { SubmissionResult } from './transaction-result.js';

export interface WagerInput {
  providerId: string; externalTransactionId: string; walletId: string; playerId: string;
  roundId: string; gameId: string; kind: Exclude<WagerKind, 'OPENING'>; money: MoneyProps;
  referenceExternalTransactionId?: string;
}
export class ProcessWager {
  constructor(private readonly uow: FinancialUnitOfWork) {}
  async execute(input: WagerInput, key: string, context: EventContext): Promise<SubmissionResult> {
    if (input.kind === 'REFUND' || input.kind === 'ROLLBACK') throw new DomainError('UNSUPPORTED_OPERATION', 'Operação ainda indisponível.');
    const money = Money.from(input.money); const hash = payloadHash(input);
    return this.uow.run(input.walletId, async session => {
      const replay = await resolveIdempotency(session, key, hash, input.providerId, input.externalTransactionId);
      if (replay) return replay;
      const tx = WagerTransaction.create({ ...input, id: crypto.randomUUID(), money, idempotencyKey: key, payloadHash: hash });
      return applyWager(session, tx, context);
    });
  }
}

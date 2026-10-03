import { applyWager } from './apply-wager.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { WagerTransactionRejected } from '../domain/events/wager-transaction-rejected.js';
import { referenceFailure } from '../domain/reference-rules.js';
import type { FinancialUnitOfWork } from './ports/financial-unit-of-work.js';
import { nullTelemetry } from './ports/telemetry.js';
import type { Telemetry } from './ports/telemetry.js';

export interface ReferenceRetryPolicy {
  maxAttempts: number;
  ttlMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultReferencePolicy: Readonly<ReferenceRetryPolicy> = Object.freeze({
  maxAttempts: 20,
  ttlMs: 86400000,
  baseDelayMs: 1000,
  maxDelayMs: 300000,
});

export class RetryPendingReference {
  private readonly policy: Readonly<ReferenceRetryPolicy>;

  constructor(
    private readonly uow: FinancialUnitOfWork,
    policy = defaultReferencePolicy,
    private readonly telemetry: Telemetry = nullTelemetry,
  ) {
    if (Object.values(policy).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      throw new RangeError('Política de retry inválida.');
    }

    this.policy = Object.freeze({ ...policy });
  }

  async execute(transactionId: string, walletId: string, now = new Date()): Promise<boolean> {
    const outcome = await this.uow.run(walletId, async (session) => {
      // A busca do worker é apenas uma lista de candidatos. Sob o lock da carteira,
      // revalidamos estado e prazo para dois workers não resolverem a mesma pendência.
      const stored = await session.transactionById(transactionId);

      if (
        !stored ||
        stored.transaction.walletId !== walletId ||
        stored.transaction.status !== 'PENDING_REFERENCE' ||
        (stored.nextAttemptAt && stored.nextAttemptAt > now)
      ) {
        return undefined;
      }

      const tx = stored.transaction;
      const attempts = (stored.referenceAttempts ?? 0) + 1;
      const expired = now.getTime() - tx.createdAt.getTime() >= this.policy.ttlMs;
      const reference = await session.transactionByExternal(
        tx.providerId,
        tx.referenceExternalTransactionId!,
      );
      const context = { correlationId: `reference:${tx.id}`, causationId: tx.id };
      const incompatible =
        reference && referenceFailure(tx, reference.transaction) === 'REFERENCE_MISMATCH';

      if (!expired && (reference?.transaction.isTerminal() || incompatible)) {
        // Limpa a agenda antes da mudança terminal: o banco proíbe alterar a linha depois.
        await session.scheduleReference(tx.id, attempts, undefined);
        await applyWager(session, tx, context);
      } else if (expired || attempts >= this.policy.maxAttempts) {
        // A espera é limitada; a rejeição e seu evento são confirmados juntos, sem ledger.
        tx.reject('REFERENCE_NOT_FOUND', now);
        await session.scheduleReference(tx.id, attempts, undefined);
        await session.saveTransaction(tx);
        await session.appendOutbox([
          OutboxMessage.enqueue(WagerTransactionRejected.from(tx, session.wallet!, context)),
        ]);
      } else {
        const delay = Math.min(
          this.policy.maxDelayMs,
          this.policy.baseDelayMs * 2 ** Math.min(attempts - 1, 30),
        );
        await session.scheduleReference(tx.id, attempts, new Date(now.getTime() + delay));
      }

      return { status: tx.status, providerId: tx.providerId };
    });

    if (!outcome) {
      return false;
    }

    this.telemetry.count('reference_retries_total');

    if (outcome.status !== 'PENDING_REFERENCE') {
      this.telemetry.count('transactions_total', { status: outcome.status });
    }

    this.telemetry.log('info', 'reference_attempt_committed', {
      correlationId: `reference:${transactionId}`,
      transactionId,
      walletId,
      providerId: outcome.providerId,
      code: outcome.status,
    });

    return true;
  }
}

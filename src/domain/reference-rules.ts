import type { WagerTransaction } from './wager-transaction.js';
import type { FailureCode } from './failure-code.js';

export function referenceFailure(tx: WagerTransaction, reference: WagerTransaction): FailureCode | undefined {
  if (tx.providerId !== reference.providerId || tx.playerId !== reference.playerId || tx.walletId !== reference.walletId || tx.money.currency !== reference.money.currency || tx.roundId !== reference.roundId) return 'REFERENCE_MISMATCH';
  if (reference.status !== 'PROCESSED') return 'REFERENCE_NOT_PROCESSED';
  const allowed = tx.kind === 'ROLLBACK' ? ['BET', 'WIN', 'REFUND'] : ['BET'];
  if (!allowed.includes(reference.kind)) return 'REFERENCE_KIND_INVALID';
  if (tx.requiresReference() && !tx.money.equals(reference.money)) return 'AMOUNT_MISMATCH';
  return undefined;
}

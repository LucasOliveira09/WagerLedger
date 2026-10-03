import { expect, test } from 'bun:test';
import { WagerTransaction } from '../../src/domain/wager-transaction.js';
import { Money } from '../../src/domain/money.js';
import { referenceFailure } from '../../src/domain/reference-rules.js';

function transaction(kind: 'BET' | 'WIN' | 'REFUND' | 'ROLLBACK', amount = '10.00') {
  return WagerTransaction.create({ id: crypto.randomUUID(), providerId: 'p', externalTransactionId: crypto.randomUUID(), walletId: 'w', playerId: 'player', roundId: 'round', gameId: 'game', kind, money: Money.from({ amount, currency: 'BRL' }), idempotencyKey: 'key', payloadHash: 'hash', referenceExternalTransactionId: 'bet' });
}
test('WIN referencia BET processada; reversões exigem tipo e valor corretos', () => {
  const bet = transaction('BET'); bet.markProcessed(undefined, new Date());
  expect(referenceFailure(transaction('WIN', '50.00'), bet)).toBeUndefined();
  expect(referenceFailure(transaction('REFUND'), bet)).toBeUndefined();
  expect(referenceFailure(transaction('REFUND', '5.00'), bet)).toBe('AMOUNT_MISMATCH');
  const win = transaction('WIN'); win.markProcessed(undefined, new Date());
  expect(referenceFailure(transaction('REFUND'), win)).toBe('REFERENCE_KIND_INVALID');
  expect(referenceFailure(transaction('ROLLBACK'), win)).toBeUndefined();
  expect(referenceFailure(transaction('WIN'), transaction('BET'))).toBe('REFERENCE_NOT_PROCESSED');
  const foreign = WagerTransaction.rehydrate({ ...transaction('BET'), id: 'foreign', providerId: 'other', externalTransactionId: 'bet', walletId: 'w', playerId: 'player', roundId: 'round', gameId: 'game', kind: 'BET', money: bet.money, idempotencyKey: 'other', payloadHash: 'hash', status: 'PROCESSED' });
  expect(referenceFailure(transaction('WIN'), foreign)).toBe('REFERENCE_MISMATCH');
});

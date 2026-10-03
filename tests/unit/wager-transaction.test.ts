import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money.js';
import { WagerTransaction } from '../../src/domain/wager-transaction.js';

const props = { id: 'transaction', providerId: 'provider', externalTransactionId: 'external', idempotencyKey: 'key', payloadHash: 'hash', walletId: 'wallet', playerId: 'player', roundId: 'round', gameId: 'game', kind: 'BET' as const, money: Money.from({ amount: '25.00', currency: 'BRL' }) };
test('transação nasce pendente e estado terminal não muda', () => {
  const tx = WagerTransaction.create(props);
  expect(tx.status).toBe('PENDING');
  expect(tx.matchesPayload('hash')).toBe(true);
  expect(tx.matchesPayload('other')).toBe(false);
  tx.markProcessed(undefined, new Date());
  expect(tx.status).toBe('PROCESSED');
  expect(() => tx.reject('INSUFFICIENT_FUNDS')).toThrow();
  expect(() => tx.markPendingReference()).toThrow();
});
test('reversões exigem referência e LOSS não movimenta saldo', () => {
  expect(() => WagerTransaction.create({ ...props, kind: 'REFUND' })).toThrow();
  expect(() => WagerTransaction.create({ ...props, kind: 'ROLLBACK' })).toThrow();
  const loss = WagerTransaction.create({ ...props, kind: 'LOSS', money: Money.zero('BRL') });
  expect(loss.affectsBalance()).toBe(false);
  expect(() => WagerTransaction.create({ ...props, money: Money.zero('BRL') })).toThrow();
});
test('referência pendente pode ser resolvida e mantém identidade', () => {
  const tx = WagerTransaction.create({ ...props, kind: 'REFUND', referenceExternalTransactionId: 'bet' });
  tx.markPendingReference();
  tx.markProcessed('original-id', new Date());
  expect(tx.referenceTransactionId).toBe('original-id');
  expect(tx.isTerminal()).toBe(true);
});

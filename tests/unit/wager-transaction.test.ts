import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money.js';
import { WagerTransaction } from '../../src/domain/wager-transaction.js';

const props = {
  id: 'transaction',
  providerId: 'provider',
  externalTransactionId: 'external',
  idempotencyKey: 'key',
  payloadHash: 'hash',
  walletId: 'wallet',
  playerId: 'player',
  roundId: 'round',
  gameId: 'game',
  kind: 'BET' as const,
  money: Money.from({ amount: '25.00', currency: 'BRL' }),
};

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
  const tx = WagerTransaction.create({
    ...props,
    kind: 'REFUND',
    referenceExternalTransactionId: 'bet',
  });
  tx.markPendingReference();
  tx.markProcessed('original-id', new Date());
  expect(tx.referenceTransactionId).toBe('original-id');
  expect(tx.isTerminal()).toBe(true);
});

test('identidade de provedor é validada no domínio e OPENING reserva identidade interna', () => {
  const input = {
    id: 'id',
    providerId: 'p',
    externalTransactionId: 'e',
    idempotencyKey: 'k',
    payloadHash: 'h',
    walletId: 'w',
    playerId: 'player',
    roundId: 'r',
    gameId: 'g',
    kind: 'BET' as const,
    money: Money.from({ amount: '1.00', currency: 'BRL' }),
  };

  for (const providerId of ['', '__internal__', 'x'.repeat(101), 'bad\nprovider']) {
    expect(() => WagerTransaction.create({ ...input, providerId })).toThrow();
  }

  expect(() => WagerTransaction.create({ ...input, kind: 'OPENING' })).toThrow();
  expect(() =>
    WagerTransaction.create({ ...input, kind: 'OPENING', providerId: '__internal__' }),
  ).not.toThrow();
});

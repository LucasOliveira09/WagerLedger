import { expect, test } from 'bun:test';
import { payloadHash } from '../../src/application/canonical-payload.js';
test('hash canônico ignora ordem de chaves e preserva diferenças de negócio', () => {
  const first = { walletId: 'wallet', money: { amount: '25.00', currency: 'BRL' }, kind: 'BET' };
  const second = { kind: 'BET', money: { currency: 'BRL', amount: '25.00' }, walletId: 'wallet' };
  expect(payloadHash(first)).toBe(payloadHash(second));
  expect(payloadHash(first)).not.toBe(payloadHash({ ...first, money: { amount: '26.00', currency: 'BRL' } }));
  expect(payloadHash(first)).toHaveLength(64);
});

import { expect, test } from 'bun:test';
import { Wallet } from '../../src/domain/wallet.js';
import { Money } from '../../src/domain/money.js';

const money = (amount: string, currency = 'BRL') => Money.from({ amount, currency });

test('wallet mantém saldo e ledger, incrementando version apenas quando muda', () => {
  const wallet = Wallet.open({ id: 'wallet', playerId: 'player', initialBalance: money('100.00') });
  expect(wallet.version).toBe(1);
  const entry = wallet.debit(money('80.00'), { id: 'entry', transactionId: 'bet' });
  expect(wallet.balance.toString()).toBe('20.00');
  expect(wallet.version).toBe(2);
  expect(entry.direction).toBe('DEBIT');
  expect(entry.balanceBefore.toString()).toBe('100.00');
  expect(entry.balanceAfter.toString()).toBe('20.00');
  expect(entry.isBalanced()).toBe(true);
  expect(() => wallet.debit(money('80.00'), { id: 'other', transactionId: 'other' })).toThrow();
  expect(wallet.balance.toString()).toBe('20.00');
  expect(wallet.version).toBe(2);
});

test('wallet rejeita moeda divergente e movimentação zero', () => {
  const wallet = Wallet.open({ id: 'wallet', playerId: 'player', initialBalance: money('0.00') });
  expect(() =>
    wallet.credit(money('1.00', 'USD'), { id: 'entry', transactionId: 'win' }),
  ).toThrow();
  expect(() => wallet.credit(money('0.00'), { id: 'entry', transactionId: 'win' })).toThrow();
  wallet.credit(money('25.00'), { id: 'entry', transactionId: 'win' });
  expect(wallet.balance.toString()).toBe('25.00');
});

import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money.js';
import { WalletLedgerEntry } from '../../src/domain/wallet-ledger-entry.js';
const money = (amount: string) => Money.from({ amount, currency: 'BRL' });
test('ledger valida aritmética e é estruturalmente imutável', () => {
  const props = { id: 'entry', walletId: 'wallet', transactionId: 'bet', direction: 'DEBIT' as const, money: money('25.00'), balanceBefore: money('100.00'), balanceAfter: money('75.00'), sequence: 2, createdAt: new Date() };
  const entry = WalletLedgerEntry.create(props);
  expect(Object.isFrozen(entry)).toBe(true);
  expect(() => WalletLedgerEntry.create({ ...props, balanceAfter: money('74.00') })).toThrow();
  const observed = entry.createdAt;
  observed.setFullYear(2000);
  expect(entry.createdAt.getFullYear()).not.toBe(2000);
});

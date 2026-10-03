import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { Wallet } from '../../src/domain/wallet.js';
import { Money } from '../../src/domain/money.js';

test('unidade de trabalho usa contexto isolado e desfaz escrita antes de falha', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);
  const wallet = Wallet.open({ id: crypto.randomUUID(), playerId: crypto.randomUUID(), initialBalance: Money.zero('BRL') });
  try {
    await uow.run(undefined, session => session.addWallet(wallet));
    await expect(uow.run(wallet.id, async session => {
      session.wallet!.credit(Money.from({ amount: '1.00', currency: 'BRL' }), { id: crypto.randomUUID(), transactionId: crypto.randomUUID() });
      await session.saveWallet(session.wallet!);
      throw new Error('injected failure after wallet write');
    })).rejects.toThrow('injected failure');
    const wallets = await Promise.all([uow.run(wallet.id, async session => session.wallet!), uow.run(wallet.id, async session => session.wallet!)]);
    expect(wallets[0]).not.toBe(wallets[1]);
    expect(wallets[0]!.balance.toString()).toBe('0.00');
    expect(wallets[0]!.version).toBe(1);
  } finally { await db.close(); }
}, 30000);

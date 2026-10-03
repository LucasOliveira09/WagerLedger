import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { WalletRecord, rehydrateWallet } from '../../src/infrastructure/persistence/wallet-mapping.js';

test('schema protege saldo, unicidade, ledger imutável e suporta migration down/up', async () => {
  const database = await createTestDatabase();
  const em = database.orm.em.fork();
  const walletId = crypto.randomUUID();
  const playerId = crypto.randomUUID();
  try {
    await em.execute('insert into wallets (id,player_id,currency,balance) values (?,?,?,?)', [walletId, playerId, 'BRL', '0.00']);
    await expect(em.execute('insert into wallets (id,player_id,currency,balance) values (?,?,?,?)', [crypto.randomUUID(), playerId, 'BRL', '0.00'])).rejects.toThrow();
    await expect(em.execute('update wallets set balance = ? where id = ?', ['-1.00', walletId])).rejects.toThrow();
    await expect(em.execute('update wallets set balance = ? where id = ?', ['1.00', walletId])).rejects.toThrow();
    const entryId = crypto.randomUUID();
    await em.transactional(async tx => {
      await tx.execute('update wallets set balance = ?, version = 2 where id = ?', ['100.00', walletId]);
      await tx.execute('insert into wallet_ledger (id,wallet_id,transaction_id,currency,direction,amount,balance_before,balance_after,sequence) values (?,?,?,?,?,?,?,?,?)', [entryId, walletId, crypto.randomUUID(), 'BRL', 'CREDIT', '100.00', '0.00', '100.00', 2]);
    });
    await expect(em.execute('update wallet_ledger set amount = ? where id = ?', ['99.00', entryId])).rejects.toThrow();
    await expect(em.execute('delete from wallet_ledger where id = ?', [entryId])).rejects.toThrow();
    const record = await em.findOneOrFail(WalletRecord, { id: walletId });
    expect(typeof record.balance).toBe('string');
    expect(rehydrateWallet(record).balance.toString()).toBe('100.00');
    await database.orm.migrator.down({ to: 0 });
    await expect(em.execute('select * from wallets')).rejects.toThrow();
    await database.orm.migrator.up();
    expect(await em.execute('select * from wallets')).toEqual([]);
  } finally { await database.close(); }
}, 30000);

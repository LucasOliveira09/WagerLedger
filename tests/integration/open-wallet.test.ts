import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('abertura positiva gera transação ledger e outbox no mesmo commit', async () => {
  const db = await createTestDatabase();
  const open = new OpenWallet(new MikroFinancialUnitOfWork(db.orm));
  try {
    const wallet = await open.execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, { correlationId: 'test' });
    expect(wallet.version).toBe(1);
    expect(wallet.balance.amount).toBe('100.00');
    const em = db.orm.em.fork();
    const counts = await em.execute<{ ledger: string; events: string }[]>("select (select count(*) from wallet_ledger where wallet_id = ?) as ledger, (select count(*) from outbox_messages where aggregate_id = ?) as events", [wallet.id, wallet.id]);
    expect(counts[0]!.ledger).toBe('1'); expect(counts[0]!.events).toBe('2');
    await expect(open.execute({ playerId: wallet.playerId, initialBalance: { amount: '0.00', currency: 'BRL' } }, { correlationId: 'test' })).rejects.toThrow();
    const zero = await open.execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '0.00', currency: 'BRL' } }, { correlationId: 'test' });
    expect((await em.execute('select * from wallet_ledger where wallet_id = ?', [zero.id]))).toHaveLength(0);
  } finally { await db.close(); }
}, 30000);

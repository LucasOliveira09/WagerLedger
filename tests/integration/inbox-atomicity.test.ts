import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import type { FinancialUnitOfWork } from '../../src/application/ports/financial-unit-of-work.js';

test('inbox e pacote financeiro revertem juntos e IDs de mensagem distintos não duplicam efeito', async () => {
  const db = await createTestDatabase(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'inbox' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const input = { providerId: 'p', walletId: wallet.id, playerId: wallet.playerId, externalTransactionId: 'bet', roundId: 'r', gameId: 'g', kind: 'BET' as const, money: { amount: '20.00', currency: 'BRL' } };
    const transport = { messageId: 'm1', consumerName: 'wagers', payloadHash: 'envelope-hash' };
    const faulty: FinancialUnitOfWork = { run: (id, callback) => uow.run(id, session => callback(new Proxy(session, { get(target, property) {
      if (property === 'saveInbox') return async (...args: Parameters<typeof session.saveInbox>) => { await target.saveInbox(...args); throw new Error('Falha após inbox e efeitos SQL.'); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } }))) };
    await expect(new ProcessWager(faulty).execute(input, 'bet', context, transport)).rejects.toThrow();
    const em = db.orm.em.fork();
    expect((await em.execute<{ balance: string }[]>('select balance from wallets where id=?', [wallet.id]))[0]!.balance).toBe('100.00');
    expect(await em.execute('select * from inbox_messages')).toHaveLength(0);
    expect(await em.execute('select id from wallet_ledger where wallet_id=?', [wallet.id])).toHaveLength(1);
    expect(await em.execute('select id from outbox_messages')).toHaveLength(2);
    const process = new ProcessWager(uow);
    const first = await process.execute(input, 'bet', context, transport);
    expect((await process.execute(input, 'bet', context, transport)).body.idempotentReplay).toBe(true);
    expect((await process.execute(input, 'bet', context, { ...transport, messageId: 'm2' })).body.transactionId).toBe(first.body.transactionId);
    expect(await em.execute('select * from inbox_messages')).toHaveLength(2);
    await expect(process.execute(input, 'bet', context, { ...transport, payloadHash: 'different' })).rejects.toThrow();
    expect(await em.execute('select id from wallet_ledger where wallet_id=?', [wallet.id])).toHaveLength(2);
  } finally { await db.close(); }
}, 30000);

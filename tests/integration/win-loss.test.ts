import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('WIN credita e LOSS registra sem ledger/version; referência e moeda inválidas rejeitam', async () => {
  const db = await createTestDatabase(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'win-loss' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const process = new ProcessWager(uow);
    const input = { providerId: 'p', externalTransactionId: 'bet', walletId: wallet.id, playerId: wallet.playerId, roundId: 'round', gameId: 'game', kind: 'BET' as const, money: { amount: '10.00', currency: 'BRL' } };
    await process.execute(input, 'bet', context);
    const win = await process.execute({ ...input, kind: 'WIN', externalTransactionId: 'win', money: { amount: '30.00', currency: 'BRL' }, referenceExternalTransactionId: 'bet' }, 'win', context);
    expect(win.body.balance.amount).toBe('120.00');
    const loss = await process.execute({ ...input, kind: 'LOSS', externalTransactionId: 'loss', money: { amount: '0.00', currency: 'BRL' } }, 'loss', context);
    expect(loss.body.status).toBe('PROCESSED'); expect(loss.body.balance.amount).toBe('120.00');
    const em = db.orm.em.fork();
    expect(await em.execute('select id from wallet_ledger where transaction_id = ?', [loss.body.transactionId])).toHaveLength(0);
    expect((await em.execute<{ version: number }[]>('select version from wallets where id = ?', [wallet.id]))[0]!.version).toBe(3);
    expect(await em.execute("select id from outbox_messages where payload->'data'->>'transactionId' = ?", [loss.body.transactionId])).toHaveLength(1);
    const invalid = await process.execute({ ...input, kind: 'WIN', externalTransactionId: 'invalid', roundId: 'other-round', referenceExternalTransactionId: 'bet' }, 'invalid', context);
    expect(invalid.body.failureCode).toBe('REFERENCE_MISMATCH');
    const currency = await process.execute({ ...input, kind: 'WIN', externalTransactionId: 'currency', money: { amount: '10.00', currency: 'USD' } }, 'currency', context);
    expect(currency.body.failureCode).toBe('CURRENCY_MISMATCH');
  } finally { await db.close(); }
}, 30000);

import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { FinancialQueries } from '../../src/application/financial-queries.js';
import { MikroFinancialReadStore } from '../../src/infrastructure/persistence/mikro-financial-read-store.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('consultas e cursor preservam histórico sob inserções e rejeitam cursor de outra carteira', async () => {
  const db = await createTestDatabase(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'queries' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const process = new ProcessWager(uow); const queries = new FinancialQueries(new MikroFinancialReadStore(db.orm));
    const base = { providerId: 'p', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind: 'BET' as const, money: { amount: '10.00', currency: 'BRL' } };
    const bet = await process.execute({ ...base, externalTransactionId: 'bet' }, 'bet', context);
    expect((await queries.wallet(wallet.id)).balance.amount).toBe('90.00');
    expect((await queries.transaction(bet.body.transactionId)).status).toBe('PROCESSED');
    expect((await queries.external('p', 'bet')).id).toBe(bet.body.transactionId);
    const first = await queries.ledger(wallet.id, 1);
    expect(first.entries).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
    await process.execute({ ...base, externalTransactionId: 'new' }, 'new', context);
    const next = await queries.ledger(wallet.id, 1, first.nextCursor!);
    expect(next.entries).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(next.entries[0]!.transactionId).toBe(bet.body.transactionId);
    const other = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '0.00', currency: 'BRL' } }, context);
    await expect(queries.ledger(other.id, 1, first.nextCursor!)).rejects.toThrow();
    await expect(queries.ledger(wallet.id, 101)).rejects.toThrow();
    await expect(queries.transaction(crypto.randomUUID())).rejects.toThrow();
  } finally { await db.close(); }
}, 30000);

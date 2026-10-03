import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { RetryPendingReference } from '../../src/application/retry-pending-reference.js';
import { ReferenceWorker } from '../../src/interfaces/workers/reference-worker.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('workers concorrentes resolvem uma vez, preservam replay e expiram com backoff', async () => {
  const db = await createTestDatabase(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'references' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const process = new ProcessWager(uow); const retry = new RetryPendingReference(uow, { maxAttempts: 2, ttlMs: 86400000, baseDelayMs: 1000, maxDelayMs: 60000 });
    const worker = new ReferenceWorker(db.orm, retry);
    const base = { providerId: 'p', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', money: { amount: '20.00', currency: 'BRL' } };
    const refund = { ...base, kind: 'REFUND' as const, externalTransactionId: 'refund', referenceExternalTransactionId: 'bet' };
    const pending = await process.execute(refund, 'refund', context);
    await process.execute({ ...base, kind: 'BET', externalTransactionId: 'bet' }, 'bet', context);
    await Promise.all([worker.tick(), worker.tick()]);
    const em = db.orm.em.fork();
    expect((await em.execute<{ status: string }[]>('select status from wager_transactions where id=?', [pending.body.transactionId]))[0]!.status).toBe('PROCESSED');
    expect(await em.execute('select id from wallet_ledger where transaction_id=?', [pending.body.transactionId])).toHaveLength(1);
    expect((await process.execute(refund, 'refund', context)).body.status).toBe('PENDING_REFERENCE');
    const missing = await process.execute({ ...refund, externalTransactionId: 'missing', referenceExternalTransactionId: 'never' }, 'missing', context);
    const now = new Date(); await worker.tick(now);
    const schedule = (await em.execute<{ reference_attempts: number; next_attempt_at: Date }[]>('select reference_attempts,next_attempt_at from wager_transactions where id=?', [missing.body.transactionId]))[0]!;
    expect(schedule.reference_attempts).toBe(1); expect(new Date(schedule.next_attempt_at).getTime()).toBe(now.getTime() + 1000);
    await worker.tick(now); expect((await em.execute<{ reference_attempts: number }[]>('select reference_attempts from wager_transactions where id=?', [missing.body.transactionId]))[0]!.reference_attempts).toBe(1);
    await worker.tick(new Date(now.getTime() + 1000));
    expect((await em.execute<{ failure_code: string }[]>('select failure_code from wager_transactions where id=?', [missing.body.transactionId]))[0]!.failure_code).toBe('REFERENCE_NOT_FOUND');
    expect(await em.execute('select id from wallet_ledger where transaction_id=?', [missing.body.transactionId])).toHaveLength(0);
  } finally { await db.close(); }
}, 30000);

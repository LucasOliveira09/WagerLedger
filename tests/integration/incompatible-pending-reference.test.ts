import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { RetryPendingReference } from '../../src/application/retry-pending-reference.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('referência pendente de outra carteira é rejeitada na submissão e no retry', async () => {
  const db = await createTestDatabase(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'foreign-pending' };
  try {
    const wallets = await Promise.all([1, 2].map(() => new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context)));
    const process = new ProcessWager(uow);
    const submit = (index: number, external: string, reference: string) => process.execute({ providerId: 'p', walletId: wallets[index]!.id, playerId: wallets[index]!.playerId, externalTransactionId: external, roundId: 'r', gameId: 'g', kind: 'REFUND', money: { amount: '10.00', currency: 'BRL' }, referenceExternalTransactionId: reference }, external, context);
    await submit(1, 'foreign', 'never');
    expect((await submit(0, 'initial', 'foreign')).body.failureCode).toBe('REFERENCE_MISMATCH');
    const pending = await submit(0, 'retry', 'later-foreign');
    await submit(1, 'later-foreign', 'never');
    await new RetryPendingReference(uow).execute(pending.body.transactionId, wallets[0]!.id);
    expect((await db.orm.em.fork().execute<{ failure_code: string }[]>('select failure_code from wager_transactions where id=?', [pending.body.transactionId]))[0]!.failure_code).toBe('REFERENCE_MISMATCH');
    expect(await db.orm.em.fork().execute('select id from wallet_ledger where wallet_id=?', [wallets[0]!.id])).toHaveLength(1);
  } finally { await db.close(); }
}, 30000);

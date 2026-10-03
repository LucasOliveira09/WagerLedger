import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('referência ausente persiste aceite; referência rejeitada não fica pendente', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);
  const context = { correlationId: 'pending' };

  try {
    const wallet = await new OpenWallet(uow).execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      context,
    );
    const process = new ProcessWager(uow);
    const base = {
      providerId: 'p',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round',
      gameId: 'game',
      money: { amount: '20.00', currency: 'BRL' },
    };
    const refund = {
      ...base,
      kind: 'REFUND' as const,
      externalTransactionId: 'refund',
      referenceExternalTransactionId: 'later-bet',
    };
    const pending = await process.execute(refund, 'refund', context);
    expect(pending.statusCode).toBe(202);
    expect(pending.body.status).toBe('PENDING_REFERENCE');
    const em = db.orm.em.fork();
    expect(
      await em.execute('select id from wallet_ledger where transaction_id = ?', [
        pending.body.transactionId,
      ]),
    ).toHaveLength(0);
    expect(
      await em.execute(
        "select id from outbox_messages where event_type='WagerTransactionPendingReference' and payload->'data'->>'transactionId'=?",
        [pending.body.transactionId],
      ),
    ).toHaveLength(1);
    await process.execute(
      { ...base, kind: 'BET', externalTransactionId: 'later-bet' },
      'later-bet',
      context,
    );
    const replay = await process.execute(refund, 'refund', context);
    expect(replay.statusCode).toBe(202);
    expect(replay.body.balance.amount).toBe('100.00');
    expect(replay.body.idempotentReplay).toBe(true);
    await process.execute(
      {
        ...base,
        kind: 'BET',
        externalTransactionId: 'bad-bet',
        money: { amount: '1000.00', currency: 'BRL' },
      },
      'bad-bet',
      context,
    );
    const rejected = await process.execute(
      {
        ...refund,
        externalTransactionId: 'bad-refund',
        referenceExternalTransactionId: 'bad-bet',
        money: { amount: '1000.00', currency: 'BRL' },
      },
      'bad-refund',
      context,
    );
    expect(rejected.body.failureCode).toBe('REFERENCE_NOT_PROCESSED');
    expect(rejected.statusCode).toBe(422);
  } finally {
    await db.close();
  }
}, 30000);

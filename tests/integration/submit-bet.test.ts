import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('BET debita uma vez e preserva snapshot original após outras operações', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);

  try {
    const wallet = await new OpenWallet(uow).execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      { correlationId: 'test' },
    );
    const process = new ProcessWager(uow);
    const input = {
      providerId: 'provider',
      externalTransactionId: 'bet',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round',
      gameId: 'game',
      kind: 'BET' as const,
      money: { amount: '25.00', currency: 'BRL' },
    };
    const first = await process.execute(input, 'key', { correlationId: 'test' });
    expect(first.statusCode).toBe(200);
    expect(first.body.balance.amount).toBe('75.00');
    await process.execute({ ...input, externalTransactionId: 'other' }, 'other-key', {
      correlationId: 'test',
    });
    const replay = await process.execute(input, 'key', { correlationId: 'test' });
    expect(replay.body.balance.amount).toBe('75.00');
    expect(replay.body.idempotentReplay).toBe(true);
    const rejected = await process.execute(
      { ...input, externalTransactionId: 'huge', money: { amount: '80.00', currency: 'BRL' } },
      'huge-key',
      { correlationId: 'test' },
    );
    expect(rejected.statusCode).toBe(422);
    expect(rejected.body.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(
      await db.orm.em
        .fork()
        .execute('select * from wallet_ledger where transaction_id = ?', [
          rejected.body.transactionId,
        ]),
    ).toHaveLength(0);
    await expect(
      process.execute({ ...input, money: { amount: '26.00', currency: 'BRL' } }, 'key', {
        correlationId: 'test',
      }),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);

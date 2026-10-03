import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { resolveIdempotency } from '../../src/application/idempotency.js';
import { WagerTransaction } from '../../src/domain/wager-transaction.js';
import { Money } from '../../src/domain/money.js';

test('replay vem do snapshot persistido e hashes/identidades conflitantes falham', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);

  try {
    const wallet = await new OpenWallet(uow).execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      { correlationId: 'test' },
    );
    const tx = WagerTransaction.create({
      id: crypto.randomUUID(),
      providerId: 'provider',
      externalTransactionId: 'external',
      idempotencyKey: 'key',
      payloadHash: 'hash',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round',
      gameId: 'game',
      kind: 'LOSS',
      money: Money.zero('BRL'),
    });
    tx.markProcessed(undefined, new Date());
    await uow.run(wallet.id, (session) =>
      session.saveTransaction(tx, {
        statusCode: 200,
        body: {
          transactionId: tx.id,
          status: tx.status,
          balance: wallet.balance,
          idempotentReplay: false,
        },
      }),
    );
    const replay = await uow.run(wallet.id, (session) =>
      resolveIdempotency(session, 'key', 'hash', 'provider', 'external'),
    );
    expect(replay?.body.idempotentReplay).toBe(true);
    expect(replay?.body.balance.amount).toBe('100.00');
    await expect(
      uow.run(wallet.id, (session) =>
        resolveIdempotency(session, 'key', 'different', 'provider', 'external'),
      ),
    ).rejects.toThrow();
    await expect(
      uow.run(wallet.id, (session) =>
        resolveIdempotency(session, 'other-key', 'hash', 'provider', 'external'),
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);

import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('100/80/80 e cinquenta duplicatas preservam saldo, ledger e eventos', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);
  const open = new OpenWallet(uow);
  const process = new ProcessWager(uow);
  const context = { correlationId: 'race' };

  try {
    const wallet = await open.execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      context,
    );
    const input = {
      providerId: 'provider',
      externalTransactionId: 'a',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'round',
      gameId: 'game',
      kind: 'BET' as const,
      money: { amount: '80.00', currency: 'BRL' },
    };
    const raced = await Promise.all(
      ['a', 'b'].map((id) => process.execute({ ...input, externalTransactionId: id }, id, context)),
    );
    expect(raced.map((r) => r.body.status).sort()).toEqual(['PROCESSED', 'REJECTED']);
    const em = db.orm.em.fork();
    expect(
      (
        await em.execute<{ balance: string }[]>('select balance from wallets where id = ?', [
          wallet.id,
        ])
      )[0]!.balance,
    ).toBe('20.00');
    expect(
      await em.execute("select id from wallet_ledger where wallet_id = ? and direction = 'DEBIT'", [
        wallet.id,
      ]),
    ).toHaveLength(1);
    const duplicateWallet = await open.execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      context,
    );
    const duplicates = await Promise.all(
      Array.from({ length: 50 }, () =>
        process.execute(
          {
            ...input,
            walletId: duplicateWallet.id,
            playerId: duplicateWallet.playerId,
            externalTransactionId: 'duplicate',
          },
          'same-key',
          context,
        ),
      ),
    );
    expect(new Set(duplicates.map((r) => r.body.transactionId)).size).toBe(1);
    expect(duplicates.filter((r) => !r.body.idempotentReplay)).toHaveLength(1);
    expect(
      await em.execute('select id from wallet_ledger where wallet_id = ?', [duplicateWallet.id]),
    ).toHaveLength(2);
    expect(
      await em.execute(
        "select id from outbox_messages where payload->'data'->>'transactionId' = ?",
        [duplicates[0]!.body.transactionId],
      ),
    ).toHaveLength(2);
    expect(
      (
        await em.execute<{ balanced: boolean }[]>(
          `select w.balance = coalesce(sum(case l.direction when 'CREDIT' then l.amount else -l.amount end),0) as balanced from wallets w left join wallet_ledger l on l.wallet_id=w.id group by w.id`,
        )
      ).every((r) => r.balanced),
    ).toBe(true);
  } finally {
    await db.close();
  }
}, 30000);

test('lock de uma carteira não bloqueia outra carteira', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);
  const context = { correlationId: 'independent' };
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  let holding: Promise<void> | undefined;

  try {
    const wallets = await Promise.all(
      [1, 2].map(() =>
        new OpenWallet(uow).execute(
          { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
          context,
        ),
      ),
    );
    holding = uow.run(wallets[0]!.id, async () => {
      locked();
      await barrier;
    });
    await acquired;
    const second = wallets[1]!;
    const result = await Promise.race([
      new ProcessWager(uow).execute(
        {
          providerId: 'p',
          externalTransactionId: 'independent',
          walletId: second.id,
          playerId: second.playerId,
          roundId: 'r',
          gameId: 'g',
          kind: 'BET',
          money: { amount: '10.00', currency: 'BRL' },
        },
        'independent',
        context,
      ),
      Bun.sleep(1500).then(() => {
        throw new Error('Carteira independente bloqueada.');
      }),
    ]);
    expect(result.body.balance.amount).toBe('90.00');
  } finally {
    release();
    await holding;
    await db.close();
  }
}, 30000);

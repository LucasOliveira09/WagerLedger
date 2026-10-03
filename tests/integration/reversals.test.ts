import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('reversões validam valor/tipo, disputam referência e distinguem falta de saldo', async () => {
  const db = await createTestDatabase();
  const uow = new MikroFinancialUnitOfWork(db.orm);
  const context = { correlationId: 'reversals' };

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
    const submit = (
      id: string,
      kind: 'BET' | 'WIN' | 'REFUND' | 'ROLLBACK',
      ref?: string,
      amount = '20.00',
    ) =>
      process.execute(
        {
          ...base,
          externalTransactionId: id,
          kind,
          money: { amount, currency: 'BRL' },
          ...(ref ? { referenceExternalTransactionId: ref } : {}),
        },
        id,
        context,
      );
    await submit('bet', 'BET');
    expect((await submit('partial', 'REFUND', 'bet', '10.00')).body.failureCode).toBe(
      'AMOUNT_MISMATCH',
    );
    const refunds = await Promise.all(
      ['refund-a', 'refund-b'].map((id) => submit(id, 'REFUND', 'bet')),
    );
    expect(refunds.map((r) => r.body.status).sort()).toEqual(['PROCESSED', 'REJECTED']);
    expect(refunds.find((r) => r.body.status === 'REJECTED')!.body.failureCode).toBe(
      'REVERSAL_ALREADY_APPLIED',
    );
    expect((await submit('rollback-bet', 'ROLLBACK', 'bet')).body.balance.amount).toBe('120.00');
    await submit('win', 'WIN', undefined, '50.00');
    expect((await submit('refund-win', 'REFUND', 'win', '50.00')).body.failureCode).toBe(
      'REFERENCE_KIND_INVALID',
    );
    await submit('spend', 'BET', undefined, '160.00');
    const negative = await submit('rollback-win', 'ROLLBACK', 'win', '50.00');
    expect(negative.body.failureCode).toBe('REVERSAL_INSUFFICIENT_FUNDS');
    expect(negative.body.balance.amount).toBe('10.00');
    expect(
      await db.orm.em
        .fork()
        .execute('select id from wallet_ledger where transaction_id = ?', [
          negative.body.transactionId,
        ]),
    ).toHaveLength(0);
    await expect(submit('missing-ref', 'ROLLBACK')).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);

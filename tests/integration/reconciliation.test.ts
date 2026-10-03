import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { ReconcileWallet } from '../../src/application/reconcile-wallet.js';
import { MikroFinancialReadStore } from '../../src/infrastructure/persistence/mikro-financial-read-store.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { StructuredTelemetry } from '../../src/infrastructure/observability/telemetry.js';

test('reconciliação inclui abertura, mantém snapshot concorrente e sinaliza corrupção sem corrigir', async () => {
  const db = await createTestDatabase(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'reconcile' };
  const logs: string[] = []; const telemetry = new StructuredTelemetry(line => logs.push(line));
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const reconcile = new ReconcileWallet(new MikroFinancialReadStore(db.orm), telemetry);
    expect(await reconcile.execute(wallet.id, context)).toMatchObject({ consistent: true, checkedEntries: 1, difference: { amount: '0.00', currency: 'BRL' } });
    const process = new ProcessWager(uow);
    await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const write = process.execute({ providerId: 'p', externalTransactionId: String(i), walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind: 'BET', money: { amount: '1.00', currency: 'BRL' } }, String(i), context);
      expect((await reconcile.execute(wallet.id, context)).consistent).toBe(true);
      await write;
    }));
    const em = db.orm.em.fork();
    // Somente o dono do banco descartável simula uma restauração administrativa corrompida.
    await em.execute('alter table wallets disable trigger user');
    try { await em.execute('update wallets set balance=77.00 where id=?', [wallet.id]); }
    finally { await em.execute('alter table wallets enable trigger user'); }
    const result = await reconcile.execute(wallet.id, context);
    expect(result.consistent).toBe(false); expect(result.difference.amount).toBe('-3.00'); expect(result.calculatedBalance.amount).toBe('80.00');
    expect((await em.execute<{ balance: string }[]>('select balance from wallets where id=?', [wallet.id]))[0]!.balance).toBe('77.00');
    expect(telemetry.render()).toContain('reconciliation_divergences_total 1'); expect(logs).toHaveLength(1); expect(logs[0]).toContain(wallet.id);
  } finally { await db.close(); }
}, 30000);

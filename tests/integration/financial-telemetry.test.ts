import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { StructuredTelemetry } from '../../src/infrastructure/observability/telemetry.js';

test('commit, replay e rejeição geram métricas e logs com IDs sem valores financeiros', async () => {
  const db = await createTestDatabase();
  const logs: string[] = [];
  const telemetry = new StructuredTelemetry((line) => logs.push(line));
  const uow = new MikroFinancialUnitOfWork(db.orm, telemetry);
  const context = { correlationId: 'observable' };

  try {
    const wallet = await new OpenWallet(uow).execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      context,
    );
    const process = new ProcessWager(uow, telemetry);
    const input = {
      providerId: 'p',
      externalTransactionId: 'bet',
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'r',
      gameId: 'g',
      kind: 'BET' as const,
      money: { amount: '80.00', currency: 'BRL' },
    };
    const first = await process.execute(input, 'bet', context);
    await process.execute(input, 'bet', context);
    await process.execute({ ...input, externalTransactionId: 'second' }, 'second', context);
    expect(telemetry.render()).toContain('transactions_total{status="PROCESSED"} 1');
    expect(telemetry.render()).toContain('transactions_total{status="REJECTED"} 1');
    expect(telemetry.render()).toContain('duplicates_total{source="http"} 1');
    expect(telemetry.render()).toContain('processing_seconds_count{source="http"} 3');
    expect(telemetry.render()).toContain('wallet_lock_wait_seconds_count 3');
    expect(logs[0]).toContain(first.body.transactionId);
    expect(logs.join('')).not.toContain('80.00');
    expect(telemetry.render()).not.toContain(wallet.id);
  } finally {
    await db.close();
  }
}, 30000);

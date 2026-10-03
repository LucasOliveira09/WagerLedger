import { expect, test } from 'bun:test';
import { loadConfig } from '../load/config.js';
import { runScenario } from '../load/scenario.js';

test('experimento separa seed/aquecimento e verifica dinheiro e eventos após carga', async () => {
  const config = loadConfig({
    LOAD_DURATION_SECONDS: '1',
    LOAD_MAX_REQUESTS: '12',
    LOAD_CONCURRENCY: '2',
    LOAD_WALLETS: '2',
    LOAD_HISTORY_ENTRIES: '2',
    LOAD_WARMUP_REQUESTS: '2',
  });
  const report = await runScenario('independent-wallets', config, new AbortController().signal);
  expect(report.passed).toBe(true);
  expect(report.workload.requests).toBe(12);
  expect(report.financial.processedMeasured).toBe(12);
  expect(report.metrics.api.processingCount).toBe(12);
  expect(report.metrics.api.processed).toBe(12);
  expect(
    report.financial.wallets.every(
      (wallet) => wallet.consistent && wallet.expectedBalance === wallet.storedBalance,
    ),
  ).toBe(true);
  // 2 OPENING + 4 seed + 2 warmup + 12 medidas = 20 operações, todas com dois eventos.
  expect(report.outbox.totalEvents).toBe(40);
  expect(report.outbox.pendingEvents).toBe(0);
  expect(report.events).toMatchObject({
    expectedEvents: 40,
    totalEvents: 40,
    invalidTransactions: 0,
    consistent: true,
  });
  expect(new Set(Object.values(report.processes)).size).toBe(3);
}, 30000);

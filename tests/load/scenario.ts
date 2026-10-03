import { Money } from '../../src/domain/money.js';
import { ReconcileWallet } from '../../src/application/reconcile-wallet.js';
import { MikroFinancialReadStore } from '../../src/infrastructure/persistence/mikro-financial-read-store.js';
import { nullTelemetry } from '../../src/application/ports/telemetry.js';
import { createLoadEnvironment, drainOutbox } from './environment.js';
import type { LoadEnvironment } from './environment.js';
import { runLoad, submitBet } from './generator.js';
import type { LoadWallet } from './generator.js';
import type { LoadConfig } from './config.js';
import { startMonitor } from './monitor.js';

export type ScenarioName = 'hot-wallet' | 'independent-wallets';
const initialAmount = '1000000.00';

async function prepare(environment: LoadEnvironment, count: number, config: LoadConfig, prefix: string, signal: AbortSignal) {
  const wallets: LoadWallet[] = [];
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const response = await fetch(environment.api.url + '/wallets', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: crypto.randomUUID(), initialBalance: { amount: initialAmount, currency: 'BRL' } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutSeconds * 1000)]) });
    if (response.status !== 201) throw new Error('Falha ao criar carteira de carga.');
    const wallet = await response.json() as LoadWallet; wallets.push(wallet);
    for (let entry = 0; entry < config.historyEntries; entry++) {
      signal.throwIfAborted();
      const result = await submitBet(environment.api.url, wallet, `${prefix}:seed:${index}:${entry}`, config.timeoutSeconds * 1000, signal);
      if (result.failure) throw new Error(`Falha no histórico inicial: ${result.failure}.`);
    }
  }
  if (config.warmupRequests) {
    const warmup = await runLoad({ baseUrl: environment.api.url, wallets, concurrency: config.concurrency, durationMs: 300000,
      maxRequests: config.warmupRequests, timeoutMs: config.timeoutSeconds * 1000, prefix: `${prefix}:warmup`, signal });
    if (warmup.errors || warmup.requests !== config.warmupRequests) throw new Error('Aquecimento não concluído.');
  }
  if (!(await drainOutbox(environment, config.drainSeconds * 1000, signal)).drained) throw new Error('Outbox não drenou antes da medição.');
  return wallets;
}
async function verify(environment: LoadEnvironment, wallets: readonly LoadWallet[], prefix: string, successes: number) {
  const em = environment.db.orm.em.fork();
  const measured = await em.execute<{ processed: string; total: string }[]>(
    "select count(*) filter (where status='PROCESSED')::text as processed,count(*)::text as total from wager_transactions where external_transaction_id like ? and kind='BET'", [`${prefix}:measure:%`]);
  const reconciler = new ReconcileWallet(new MikroFinancialReadStore(environment.db.orm), nullTelemetry);
  const reconciliations = [];
  for (const wallet of wallets) {
    const counts = await em.execute<{ processed: string; version: number }[]>(
      "select w.version,count(t.id) filter (where t.kind='BET' and t.status='PROCESSED')::text as processed from wallets w left join wager_transactions t on t.wallet_id=w.id where w.id=? group by w.id", [wallet.id]);
    const row = counts[0]!;
    // Cada BET vale 1.00: count é convertido para string decimal, sem aritmética monetária em Number.
    const expected = Money.from({ amount: initialAmount, currency: 'BRL' }).subtract(Money.from({ amount: `${row.processed}.00`, currency: 'BRL' }));
    const result = await reconciler.execute(wallet.id, { correlationId: prefix });
    const consistent = result.consistent && expected.toString() === result.storedBalance.amount
      && result.checkedEntries === Number(row.processed) + 1 && row.version === Number(row.processed) + 1;
    reconciliations.push({ walletId: wallet.id, consistent, storedBalance: result.storedBalance.amount,
      expectedBalance: expected.toString(), ledgerEntries: result.checkedEntries, version: row.version });
  }
  return { wallets: reconciliations, processedMeasured: Number(measured[0]!.processed),
    responseAgreement: Number(measured[0]!.processed) === successes && Number(measured[0]!.total) === successes,
    consistent: reconciliations.every(wallet => wallet.consistent) };
}
export async function runScenario(name: ScenarioName, config: LoadConfig, signal: AbortSignal) {
  const prefix = `load:${name}:${crypto.randomUUID()}`;
  console.log(`[load] ${name}: preparando recursos e histórico.`);
  const environment = await createLoadEnvironment();
  let monitor: Awaited<ReturnType<typeof startMonitor>> | undefined;
  try {
    const wallets = await prepare(environment, name === 'hot-wallet' ? 1 : config.wallets, config, prefix, signal);
    monitor = await startMonitor(environment.api.url, environment.publisher.url);
    console.log(`[load] ${name}: medindo ${config.durationSeconds}s, concorrência ${config.concurrency}.`);
    const workload = await runLoad({ baseUrl: environment.api.url, wallets, concurrency: config.concurrency,
      durationMs: config.durationSeconds * 1000, maxRequests: config.maxRequests,
      timeoutMs: config.timeoutSeconds * 1000, prefix: `${prefix}:measure`, signal });
    const outbox = await drainOutbox(environment, config.drainSeconds * 1000, signal);
    const metrics = await monitor.stop();
    // Encerrar a API drena handlers antes da auditoria final, inclusive após um timeout do cliente.
    await environment.api.stop();
    const finalOutbox = await drainOutbox(environment, config.drainSeconds * 1000, signal);
    const financial = await verify(environment, wallets, prefix, workload.successes);
    const passed = !signal.aborted && workload.requests > 0 && workload.errors === 0 && financial.consistent
      && financial.responseAgreement && outbox.drained && finalOutbox.drained && metrics.samplingFailures === 0;
    return { name, passed, walletCount: wallets.length, historyEntriesPerWallet: config.historyEntries,
      processes: { generator: process.pid, api: environment.api.pid, publisher: environment.publisher.pid },
      postgresVersion: environment.postgresVersion, workload, metrics, financial,
      outbox: { ...finalOutbox, elapsedMs: outbox.elapsedMs + finalOutbox.elapsedMs } };
  } finally {
    try { await monitor?.stop(); } finally { await environment.close(); }
  }
}

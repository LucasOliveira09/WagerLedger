import { expect, test } from 'bun:test';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { eventually, spawnTestWorker } from '../support/process-harness.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { ReconcileWallet } from '../../src/application/reconcile-wallet.js';
import { MikroFinancialReadStore } from '../../src/infrastructure/persistence/mikro-financial-read-store.js';
import { StructuredTelemetry } from '../../src/infrastructure/observability/telemetry.js';

test('três processos preservam dinheiro sob duplicatas, races, referências e reinício', async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues(); const workers: ReturnType<typeof spawnTestWorker>[] = [];
  const context = { correlationId: 'multi-process' };
  try {
    const open = new OpenWallet(new MikroFinancialUnitOfWork(db.orm));
    const wallets = await Promise.all(Array.from({ length: 7 }, () => open.execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context)));
    const configuration = { databaseUrl: db.appUrl, queueUrls: { wagers: queues.wagers, dlq: queues.dlq, events: queues.events }, waitTimeSeconds: 1, visibilitySeconds: 10 };
    for (let i = 0; i < 3; i++) workers.push(spawnTestWorker(configuration));
    const ready = await Promise.all(workers.map(worker => worker.waitFor('ready')));
    expect(new Set(ready.map(notice => notice.pid)).size).toBe(3);
    expect(ready.every(notice => notice.pid !== process.pid)).toBe(true);
    console.info(JSON.stringify({ evidence: 'three_real_worker_processes', pids: ready.map(notice => notice.pid) }));
    const send = async (walletIndex: number, id: string, externalId: string, kind: string, amount: string, reference?: string) => {
      const wallet = wallets[walletIndex]!;
      // Grupos diferentes de propósito: o banco protege a wallet mesmo sem ordenação do broker.
      await queues.client.send(new SendMessageCommand({ QueueUrl: queues.wagers, MessageGroupId: `adversarial-${id}`, MessageDeduplicationId: id,
        MessageBody: JSON.stringify({ messageId: id, type: 'WagerTransactionRequested', occurredAt: '2026-10-03T00:00:00.000Z', data: { providerId: 'p', externalTransactionId: externalId, idempotencyKey: externalId, walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind, money: { amount, currency: 'BRL' }, ...(reference ? { referenceExternalTransactionId: reference } : {}) } }) }));
    };
    await Promise.all(Array.from({ length: 50 }, (_, i) => send(0, `duplicate-${i}`, 'duplicate-bet', 'BET', '80.00')));
    await Promise.all(workers.map(worker => worker.waitFor('committed')));
    await Promise.all(['a', 'b'].map(id => send(1, `race-${id}`, `race-${id}`, 'BET', '80.00')));
    await send(2, 'early-refund', 'early-refund', 'REFUND', '20.00', 'later-bet');
    const em = db.orm.em.fork();
    await eventually(async () => (await em.execute("select id from wager_transactions where external_transaction_id='early-refund' and status='PENDING_REFERENCE'")).length === 1);
    await send(2, 'later-bet', 'later-bet', 'BET', '20.00');
    await send(3, 'reversal-bet', 'reversal-bet', 'BET', '20.00');
    await Promise.all(['a', 'b'].map(id => send(3, `refund-${id}`, `refund-${id}`, 'REFUND', '20.00', 'reversal-bet')));
    await Promise.all([4, 5, 6].map(index => send(index, `independent-${index}`, `independent-${index}`, 'BET', '10.00')));
    await eventually(async () => {
      const inbox = await em.execute('select message_id from inbox_messages');
      const pending = await em.execute("select id from wager_transactions where status in ('PENDING','PENDING_REFERENCE')");
      const outbox = await em.execute('select id from outbox_messages where published_at is null');
      return inbox.length === 60 && pending.length === 0 && outbox.length === 0;
    });
    expect(await em.execute("select id from wager_transactions where external_transaction_id like 'race-%' and status='PROCESSED'")).toHaveLength(1);
    expect(await em.execute("select id from wager_transactions where external_transaction_id like 'refund-%' and status='REJECTED' and failure_code='REVERSAL_ALREADY_APPLIED'")).toHaveLength(1);
    await Promise.all(workers.map(worker => worker.stop()));
    const restarted = spawnTestWorker(configuration); workers.push(restarted); await restarted.waitFor('ready');
    await send(0, 'after-restart', 'after-restart', 'LOSS', '0.00'); await restarted.waitFor('committed'); await restarted.stop();
    const reconcile = new ReconcileWallet(new MikroFinancialReadStore(db.orm), new StructuredTelemetry(() => {}));
    const expected = ['20.00', '20.00', '100.00', '100.00', '90.00', '90.00', '90.00'];
    for (const [index, wallet] of wallets.entries()) {
      const result = await reconcile.execute(wallet.id, context);
      expect(result.consistent).toBe(true); expect(result.storedBalance.amount).toBe(expected[index]!);
    }
    expect(await em.execute('select id from wallet_ledger where wallet_id=?', [wallets[0]!.id])).toHaveLength(2);
  } finally { for (const worker of workers) await worker.kill(); await queues.close(); await db.close(); }
}, 60000);

import { expect, test } from 'bun:test';
import { ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { spawnTestWorker } from '../support/process-harness.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('processo drena operação confirmada ao executar handler SIGTERM', async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues();
  let worker: ReturnType<typeof spawnTestWorker> | undefined;
  try {
    const wallet = await new OpenWallet(new MikroFinancialUnitOfWork(db.orm)).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, { correlationId: 'shutdown' });
    worker = spawnTestWorker({ databaseUrl: db.url, queueUrls: { wagers: queues.wagers, dlq: queues.dlq, events: queues.events }, roles: ['consumer'], waitTimeSeconds: 1, visibilitySeconds: 5, mode: 'commit-pause' });
    expect((await worker.waitFor('ready')).pid).not.toBe(process.pid);
    await queues.client.send(new SendMessageCommand({ QueueUrl: queues.wagers, MessageGroupId: wallet.id, MessageDeduplicationId: 'shutdown', MessageBody: JSON.stringify({ messageId: 'shutdown', type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(), data: { providerId: 'p', externalTransactionId: 'bet', idempotencyKey: 'bet', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind: 'BET', money: { amount: '20.00', currency: 'BRL' } } }) }));
    await worker.waitFor('committed');
    // Windows não entrega sinais POSIX como Linux; IPC executa o mesmo handler SIGTERM.
    worker.send('stop'); worker.send('release');
    await worker.waitFor('stopped'); expect(await worker.child.exited).toBe(0);
    expect((await queues.client.send(new ReceiveMessageCommand({ QueueUrl: queues.wagers }))).Messages ?? []).toHaveLength(0);
    expect((await db.orm.em.fork().execute<{ balance: string }[]>('select balance from wallets where id=?', [wallet.id]))[0]!.balance).toBe('80.00');
  } finally { await worker?.kill(); await queues.close(); await db.close(); }
}, 30000);

import { expect, test } from 'bun:test';
import { GetQueueAttributesCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { spawnTestWorker } from '../support/process-harness.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { MikroFinancialReadStore } from '../../src/infrastructure/persistence/mikro-financial-read-store.js';
import { ReconcileWallet } from '../../src/application/reconcile-wallet.js';
import { StructuredTelemetry } from '../../src/infrastructure/observability/telemetry.js';

test('morte real após commit antes do ack causa redelivery sem novo débito/evento', async () => {
  const db = await createTestDatabase();
  const queues = await createTestQueues();
  const workers: ReturnType<typeof spawnTestWorker>[] = [];

  try {
    const wallet = await new OpenWallet(new MikroFinancialUnitOfWork(db.orm)).execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
      { correlationId: 'crash' },
    );
    const configuration = {
      databaseUrl: db.url,
      queueUrls: { wagers: queues.wagers, dlq: queues.dlq, events: queues.events },
      roles: ['consumer'],
      waitTimeSeconds: 1,
      visibilitySeconds: 1,
    };
    const first = spawnTestWorker({ ...configuration, mode: 'commit-pause' });
    workers.push(first);
    await first.waitFor('ready');
    await queues.client.send(
      new SendMessageCommand({
        QueueUrl: queues.wagers,
        MessageGroupId: wallet.id,
        MessageDeduplicationId: 'crash',
        MessageBody: JSON.stringify({
          messageId: 'crash',
          type: 'WagerTransactionRequested',
          occurredAt: new Date().toISOString(),
          data: {
            providerId: 'p',
            externalTransactionId: 'bet',
            idempotencyKey: 'bet',
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: 'r',
            gameId: 'g',
            kind: 'BET',
            money: { amount: '20.00', currency: 'BRL' },
          },
        }),
      }),
    );
    await first.waitFor('committed');
    expect(
      (
        await queues.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: queues.wagers,
            AttributeNames: ['ApproximateNumberOfMessagesNotVisible'],
          }),
        )
      ).Attributes!.ApproximateNumberOfMessagesNotVisible,
    ).toBe('1');
    await first.kill();
    expect(first.child.killed).toBe(true);
    const second = spawnTestWorker(configuration);
    workers.push(second);
    await second.waitFor('ready');
    await second.waitFor('committed');
    await second.stop();
    const em = db.orm.em.fork();
    expect(await em.execute('select * from inbox_messages')).toHaveLength(1);
    expect(
      await em.execute('select id from wallet_ledger where wallet_id=?', [wallet.id]),
    ).toHaveLength(2);
    expect(await em.execute('select id from outbox_messages')).toHaveLength(4);
    const result = await new ReconcileWallet(
      new MikroFinancialReadStore(db.orm),
      new StructuredTelemetry(() => {}),
    ).execute(wallet.id, { correlationId: 'restart' });
    expect(result.consistent).toBe(true);
    expect(result.storedBalance.amount).toBe('80.00');
  } finally {
    for (const worker of workers) {
      await worker.kill();
    }
    await queues.close();
    await db.close();
  }
}, 30000);

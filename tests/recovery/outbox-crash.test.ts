import { expect, test } from 'bun:test';
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { eventually, spawnTestWorker } from '../support/process-harness.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

for (const mode of ['before-publish', 'publish-pause'] as const) {
  test(`morte real ${mode} preserva evento; duplicata mantém eventId`, async () => {
    const db = await createTestDatabase();
    const queues = await createTestQueues();
    const workers: ReturnType<typeof spawnTestWorker>[] = [];

    try {
      const wallet = await new OpenWallet(new MikroFinancialUnitOfWork(db.orm)).execute(
        { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
        { correlationId: 'outbox-crash' },
      );
      const configuration = {
        databaseUrl: db.url,
        queueUrls: { wagers: queues.wagers, dlq: queues.dlq, events: queues.events },
        roles: ['publisher'],
      };
      const first = spawnTestWorker({ ...configuration, mode });
      workers.push(first);
      await first.waitFor('ready');
      const interrupted = await first.waitFor(
        mode === 'before-publish' ? 'before-publish' : 'published',
      );
      await first.kill();
      const em = db.orm.em.fork();
      expect(
        await em.execute('select id from outbox_messages where published_at is null'),
      ).toHaveLength(2);
      const second = spawnTestWorker(configuration);
      workers.push(second);
      await second.waitFor('ready');
      await eventually(
        async () =>
          (await em.execute('select id from outbox_messages where published_at is null')).length ===
          0,
      );
      await second.stop();
      const delivered: string[] = [];

      for (let i = 0; i < 10; i++) {
        const messages =
          (
            await queues.client.send(
              new ReceiveMessageCommand({ QueueUrl: queues.events, MaxNumberOfMessages: 10 }),
            )
          ).Messages ?? [];

        if (!messages.length) {
          break;
        }
        for (const message of messages) {
          delivered.push((JSON.parse(message.Body!) as { eventId: string }).eventId);
          await queues.client.send(
            new DeleteMessageCommand({
              QueueUrl: queues.events,
              ReceiptHandle: message.ReceiptHandle!,
            }),
          );
        }
      }

      expect(new Set(delivered).size).toBe(2);
      expect(delivered.filter((id) => id === interrupted.id)).toHaveLength(
        mode === 'publish-pause' ? 2 : 1,
      );
      expect(delivered).toHaveLength(mode === 'publish-pause' ? 3 : 2);
      expect(
        (
          await em.execute<{ balanced: boolean }[]>(
            "select w.balance=sum(case l.direction when 'CREDIT' then l.amount else -l.amount end) as balanced from wallets w join wallet_ledger l on l.wallet_id=w.id where w.id=? group by w.id",
            [wallet.id],
          )
        )[0]!.balanced,
      ).toBe(true);
    } finally {
      for (const worker of workers) {
        await worker.kill();
      }
      await queues.close();
      await db.close();
    }
  }, 30000);
}

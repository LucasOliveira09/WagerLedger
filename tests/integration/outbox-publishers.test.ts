import { expect, test } from 'bun:test';
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { OutboxPublisher } from '../../src/interfaces/workers/outbox-publisher.js';
import { SqsEventPublisher } from '../../src/infrastructure/messaging/event-publisher.js';

test('publishers concorrentes publicam IDs estáveis e falha mantém retry persistido', async () => {
  const db = await createTestDatabase();
  const queues = await createTestQueues();
  const context = { correlationId: 'outbox' };

  try {
    const uow = new MikroFinancialUnitOfWork(db.orm);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        new OpenWallet(uow).execute(
          { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } },
          context,
        ),
      ),
    );
    const emitter = new SqsEventPublisher(queues.client, queues.events);
    const workers = [new OutboxPublisher(db.orm, emitter), new OutboxPublisher(db.orm, emitter)];
    await Promise.all(
      workers.map(async (worker) => {
        for (let i = 0; i < 20; i++) {
          if (!(await worker.tick())) {
            break;
          }
        }
      }),
    );
    const em = db.orm.em.fork();
    const published = await em.execute<{ id: string }[]>(
      'select id from outbox_messages where published_at is not null',
    );
    expect(published).toHaveLength(8);
    const received: string[] = [];

    for (let i = 0; i < 20; i++) {
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
        received.push((JSON.parse(message.Body!) as { eventId: string }).eventId);
        await queues.client.send(
          new DeleteMessageCommand({
            QueueUrl: queues.events,
            ReceiptHandle: message.ReceiptHandle!,
          }),
        );
      }
    }

    expect(new Set(received).size).toBe(8);
    expect(received.sort()).toEqual(published.map((row) => row.id).sort());
    await new OpenWallet(uow).execute(
      { playerId: crypto.randomUUID(), initialBalance: { amount: '1.00', currency: 'BRL' } },
      context,
    );
    const now = new Date();
    await new OutboxPublisher(db.orm, {
      publish: async () => {
        throw new Error('Destino indisponível.');
      },
    }).tick(now);
    const retried = (
      await em.execute<{ attempts: number; next_attempt_at: Date; published_at: Date | null }[]>(
        'select attempts,next_attempt_at,published_at from outbox_messages where attempts>0',
      )
    )[0]!;
    expect(retried.attempts).toBe(1);
    expect(retried.published_at).toBeNull();
    expect(new Date(retried.next_attempt_at).getTime()).toBeGreaterThan(now.getTime());
  } finally {
    await queues.close();
    await db.close();
  }
}, 30000);

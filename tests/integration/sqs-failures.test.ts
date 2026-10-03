import { expect, test } from 'bun:test';
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { WagerConsumer } from '../../src/interfaces/workers/wager-consumer.js';

test('poison e retry esgotado chegam à DLQ; falha no envio não confirma origem', async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'failures' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const receive = async (url: string) => (await queues.client.send(new ReceiveMessageCommand({ QueueUrl: url, MessageSystemAttributeNames: ['ApproximateReceiveCount', 'MessageGroupId'], MessageAttributeNames: ['All'] }))).Messages?.[0];
    const send = (body: string, id: string) => queues.client.send(new SendMessageCommand({ QueueUrl: queues.wagers, MessageBody: body, MessageGroupId: wallet.id, MessageDeduplicationId: id }));
    const process = new ProcessWager(uow); const options = { queueUrl: queues.wagers, dlqUrl: queues.dlq, waitTimeSeconds: 0, maxAttempts: 2 };
    const consumer = new WagerConsumer(queues.client, process, options);
    await send('not-json', 'poison'); await consumer.tick();
    const poison = (await receive(queues.dlq))!;
    expect(poison.Body).toBe('not-json'); expect(await receive(queues.wagers)).toBeUndefined();
    await queues.client.send(new DeleteMessageCommand({ QueueUrl: queues.dlq, ReceiptHandle: poison.ReceiptHandle! }));
    const data = { providerId: 'p', externalTransactionId: 'temporary', idempotencyKey: 'temporary', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind: 'BET', money: { amount: '20.00', currency: 'BRL' } };
    await send(JSON.stringify({ messageId: 'transient', type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(), data }), 'transient');
    const failing = new ProcessWager({ run: async () => { throw Object.assign(new Error('Conexão temporariamente indisponível.'), { code: 'ECONNREFUSED' }); } });
    const retrying = new WagerConsumer(queues.client, failing, options);
    const first = (await receive(queues.wagers))!; await retrying.handle(first);
    expect(await receive(queues.wagers)).toBeUndefined();
    await queues.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: queues.wagers, ReceiptHandle: first.ReceiptHandle!, VisibilityTimeout: 0 }));
    await retrying.handle((await receive(queues.wagers))!);
    const dead = (await receive(queues.dlq))!;
    expect(dead.MessageAttributes!.failureCode!.StringValue).toBe('RETRY_EXHAUSTED');
    expect(await db.orm.em.fork().execute('select * from inbox_messages')).toHaveLength(0);
    await send('also-invalid', 'dlq-down');
    const source = (await receive(queues.wagers))!;
    await expect(new WagerConsumer(queues.client, process, { ...options, dlqUrl: queues.dlq.replace(/[^/]+$/, 'nonexistent.fifo') }).handle(source)).rejects.toThrow();
    await queues.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: queues.wagers, ReceiptHandle: source.ReceiptHandle!, VisibilityTimeout: 0 }));
    expect((await receive(queues.wagers))!.Body).toBe('also-invalid');
  } finally { await queues.close(); await db.close(); }
}, 30000);

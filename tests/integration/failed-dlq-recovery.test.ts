import { expect, test } from 'bun:test';
import { ChangeMessageVisibilityCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { failAfterWrite } from '../support/failure-injection.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { WagerConsumer } from '../../src/interfaces/workers/wager-consumer.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

for (const kind of ['BET', 'REFUND'] as const) test(`DLQ indisponível após FAILED de ${kind} continua pendente no redelivery`, async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues(); const uow = new MikroFinancialUnitOfWork(db.orm);
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, { correlationId: 'dlq-recovery' });
    const input = { providerId: 'p', externalTransactionId: 'failure', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind, money: { amount: '20.00', currency: 'BRL' }, ...(kind === 'REFUND' ? { referenceExternalTransactionId: 'absent' } : {}) };
    if (kind === 'REFUND') await new ProcessWager(uow).execute(input, 'failure', { correlationId: 'initial-http' });
    await queues.client.send(new SendMessageCommand({ QueueUrl: queues.wagers, MessageGroupId: wallet.id, MessageDeduplicationId: 'failure', MessageBody: JSON.stringify({ messageId: 'failure', type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(), data: { ...input, idempotencyKey: 'failure' } }) }));
    const options = { queueUrl: queues.wagers, dlqUrl: queues.dlq, waitTimeSeconds: 0 };
    const message = (await queues.client.send(new ReceiveMessageCommand({ QueueUrl: queues.wagers, MessageSystemAttributeNames: ['All'] }))).Messages![0]!;
    const failing = new ProcessWager(failAfterWrite(uow, kind === 'REFUND' ? 'saveInbox' : 'appendLedger', Object.assign(new Error('Falha permanente.'), { code: '23514' })));
    await expect(new WagerConsumer(queues.client, failing, { ...options, dlqUrl: queues.dlq.replace(/[^/]+$/, 'nonexistent.fifo') }).handle(message)).rejects.toThrow();
    expect((await db.orm.em.fork().execute<{ status: string }[]>("select status from wager_transactions where external_transaction_id='failure'"))[0]!.status).toBe('FAILED');
    await queues.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: queues.wagers, ReceiptHandle: message.ReceiptHandle!, VisibilityTimeout: 0 }));
    await new WagerConsumer(queues.client, new ProcessWager(uow), options).tick();
    expect((await queues.client.send(new ReceiveMessageCommand({ QueueUrl: queues.dlq }))).Messages).toHaveLength(1);
    expect(await db.orm.em.fork().execute("select id from outbox_messages where event_type='WagerTransactionFailed'")).toHaveLength(1);
    if (kind === 'REFUND') {
      const replay = await new ProcessWager(uow).execute(input, 'failure', { correlationId: 'replay' });
      expect(replay.body.status).toBe('PENDING_REFERENCE'); expect(replay.currentStatus).toBe('FAILED');
    }
  } finally { await queues.close(); await db.close(); }
}, 30000);

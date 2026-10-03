import { expect, test } from 'bun:test';
import { SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { WagerConsumer } from '../../src/interfaces/workers/wager-consumer.js';

test('SQS e entrada síncrona usam a mesma operação; pendência libera grupo FIFO', async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'sqs' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const process = new ProcessWager(uow); const consumer = new WagerConsumer(queues.client, process, { queueUrl: queues.wagers, dlqUrl: queues.dlq, waitTimeSeconds: 0 });
    const input = { providerId: 'p', externalTransactionId: 'bet', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', kind: 'BET' as const, money: { amount: '20.00', currency: 'BRL' } };
    const send = (id: string, data: object) => queues.client.send(new SendMessageCommand({ QueueUrl: queues.wagers, MessageGroupId: wallet.id, MessageDeduplicationId: id, MessageBody: JSON.stringify({ messageId: id, type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(), data }) }));
    await send('m1', { ...input, idempotencyKey: 'bet' });
    await Promise.all([consumer.tick(), process.execute(input, 'bet', context)]);
    await send('m2', { ...input, idempotencyKey: 'bet' }); await consumer.tick();
    expect(await db.orm.em.fork().execute('select * from inbox_messages')).toHaveLength(2);
    expect(await db.orm.em.fork().execute('select id from wallet_ledger where wallet_id=?', [wallet.id])).toHaveLength(2);
    await send('refund-first', { ...input, kind: 'REFUND', externalTransactionId: 'refund', referenceExternalTransactionId: 'later', idempotencyKey: 'refund' });
    await send('later', { ...input, externalTransactionId: 'later', idempotencyKey: 'later' });
    await consumer.tick(); await consumer.tick();
    expect((await db.orm.em.fork().execute<{ status: string }[]>("select status from wager_transactions where external_transaction_id='later'"))[0]!.status).toBe('PROCESSED');
    expect((await queues.client.send(new ReceiveMessageCommand({ QueueUrl: queues.wagers }))).Messages ?? []).toHaveLength(0);
  } finally { await queues.close(); await db.close(); }
}, 30000);

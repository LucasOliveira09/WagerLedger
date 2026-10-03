import { expect, test } from 'bun:test';
import { ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { WagerConsumer } from '../../src/interfaces/workers/wager-consumer.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { failAfterWrite } from '../support/failure-injection.js';

test('falha permanente grava FAILED/inbox/evento antes da DLQ e não substitui operação terminal', async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues(); const uow = new MikroFinancialUnitOfWork(db.orm); const context = { correlationId: 'failed' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const input = { providerId: 'p', walletId: wallet.id, playerId: wallet.playerId, externalTransactionId: 'failure', roundId: 'r', gameId: 'g', kind: 'BET' as const, money: { amount: '20.00', currency: 'BRL' } };
    const faulty = failAfterWrite(uow, 'appendLedger', Object.assign(new Error('Falha permanente após ledger SQL.'), { code: '23514' }));
    const failing = new ProcessWager(faulty);
    const consumer = new WagerConsumer(queues.client, failing, { queueUrl: queues.wagers, dlqUrl: queues.dlq, waitTimeSeconds: 0 });
    await queues.client.send(new SendMessageCommand({ QueueUrl: queues.wagers, MessageGroupId: wallet.id, MessageDeduplicationId: 'failed', MessageBody: JSON.stringify({ messageId: 'failed', type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(), data: { ...input, idempotencyKey: 'failure' } }) }));
    await consumer.tick();
    const em = db.orm.em.fork(); const rows = await em.execute<{ id: string; status: string; failure_code: string }[]>("select id,status,failure_code from wager_transactions where external_transaction_id='failure'");
    expect(rows[0]!.status).toBe('FAILED'); expect(rows[0]!.failure_code).toBe('INFRASTRUCTURE_PERMANENT_FAILURE');
    expect(await em.execute('select id from wallet_ledger where wallet_id=?', [wallet.id])).toHaveLength(1);
    expect(await em.execute('select * from inbox_messages')).toHaveLength(1);
    expect(await em.execute("select id from outbox_messages where event_type='WagerTransactionFailed'")).toHaveLength(1);
    expect((await queues.client.send(new ReceiveMessageCommand({ QueueUrl: queues.dlq }))).Messages).toHaveLength(1);
    const replay = await new ProcessWager(uow).execute(input, 'failure', context); expect(replay.body.status).toBe('FAILED'); expect(replay.body.balance.amount).toBe('100.00');
    const successful = { ...input, externalTransactionId: 'successful' }; const process = new ProcessWager(uow);
    const committed = await process.execute(successful, 'successful', context);
    expect((await process.recordFailure(successful, 'successful', context, { messageId: 'new-message', consumerName: 'wager-consumer', payloadHash: 'hash' })).body.transactionId).toBe(committed.body.transactionId);
    expect((await em.execute<{ status: string }[]>("select status from wager_transactions where external_transaction_id='successful'"))[0]!.status).toBe('PROCESSED');
  } finally { await queues.close(); await db.close(); }
}, 30000);

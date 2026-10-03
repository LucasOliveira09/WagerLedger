import assert from 'node:assert/strict';
import { GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createSqsClient } from '../src/infrastructure/messaging/sqs-client.js';
import type { WagerInput } from '../src/application/process-wager.js';
import type { SubmissionResult } from '../src/application/transaction-result.js';

const api = process.env.API_URL ?? 'http://127.0.0.1:3000';
const runId = crypto.randomUUID();
const playerId = crypto.randomUUID();

async function request<T>(path: string, expectedStatus: number, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': runId, ...(key ? { 'idempotency-key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(value)}`);
  return value as T;
}

const wallet = await request<{ id: string }>('/wallets', 201, { playerId, initialBalance: { amount: '100.00', currency: 'BRL' } });
const input = (kind: WagerInput['kind'], externalTransactionId: string, amount: string, reference?: string): WagerInput => ({
  providerId: `demo-${runId}`, externalTransactionId, walletId: wallet.id, playerId, roundId: 'demo-round', gameId: 'demo-game',
  kind, money: { amount, currency: 'BRL' }, ...(reference ? { referenceExternalTransactionId: reference } : {}),
});
const submit = (operation: WagerInput, status = 200) => request<SubmissionResult['body']>(
  '/wagering/transactions', status, operation, `${runId}:${operation.externalTransactionId}`,
);

const bet = input('BET', 'bet', '80.00');
const processed = await submit(bet);
assert.equal(processed.balance.amount, '20.00');
const replay = await submit(bet);
assert.equal(replay.transactionId, processed.transactionId);
assert.equal(replay.idempotentReplay, true);
const rejected = await submit(input('BET', 'insufficient', '80.00'), 422);
assert.equal(rejected.failureCode, 'INSUFFICIENT_FUNDS');
await submit(input('LOSS', 'loss', '0.00'));
await submit(input('WIN', 'win', '20.00', 'bet'));
await submit(input('REFUND', 'refund', '80.00', 'bet'));
await submit(input('ROLLBACK', 'rollback-win', '20.00', 'win'));

const pending = await submit(input('REFUND', 'early-refund', '10.00', 'late-bet'), 202);
assert.equal(pending.status, 'PENDING_REFERENCE');
await submit(input('BET', 'late-bet', '10.00'));

async function waitForProcessed(path: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(5000) });
    if (response.ok && (await response.json() as { status: string }).status === 'PROCESSED') return;
    if (!response.ok && response.status !== 404) throw new Error(`Consulta falhou: HTTP ${response.status}.`);
    await Bun.sleep(100);
  }
  throw new Error('Worker não concluiu a operação em 20 segundos. Execute bun run start:worker em outro terminal.');
}
await waitForProcessed(`/wagering/transactions/${pending.transactionId}`);

const sqs = createSqsClient();
try {
  const queue = await sqs.send(new GetQueueUrlCommand({ QueueName: 'wager-transactions.fifo' }), { abortSignal: AbortSignal.timeout(5000) });
  const asynchronous = input('LOSS', 'sqs-loss', '0.00');
  await sqs.send(new SendMessageCommand({
    QueueUrl: queue.QueueUrl!, MessageGroupId: wallet.id, MessageDeduplicationId: runId,
    MessageBody: JSON.stringify({ messageId: runId, type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(),
      correlationId: runId, data: { ...asynchronous, idempotencyKey: `${runId}:sqs-loss` } }),
  }), { abortSignal: AbortSignal.timeout(5000) });
  await waitForProcessed(`/providers/${asynchronous.providerId}/wagering/transactions/sqs-loss`);
} finally { sqs.destroy(); }

const reconciliation = await request<{ consistent: boolean; storedBalance: { amount: string }; difference: { amount: string } }>(
  `/wallets/${wallet.id}/reconciliation`, 200, {},
);
assert.equal(reconciliation.consistent, true);
assert.equal(reconciliation.storedBalance.amount, '100.00');
assert.equal(reconciliation.difference.amount, '0.00');
const ledger = await request<{ entries: unknown[] }>(`/wallets/${wallet.id}/ledger`, 200);
assert.equal(ledger.entries.length, 7);
console.log(JSON.stringify({ result: 'Demonstração concluída', walletId: wallet.id, balance: '100.00 BRL', ledgerEntries: ledger.entries.length,
  scenarios: ['BET', 'replay', 'rejeição', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK', 'referência fora de ordem', 'SQS', 'reconciliação'] }, null, 2));

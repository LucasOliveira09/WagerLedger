import { defineEntity, p } from '@mikro-orm/core';
import { Money } from '../../domain/money.js';
import { WagerTransaction } from '../../domain/wager-transaction.js';
import type { WagerKind, WagerStatus } from '../../domain/wager-transaction.js';
import type { FailureCode } from '../../domain/failure-code.js';
import type { InferEntity } from '@mikro-orm/core';

export const TransactionRecord = defineEntity({
  name: 'TransactionRecord', tableName: 'wager_transactions',
  properties: {
    id: p.uuid().primary(), providerId: p.string().fieldName('provider_id'), externalTransactionId: p.string().fieldName('external_transaction_id'),
    idempotencyKey: p.string().fieldName('idempotency_key'), payloadHash: p.string().fieldName('payload_hash'),
    walletId: p.uuid().fieldName('wallet_id'), playerId: p.uuid().fieldName('player_id'), roundId: p.string().fieldName('round_id'), gameId: p.string().fieldName('game_id'),
    kind: p.string(), amount: p.decimal('string').precision(20).scale(2), currency: p.string(), status: p.string(),
    referenceExternalTransactionId: p.string().fieldName('reference_external_transaction_id').nullable(), referenceTransactionId: p.uuid().fieldName('reference_transaction_id').nullable(),
    failureCode: p.string().fieldName('failure_code').nullable(), processedAt: p.datetime().fieldName('processed_at').nullable(),
    createdAt: p.datetime().fieldName('created_at'), responseSnapshot: p.json().fieldName('response_snapshot').nullable(),
    referenceAttempts: p.integer().fieldName('reference_attempts'), nextAttemptAt: p.datetime().fieldName('next_attempt_at').nullable(),
  },
});
export type TransactionRecordType = InferEntity<typeof TransactionRecord>;
export function rehydrateTransaction(row: TransactionRecordType): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: row.id, providerId: row.providerId, externalTransactionId: row.externalTransactionId, idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash, walletId: row.walletId, playerId: row.playerId, roundId: row.roundId, gameId: row.gameId,
    kind: row.kind as WagerKind, status: row.status as WagerStatus, money: Money.rehydrate({ amount: row.amount, currency: row.currency }), createdAt: row.createdAt,
    ...(row.referenceExternalTransactionId ? { referenceExternalTransactionId: row.referenceExternalTransactionId } : {}),
    ...(row.referenceTransactionId ? { referenceTransactionId: row.referenceTransactionId } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode as FailureCode } : {}), ...(row.processedAt ? { processedAt: row.processedAt } : {}),
  });
}

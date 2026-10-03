import { expect, test } from 'bun:test';
import { WagerTransaction } from '../../src/domain/wager-transaction.js';
import { Wallet } from '../../src/domain/wallet.js';
import { Money } from '../../src/domain/money.js';
import { WagerTransactionProcessed } from '../../src/domain/events/wager-transaction-processed.js';
import { WagerTransactionRejected } from '../../src/domain/events/wager-transaction-rejected.js';
import { WagerTransactionPendingReference } from '../../src/domain/events/wager-transaction-pending-reference.js';

test('eventos concretos geram envelope estável, versionado e sem instâncias Money', () => {
  const wallet = Wallet.open({
    id: crypto.randomUUID(),
    playerId: crypto.randomUUID(),
    initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
  });
  const props = {
    id: crypto.randomUUID(),
    providerId: 'provider',
    externalTransactionId: 'external',
    idempotencyKey: 'key',
    payloadHash: 'hash',
    walletId: wallet.id,
    playerId: wallet.playerId,
    roundId: 'round',
    gameId: 'game',
    kind: 'BET' as const,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
  };
  const processed = WagerTransaction.create(props);
  processed.markProcessed(undefined, new Date());
  const event = WagerTransactionProcessed.from(processed, wallet, { correlationId: 'correlation' });
  expect(event.toJSON().version).toBe(1);
  expect(event.toJSON().eventType).toBe('WagerTransactionProcessed');
  expect(event.toJSON().data.money).toEqual({ amount: '25.00', currency: 'BRL' });
  const copy = event.toJSON();
  copy.data.money.amount = '999.00';
  expect(event.toJSON().data.money.amount).toBe('25.00');
  const rejected = WagerTransaction.create(props);
  rejected.reject('INSUFFICIENT_FUNDS');
  expect(
    WagerTransactionRejected.from(rejected, wallet, { correlationId: 'correlation' }).toJSON().data
      .failureCode,
  ).toBe('INSUFFICIENT_FUNDS');
  const pending = WagerTransaction.create({
    ...props,
    kind: 'REFUND',
    referenceExternalTransactionId: 'bet',
  });
  pending.markPendingReference();
  expect(
    WagerTransactionPendingReference.from(pending, wallet, {
      correlationId: 'correlation',
    }).toJSON().eventType,
  ).toBe('WagerTransactionPendingReference');
});

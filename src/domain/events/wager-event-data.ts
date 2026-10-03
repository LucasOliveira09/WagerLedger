import { DomainError } from '../domain-error.js';
import type { WagerTransaction, WagerStatus, WagerKind } from '../wager-transaction.js';
import type { Wallet } from '../wallet.js';
import type { MoneyProps } from '../money.js';
import type { FailureCode } from '../failure-code.js';
import type { EventContext, IntegrationEventProps } from './integration-event.js';

export interface WagerEventData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  kind: WagerKind;
  status: WagerStatus;
  money: MoneyProps;
  balance: MoneyProps;
  failureCode?: FailureCode;
}

export function wagerEventProps(
  tx: WagerTransaction,
  wallet: Wallet,
  context: EventContext,
  status: WagerStatus,
): IntegrationEventProps<WagerEventData> {
  if (tx.status !== status) {
    throw new DomainError(
      'INVALID_TRANSACTION_STATE',
      'Evento incompatível com estado da transação.',
    );
  }

  return {
    eventId: crypto.randomUUID(),
    aggregateId: wallet.id,
    occurredAt: new Date(),
    ...context,
    data: {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      kind: tx.kind,
      status: tx.status,
      money: tx.money.toJSON(),
      balance: wallet.balance.toJSON(),
      ...(tx.failureCode ? { failureCode: tx.failureCode } : {}),
    },
  };
}

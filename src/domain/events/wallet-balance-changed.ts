import { IntegrationEvent } from './integration-event.js';
import { DomainError } from '../domain-error.js';
import type { EventContext, IntegrationEventProps } from './integration-event.js';
import type { Wallet } from '../wallet.js';
import type { WalletLedgerEntry, LedgerDirection } from '../wallet-ledger-entry.js';
import type { MoneyProps } from '../money.js';

export interface WalletBalanceChangedData {
  walletId: string; transactionId: string; direction: LedgerDirection; money: MoneyProps;
  balanceBefore: MoneyProps; balanceAfter: MoneyProps; walletVersion: number;
}
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;
  private constructor(props: IntegrationEventProps<WalletBalanceChangedData>) { super(props); Object.freeze(this); }
  static from(wallet: Wallet, entry: WalletLedgerEntry, context: EventContext): WalletBalanceChanged {
    if (entry.walletId !== wallet.id || !entry.balanceAfter.equals(wallet.balance) || entry.balanceBefore.equals(entry.balanceAfter)) {
      throw new DomainError('INVALID_BALANCE_EVENT', 'Evento exige movimentação correspondente à carteira.');
    }
    return new WalletBalanceChanged({ eventId: crypto.randomUUID(), aggregateId: wallet.id, occurredAt: entry.createdAt, ...context,
      data: { walletId: wallet.id, transactionId: entry.transactionId, direction: entry.direction, money: entry.money.toJSON(), balanceBefore: entry.balanceBefore.toJSON(), balanceAfter: entry.balanceAfter.toJSON(), walletVersion: wallet.version } });
  }
}

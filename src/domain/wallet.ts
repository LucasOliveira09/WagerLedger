import { DomainError } from './domain-error.js';
import type { Money } from './money.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';
import type { LedgerDirection } from './wallet-ledger-entry.js';

export interface WalletState {
  id: string; playerId: string; currency: string; balance: Money;
  version: number; createdAt: Date; updatedAt: Date;
}
export interface MovementContext { id: string; transactionId: string; at?: Date }

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  private _balance: Money;
  private _version: number;
  private readonly creationTimestamp: number;
  private updateTimestamp: number;

  private constructor(state: WalletState) {
    this.id = state.id; this.playerId = state.playerId; this.currency = state.currency;
    this._balance = state.balance; this._version = state.version;
    this.creationTimestamp = state.createdAt.getTime(); this.updateTimestamp = state.updatedAt.getTime();
  }

  static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    if (props.initialBalance.isNegative()) throw new DomainError('INVALID_MONEY', 'Saldo inicial não pode ser negativo.');
    const now = new Date();
    return new Wallet({ id: props.id, playerId: props.playerId, currency: props.initialBalance.currency, balance: props.initialBalance, version: 1, createdAt: now, updatedAt: now });
  }

  static rehydrate(state: WalletState): Wallet { return new Wallet(state); }
  get balance(): Money { return this._balance; }
  get version(): number { return this._version; }
  get createdAt(): Date { return new Date(this.creationTimestamp); }
  get updatedAt(): Date { return new Date(this.updateTimestamp); }
  debit(money: Money, context: MovementContext): WalletLedgerEntry { return this.move('DEBIT', money, context); }
  credit(money: Money, context: MovementContext): WalletLedgerEntry { return this.move('CREDIT', money, context); }

  private move(direction: LedgerDirection, money: Money, context: MovementContext): WalletLedgerEntry {
    if (money.currency !== this.currency) throw new DomainError('CURRENCY_MISMATCH', 'Moeda incompatível com a carteira.');
    if (!money.isPositive()) throw new DomainError('INVALID_AMOUNT', 'Movimentações exigem valor positivo.');
    const balanceAfter = direction === 'DEBIT' ? this.balance.subtract(money) : this.balance.add(money);
    if (balanceAfter.isNegative()) throw new DomainError('INSUFFICIENT_FUNDS', 'Saldo insuficiente.');
    const at = context.at ?? new Date();
    const entry = WalletLedgerEntry.create({ id: context.id, transactionId: context.transactionId, walletId: this.id, direction, money, balanceBefore: this.balance, balanceAfter, sequence: this.version + 1, createdAt: at });
    this._balance = balanceAfter; this._version++; this.updateTimestamp = at.getTime();
    return entry;
  }
}

import { DomainError } from './domain-error.js';
import type { Money } from './money.js';

export type LedgerDirection = 'DEBIT' | 'CREDIT';
export interface LedgerEntryState {
  id: string; walletId: string; transactionId: string; direction: LedgerDirection;
  money: Money; balanceBefore: Money; balanceAfter: Money; sequence: number; createdAt: Date;
}

/** Registro imutável de uma movimentação; correções exigem um novo lançamento compensatório. */
export class WalletLedgerEntry {
  public readonly id: string;
  public readonly walletId: string;
  public readonly transactionId: string;
  public readonly direction: LedgerDirection;
  public readonly money: Money;
  public readonly balanceBefore: Money;
  public readonly balanceAfter: Money;
  public readonly sequence: number;
  private readonly timestamp: number;

  private constructor(state: LedgerEntryState) {
    this.id = state.id; this.walletId = state.walletId; this.transactionId = state.transactionId;
    this.direction = state.direction; this.money = state.money;
    this.balanceBefore = state.balanceBefore; this.balanceAfter = state.balanceAfter;
    this.sequence = state.sequence; this.timestamp = state.createdAt.getTime();
    Object.freeze(this);
  }

  static create(state: LedgerEntryState): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(state);
    if (!state.money.isPositive() || state.balanceBefore.isNegative() || state.balanceAfter.isNegative() || !entry.isBalanced()) {
      throw new DomainError('INVALID_LEDGER', 'Lançamento financeiro inválido.');
    }
    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry { return new WalletLedgerEntry(state); }
  get createdAt(): Date { return new Date(this.timestamp); }
  // Confere a equação local do lançamento, não a soma de todo o histórico da carteira.
  isBalanced(): boolean {
    const expected = this.direction === 'DEBIT' ? this.balanceBefore.subtract(this.money) : this.balanceBefore.add(this.money);
    return expected.equals(this.balanceAfter);
  }
}

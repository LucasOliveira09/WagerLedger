import type { MoneyProps } from '../../domain/money.js';
import type { WagerTransaction } from '../../domain/wager-transaction.js';

export interface WalletView { id: string; playerId: string; balance: MoneyProps; version: number }
export interface LedgerView { id: string; walletId: string; transactionId: string; direction: string; money: MoneyProps; balanceBefore: MoneyProps; balanceAfter: MoneyProps; sequence: number; createdAt: string }
export interface FinancialReadStore {
  wallet(id: string): Promise<WalletView | undefined>;
  transaction(id: string): Promise<WagerTransaction | undefined>;
  external(providerId: string, externalId: string): Promise<WagerTransaction | undefined>;
  ledger(walletId: string, after: number, through: number, limit: number): Promise<LedgerView[]>;
}

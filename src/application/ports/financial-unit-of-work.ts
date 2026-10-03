import type { Wallet } from '../../domain/wallet.js';
import type { WagerTransaction } from '../../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../domain/outbox-message.js';
import type { SubmissionResult } from '../transaction-result.js';

export interface FinancialSession {
  readonly wallet: Wallet | undefined;
  addWallet(wallet: Wallet): Promise<void>;
  saveWallet(wallet: Wallet): Promise<void>;
  saveTransaction(tx: WagerTransaction, snapshot?: SubmissionResult): Promise<void>;
  appendLedger(entry: WalletLedgerEntry): Promise<void>;
  appendOutbox(messages: readonly OutboxMessage[]): Promise<void>;
}
export interface FinancialUnitOfWork {
  run<T>(walletId: string | undefined, operation: (session: FinancialSession) => Promise<T>): Promise<T>;
}

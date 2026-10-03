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
  transactionByKey(key: string): Promise<StoredTransaction | undefined>;
  transactionByExternal(providerId: string, externalTransactionId: string): Promise<StoredTransaction | undefined>;
  reversalExists(referenceId: string, kind: 'REFUND' | 'ROLLBACK'): Promise<boolean>;
  transactionById(id: string): Promise<StoredTransaction | undefined>;
  scheduleReference(id: string, attempts: number, nextAttemptAt: Date | undefined): Promise<void>;
}
export interface StoredTransaction { transaction: WagerTransaction; snapshot: SubmissionResult | null; referenceAttempts?: number; nextAttemptAt?: Date }
export interface FinancialUnitOfWork {
  run<T>(walletId: string | undefined, operation: (session: FinancialSession) => Promise<T>): Promise<T>;
}

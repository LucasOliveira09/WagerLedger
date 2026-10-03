import type { Wallet } from '../../domain/wallet.js';

export interface FinancialSession {
  readonly wallet: Wallet | undefined;
  addWallet(wallet: Wallet): Promise<void>;
  saveWallet(wallet: Wallet): Promise<void>;
}
export interface FinancialUnitOfWork {
  run<T>(walletId: string | undefined, operation: (session: FinancialSession) => Promise<T>): Promise<T>;
}

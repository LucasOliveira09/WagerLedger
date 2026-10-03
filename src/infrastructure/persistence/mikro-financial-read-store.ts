import type { MikroORM } from '@mikro-orm/postgresql';
import type { FinancialReadStore, LedgerView } from '../../application/ports/financial-read-store.js';
import { WalletRecord } from './wallet-mapping.js';
import { TransactionRecord, rehydrateTransaction } from './transaction-mapping.js';

interface LedgerRow { id: string; wallet_id: string; transaction_id: string; direction: string; amount: string; currency: string; balance_before: string; balance_after: string; sequence: number; created_at: Date }
export class MikroFinancialReadStore implements FinancialReadStore {
  constructor(private readonly orm: MikroORM) {}
  async wallet(id: string) {
    const row = await this.orm.em.fork().findOne(WalletRecord, { id });
    return row ? { id: row.id, playerId: row.playerId, balance: { amount: row.balance, currency: row.currency }, version: row.version } : undefined;
  }
  async transaction(id: string) {
    const row = await this.orm.em.fork().findOne(TransactionRecord, { id });
    return row ? rehydrateTransaction(row) : undefined;
  }
  async external(providerId: string, externalTransactionId: string) {
    const row = await this.orm.em.fork().findOne(TransactionRecord, { providerId, externalTransactionId });
    return row ? rehydrateTransaction(row) : undefined;
  }
  async ledger(walletId: string, after: number, through: number, limit: number): Promise<LedgerView[]> {
    const rows = await this.orm.em.fork().execute<LedgerRow[]>('select * from wallet_ledger where wallet_id=? and sequence>? and sequence<=? order by sequence limit ?', [walletId, after, through, limit]);
    return rows.map(row => ({ id: row.id, walletId: row.wallet_id, transactionId: row.transaction_id, direction: row.direction, money: { amount: row.amount, currency: row.currency }, balanceBefore: { amount: row.balance_before, currency: row.currency }, balanceAfter: { amount: row.balance_after, currency: row.currency }, sequence: row.sequence, createdAt: new Date(row.created_at).toISOString() }));
  }
}

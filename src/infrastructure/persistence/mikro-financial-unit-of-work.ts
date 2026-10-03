import { LockMode } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { FinancialSession, FinancialUnitOfWork } from '../../application/ports/financial-unit-of-work.js';
import type { Wallet } from '../../domain/wallet.js';
import { DomainError } from '../../domain/domain-error.js';
import { WalletRecord, rehydrateWallet } from './wallet-mapping.js';
import { TransactionRecord } from './transaction-mapping.js';
import type { WagerTransaction } from '../../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../domain/outbox-message.js';
import type { SubmissionResult } from '../../application/transaction-result.js';

class MikroFinancialSession implements FinancialSession {
  constructor(private readonly em: EntityManager, public readonly wallet: Wallet | undefined) {}

  async addWallet(wallet: Wallet): Promise<void> {
    const record = this.em.create(WalletRecord, { id: wallet.id, playerId: wallet.playerId, currency: wallet.currency, balance: wallet.balance.toString(), version: wallet.version, createdAt: wallet.createdAt, updatedAt: wallet.updatedAt });
    this.em.persist(record);
    await this.em.flush();
  }
  async saveWallet(wallet: Wallet): Promise<void> {
    const record = await this.em.findOneOrFail(WalletRecord, { id: wallet.id });
    this.em.assign(record, { balance: wallet.balance.toString(), version: wallet.version, updatedAt: wallet.updatedAt });
    await this.em.flush();
  }
  async saveTransaction(tx: WagerTransaction, snapshot?: SubmissionResult): Promise<void> {
    const existing = await this.em.findOne(TransactionRecord, { id: tx.id });
    const data = { id: tx.id, providerId: tx.providerId, externalTransactionId: tx.externalTransactionId, idempotencyKey: tx.idempotencyKey,
      payloadHash: tx.payloadHash, walletId: tx.walletId, playerId: tx.playerId, roundId: tx.roundId, gameId: tx.gameId, kind: tx.kind,
      amount: tx.money.toString(), currency: tx.money.currency, status: tx.status, referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
      referenceTransactionId: tx.referenceTransactionId ?? null, failureCode: tx.failureCode ?? null, processedAt: tx.processedAt ?? null,
      createdAt: tx.createdAt, responseSnapshot: existing?.responseSnapshot ?? snapshot ?? null,
      referenceAttempts: existing?.referenceAttempts ?? 0, nextAttemptAt: existing?.nextAttemptAt ?? null };
    if (existing) this.em.assign(existing, data); else this.em.persist(this.em.create(TransactionRecord, data));
    await this.em.flush();
  }
  async appendLedger(entry: WalletLedgerEntry): Promise<void> {
    await this.em.execute('insert into wallet_ledger(id,wallet_id,transaction_id,currency,direction,amount,balance_before,balance_after,sequence,created_at) values(?,?,?,?,?,?,?,?,?,?)',
      [entry.id, entry.walletId, entry.transactionId, entry.money.currency, entry.direction, entry.money.toString(), entry.balanceBefore.toString(), entry.balanceAfter.toString(), entry.sequence, entry.createdAt]);
  }
  async appendOutbox(messages: readonly OutboxMessage[]): Promise<void> {
    for (const message of messages) await this.em.execute('insert into outbox_messages(id,aggregate_id,event_type,payload,occurred_at,attempts) values(?,?,?,?,?,?)',
      [message.id, message.aggregateId, message.eventType, JSON.stringify(message.payload), message.occurredAt, message.attempts]);
  }
}

export class MikroFinancialUnitOfWork implements FinancialUnitOfWork {
  constructor(private readonly orm: MikroORM) {}

  async run<T>(walletId: string | undefined, operation: (session: FinancialSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.orm.em.fork().transactional(async em => {
          await em.execute("SET LOCAL lock_timeout = '2s'");
          await em.execute("SET LOCAL statement_timeout = '5s'");
          let wallet: Wallet | undefined;
          if (walletId) {
            const record = await em.findOne(WalletRecord, { id: walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            if (!record) throw new DomainError('WALLET_NOT_FOUND', 'Carteira inexistente.');
            wallet = rehydrateWallet(record);
          }
          return operation(new MikroFinancialSession(em, wallet));
        }, { clear: true });
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (attempt >= 2 || !['40P01', '40001', '55P03', '23505'].includes(code)) throw error;
        await Bun.sleep(20 * 2 ** attempt);
      }
    }
  }
}

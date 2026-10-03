import { LockMode } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { FinancialSession, FinancialUnitOfWork } from '../../application/ports/financial-unit-of-work.js';
import type { Wallet } from '../../domain/wallet.js';
import { DomainError } from '../../domain/domain-error.js';
import { WalletRecord, rehydrateWallet } from './wallet-mapping.js';
import { TransactionRecord, rehydrateTransaction } from './transaction-mapping.js';
import type { WagerTransaction } from '../../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../domain/outbox-message.js';
import type { SubmissionResult } from '../../application/transaction-result.js';
import { InboxMessage } from '../../domain/inbox-message.js';
import { nullTelemetry } from '../../application/ports/telemetry.js';
import type { Telemetry } from '../../application/ports/telemetry.js';

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
  async transactionByKey(key: string) {
    const row = await this.em.findOne(TransactionRecord, { idempotencyKey: key });
    return row ? { transaction: rehydrateTransaction(row), snapshot: row.responseSnapshot as SubmissionResult | null } : undefined;
  }
  async transactionByExternal(providerId: string, externalTransactionId: string) {
    const row = await this.em.findOne(TransactionRecord, { providerId, externalTransactionId });
    return row ? { transaction: rehydrateTransaction(row), snapshot: row.responseSnapshot as SubmissionResult | null } : undefined;
  }
  async reversalExists(referenceId: string, kind: 'REFUND' | 'ROLLBACK'): Promise<boolean> {
    return (await this.em.count(TransactionRecord, { referenceTransactionId: referenceId, kind, status: 'PROCESSED' })) > 0;
  }
  async transactionById(id: string) {
    const row = await this.em.findOne(TransactionRecord, { id });
    return row ? { transaction: rehydrateTransaction(row), snapshot: row.responseSnapshot as SubmissionResult | null,
      referenceAttempts: row.referenceAttempts, ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : {}) } : undefined;
  }
  async scheduleReference(id: string, attempts: number, nextAttemptAt: Date | undefined): Promise<void> {
    const row = await this.em.findOneOrFail(TransactionRecord, { id });
    this.em.assign(row, { referenceAttempts: attempts, nextAttemptAt: nextAttemptAt ?? null });
    await this.em.flush();
  }
  async inbox(messageId: string, consumerName: string): Promise<InboxMessage | undefined> {
    const rows = await this.em.execute<{ payload_hash: string; received_at: Date; processed_at: Date | null }[]>('select payload_hash,received_at,processed_at from inbox_messages where message_id=? and consumer_name=?', [messageId, consumerName]);
    const row = rows[0];
    return row ? InboxMessage.rehydrate({ messageId, consumerName, payloadHash: row.payload_hash, receivedAt: new Date(row.received_at), ...(row.processed_at ? { processedAt: new Date(row.processed_at) } : {}) }) : undefined;
  }
  async saveInbox(message: InboxMessage): Promise<void> {
    await this.em.execute('insert into inbox_messages(message_id,consumer_name,payload_hash,received_at,processed_at) values(?,?,?,?,?)', [message.messageId, message.consumerName, message.payloadHash, message.receivedAt, message.processedAt ?? null]);
  }
}

export class MikroFinancialUnitOfWork implements FinancialUnitOfWork {
  constructor(private readonly orm: MikroORM, private readonly telemetry: Telemetry = nullTelemetry) {}

  async run<T>(walletId: string | undefined, operation: (session: FinancialSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.orm.em.fork().transactional(async em => {
          await em.execute("SET LOCAL lock_timeout = '2s'");
          await em.execute("SET LOCAL statement_timeout = '5s'");
          let wallet: Wallet | undefined;
          if (walletId) {
            const lockStarted = performance.now();
            const record = await em.findOne(WalletRecord, { id: walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            this.telemetry.observe('wallet_lock_wait_seconds', (performance.now() - lockStarted) / 1000);
            if (!record) throw new DomainError('WALLET_NOT_FOUND', 'Carteira inexistente.');
            wallet = rehydrateWallet(record);
          }
          return operation(new MikroFinancialSession(em, wallet));
        }, { clear: true });
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (['40P01', '55P03'].includes(code)) this.telemetry.count('lock_conflicts_total', { code });
        if (attempt >= 2 || !['40P01', '40001', '55P03', '23505'].includes(code)) throw error;
        this.telemetry.count('database_retries_total', { code });
        await Bun.sleep(20 * 2 ** attempt);
      }
    }
  }
}

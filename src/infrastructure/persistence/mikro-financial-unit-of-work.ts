import { LockMode } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { FinancialSession, FinancialUnitOfWork } from '../../application/ports/financial-unit-of-work.js';
import type { Wallet } from '../../domain/wallet.js';
import { DomainError } from '../../domain/domain-error.js';
import { WalletRecord, rehydrateWallet } from './wallet-mapping.js';

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

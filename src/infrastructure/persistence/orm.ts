import { MikroORM, defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Migration001 } from './migrations/001-wallet-ledger.js';
import { WalletRecord } from './wallet-mapping.js';
import { TransactionRecord } from './transaction-mapping.js';
import { Migration002 } from './migrations/002-transactions-messaging.js';

export const localMigrationUrl = 'postgresql://wagerledger:local-development-only@127.0.0.1:55432/wagerledger';
export const localDatabaseUrl = 'postgresql://wagerledger_app:local-development-only@127.0.0.1:55432/wagerledger';
export function ormOptions(clientUrl = process.env.DATABASE_URL ?? localDatabaseUrl) {
  return defineConfig({
    clientUrl, entities: [WalletRecord, TransactionRecord], extensions: [Migrator],
    migrations: { migrationsList: [Migration001, Migration002], snapshot: false },
    pool: { min: 0, max: 10 },
    driverOptions: { connectionTimeoutMillis: 2000 },
  });
}
export function createOrm(clientUrl = process.env.DATABASE_URL ?? localDatabaseUrl) { return MikroORM.init(ormOptions(clientUrl)); }

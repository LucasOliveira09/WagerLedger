import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Migration001 } from './migrations/001-wallet-ledger.js';
import { WalletRecord } from './wallet-mapping.js';

export const localDatabaseUrl = 'postgresql://wagerledger:local-development-only@127.0.0.1:55432/wagerledger';
export function createOrm(clientUrl = process.env.DATABASE_URL ?? localDatabaseUrl) {
  return MikroORM.init({
    clientUrl, entities: [WalletRecord], extensions: [Migrator],
    migrations: { migrationsList: [Migration001], snapshot: false },
    pool: { min: 0, max: 10 },
  });
}

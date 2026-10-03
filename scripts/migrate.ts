import { createOrm, localMigrationUrl } from '../src/infrastructure/persistence/orm.js';

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') throw new Error('Use migrate.ts up ou down.');
const orm = await createOrm(process.env.MIGRATION_DATABASE_URL ?? localMigrationUrl);
try {
  if (direction === 'up') await orm.migrator.up(); else await orm.migrator.down();
} finally { await orm.close(); }

import { createOrm, localMigrationUrl } from '../../src/infrastructure/persistence/orm.js';

export async function createTestDatabase() {
  const name = `wagerledger_test_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!/^wagerledger_test_[a-f0-9]{32}$/.test(name)) throw new Error('Nome de banco de teste inválido.');
  const url = new URL(process.env.MIGRATION_DATABASE_URL ?? localMigrationUrl);
  const owner = await createOrm(url.toString());
  await owner.em.fork().execute(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const orm = await createOrm(url.toString());
  try { await orm.migrator.up(); }
  catch (error) {
    await orm.close();
    await owner.em.fork().execute(`DROP DATABASE "${name}" WITH (FORCE)`);
    await owner.close();
    throw error;
  }
  return {
    orm,
    url: url.toString(),
    appUrl: (() => { const appUrl = new URL(url); appUrl.username = 'wagerledger_app'; return appUrl.toString(); })(),
    async close() {
      await orm.close();
      await owner.em.fork().execute(`DROP DATABASE "${name}" WITH (FORCE)`);
      await owner.close();
    },
  };
}

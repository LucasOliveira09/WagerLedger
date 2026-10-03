import { expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { createTestDatabase } from '../support/test-database.js';
import { bootstrap } from '../../src/main.js';
import { createOrm, localMigrationUrl } from '../../src/infrastructure/persistence/orm.js';

test('health aberto separa liveness/readiness e métricas são consultáveis', async () => {
  const db = await createTestDatabase(); const app = await bootstrap({ databaseUrl: db.appUrl, port: 0, host: '127.0.0.1', quiet: true });
  try {
    const url = await app.getUrl();
    expect((await fetch(url + '/health/live')).status).toBe(200);
    expect((await fetch(url + '/health/ready')).status).toBe(200);
    const metrics = await fetch(url + '/metrics'); expect(metrics.status).toBe(200); expect(metrics.headers.get('content-type')).toContain('text/plain');
    const databaseName = new URL(db.url).pathname.slice(1);
    if (!/^wagerledger_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Banco descartável esperado.');
    const admin = await createOrm(process.env.MIGRATION_DATABASE_URL ?? localMigrationUrl);
    try { await admin.em.fork().execute(`alter database "${databaseName}" allow_connections false`); }
    finally { await admin.close(); }
    await app.get(MikroORM).close();
    expect((await fetch(url + '/health/ready')).status).toBe(503); expect((await fetch(url + '/health/live')).status).toBe(200);
  } finally { await app.close(); await db.close(); }
}, 30000);

test('readiness falha quando SQS real está inalcançável', async () => {
  const db = await createTestDatabase(); const app = await bootstrap({ databaseUrl: db.appUrl, sqsEndpoint: 'http://127.0.0.1:1', port: 0, host: '127.0.0.1', quiet: true });
  try {
    const url = await app.getUrl(); const response = await fetch(url + '/health/ready');
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ status: 'not_ready', postgres: true, sqs: false });
    expect((await fetch(url + '/health/live')).status).toBe(200);
  } finally { await app.close(); await db.close(); }
}, 30000);

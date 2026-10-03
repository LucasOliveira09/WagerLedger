import { expect, test } from 'bun:test';
import { startLoadService } from '../load/services.js';
import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { eventually } from '../support/process-harness.js';

test('serviços de carga usam subprocessos, role limitada e publicação em recursos próprios', async () => {
  const db = await createTestDatabase(); const queues = await createTestQueues();
  const services: Awaited<ReturnType<typeof startLoadService>>[] = [];
  try {
    const api = await startLoadService({ role: 'api', databaseUrl: db.appUrl }); services.push(api);
    const publisher = await startLoadService({ role: 'publisher', databaseUrl: db.appUrl,
      queueUrls: { wagers: queues.wagers, dlq: queues.dlq, events: queues.events } }); services.push(publisher);
    expect(new Set([process.pid, api.pid, publisher.pid]).size).toBe(3);
    expect((await fetch(api.url + '/health/live')).status).toBe(200);
    expect((await fetch(publisher.url + '/health/ready')).status).toBe(200);
    const response = await fetch(api.url + '/wallets', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }) });
    expect(response.status).toBe(201);
    await eventually(async () => (await db.orm.em.fork().execute('select id from outbox_messages where published_at is null')).length === 0);
    expect(await db.orm.em.fork().execute('select id from outbox_messages where published_at is not null')).toHaveLength(2);
    await Promise.all(services.map(service => service.stop()));
  } finally {
    await Promise.allSettled(services.map(service => service.stop()));
    await queues.close(); await db.close();
  }
}, 30000);

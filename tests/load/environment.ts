import { createTestDatabase } from '../support/test-database.js';
import { createTestQueues } from '../support/test-queues.js';
import { startLoadService } from './services.js';
import type { createOrm } from '../../src/infrastructure/persistence/orm.js';

export async function createLoadEnvironment() {
  const db = await createTestDatabase();
  let queues: Awaited<ReturnType<typeof createTestQueues>> | undefined;
  const services: Awaited<ReturnType<typeof startLoadService>>[] = [];
  const close = async () => {
    const results = await Promise.allSettled(services.map((service) => service.stop()));

    try {
      await queues?.close();
    } finally {
      await db.close();
    }
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Falha ao encerrar serviço de carga.');
    }
  };

  try {
    queues = await createTestQueues();
    const api = await startLoadService({ role: 'api', databaseUrl: db.appUrl });
    services.push(api);
    const publisher = await startLoadService({
      role: 'publisher',
      databaseUrl: db.appUrl,
      queueUrls: { wagers: queues.wagers, dlq: queues.dlq, events: queues.events },
    });
    services.push(publisher);
    const version = await db.orm.em
      .fork()
      .execute<{ server_version: string }[]>('show server_version');

    return { db, api, publisher, postgresVersion: version[0]!.server_version, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export type LoadEnvironment = Awaited<ReturnType<typeof createLoadEnvironment>>;

export async function auditOutbox(orm: Awaited<ReturnType<typeof createOrm>>) {
  const [row] = await orm.em.fork().execute<
    { expected: string; total: string; invalid: string }[]
  >(`
    with expected as (
      select id, wallet_id from wager_transactions where status='PROCESSED' and kind in ('OPENING','BET')
    ), audited as (
      select t.id, count(o.id) as total,
        count(o.id) filter (where o.event_type='WagerTransactionProcessed') as processed,
        count(o.id) filter (where o.event_type='WalletBalanceChanged') as changed
      from expected t left join outbox_messages o on o.payload->'data'->>'transactionId'=t.id::text
        and o.aggregate_id=t.wallet_id
      group by t.id
    )
    select (select count(*)*2 from expected)::text as expected,
      (select count(*) from outbox_messages)::text as total,
      (select count(*) from audited where total<>2 or processed<>1 or changed<>1)::text as invalid`);
  const expectedEvents = Number(row!.expected);
  const totalEvents = Number(row!.total);
  const invalidTransactions = Number(row!.invalid);

  return {
    expectedEvents,
    totalEvents,
    invalidTransactions,
    consistent: expectedEvents === totalEvents && invalidTransactions === 0,
  };
}

export async function outboxSnapshot(environment: LoadEnvironment) {
  const rows = await environment.db.orm.em
    .fork()
    .execute<{ total: string; pending: string }[]>(
      'select count(*)::text as total,count(*) filter (where published_at is null)::text as pending from outbox_messages',
    );

  return { totalEvents: Number(rows[0]!.total), pendingEvents: Number(rows[0]!.pending) };
}

export async function drainOutbox(
  environment: LoadEnvironment,
  timeoutMs: number,
  signal: AbortSignal,
) {
  const started = performance.now();

  for (;;) {
    signal.throwIfAborted();
    const snapshot = await outboxSnapshot(environment);

    if (snapshot.pendingEvents === 0 || performance.now() - started >= timeoutMs) {
      return {
        ...snapshot,
        drained: snapshot.pendingEvents === 0,
        elapsedMs: performance.now() - started,
      };
    }

    await Bun.sleep(100);
  }
}

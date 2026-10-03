import 'reflect-metadata';
import { GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { createOrm } from './infrastructure/persistence/orm.js';
import { createSqsClient } from './infrastructure/messaging/sqs-client.js';
import { MikroFinancialUnitOfWork } from './infrastructure/persistence/mikro-financial-unit-of-work.js';
import { ProcessWager } from './application/process-wager.js';
import { RetryPendingReference } from './application/retry-pending-reference.js';
import { WagerConsumer } from './interfaces/workers/wager-consumer.js';
import type { ConsumerOptions } from './interfaces/workers/wager-consumer.js';
import { ReferenceWorker } from './interfaces/workers/reference-worker.js';
import { OutboxPublisher } from './interfaces/workers/outbox-publisher.js';
import { SqsEventPublisher } from './infrastructure/messaging/event-publisher.js';
import { WorkerLifecycle } from './interfaces/workers/worker-lifecycle.js';
import { telemetry } from './infrastructure/observability/telemetry.js';
import type { OutboxMessage } from './domain/outbox-message.js';
import { HealthService } from './infrastructure/observability/health-service.js';

type WorkerRole = 'consumer' | 'publisher' | 'reference';
export interface WorkerOptions {
  databaseUrl?: string; queueUrls?: { wagers: string; dlq: string; events: string }; roles?: readonly WorkerRole[];
  waitTimeSeconds?: number; visibilitySeconds?: number; onCommitted?: ConsumerOptions['onCommitted']; onPublished?: (message: OutboxMessage) => Promise<void>;
  beforePublish?: (message: OutboxMessage) => Promise<void>;
  metricsPort?: number;
}
export async function bootstrapWorkers(options: WorkerOptions = {}) {
  const roles = options.roles ?? (process.env.WORKER_ROLES ?? 'consumer,publisher,reference').split(',') as WorkerRole[];
  if (!roles.length || roles.some(role => !['consumer', 'publisher', 'reference'].includes(role))) throw new Error('WORKER_ROLES inválido.');
  const metricsPort = options.metricsPort ?? (process.env.METRICS_PORT === undefined ? undefined : Number(process.env.METRICS_PORT));
  if (metricsPort !== undefined && (!Number.isInteger(metricsPort) || metricsPort < 0 || metricsPort > 65535)) throw new Error('METRICS_PORT inválido.');
  const orm = await createOrm(options.databaseUrl); const client = createSqsClient();
  try {
    const getQueue = async (name: string) => (await client.send(new GetQueueUrlCommand({ QueueName: name }), { abortSignal: AbortSignal.timeout(5000) })).QueueUrl!;
    const urls = options.queueUrls ?? { wagers: await getQueue('wager-transactions.fifo'), dlq: await getQueue('wager-transactions-dlq.fifo'), events: await getQueue('wager-events.fifo') };
    const uow = new MikroFinancialUnitOfWork(orm, telemetry);
    const workers = roles.map(role => {
      if (role === 'publisher') return new OutboxPublisher(orm, new SqsEventPublisher(client, urls.events), options.onPublished, options.beforePublish, telemetry);
      if (role === 'reference') return new ReferenceWorker(orm, new RetryPendingReference(uow, undefined, telemetry));
      return new WagerConsumer(client, new ProcessWager(uow, telemetry), { queueUrl: urls.wagers, dlqUrl: urls.dlq,
        ...(options.waitTimeSeconds !== undefined ? { waitTimeSeconds: options.waitTimeSeconds } : {}),
        ...(options.visibilitySeconds !== undefined ? { visibilitySeconds: options.visibilitySeconds } : {}),
        ...(options.onCommitted ? { onCommitted: options.onCommitted } : {}) }, telemetry);
    });
    const lifecycle = new WorkerLifecycle(workers);
    const health = new HealthService(orm, client, Object.values(urls));
    const server = metricsPort === undefined ? undefined : Bun.serve({ port: metricsPort, hostname: '0.0.0.0', async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/health/live') return Response.json({ status: 'alive' });
      if (path === '/health/ready') { const result = await health.ready(); return Response.json(result, { status: result.status === 'ready' ? 200 : 503 }); }
      if (path === '/metrics') return new Response(telemetry.render(), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' } });
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Endpoint inexistente.' } }, { status: 404 });
    } });
    const stop = () => lifecycle.requestStop();
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    const finished = lifecycle.run().finally(async () => {
      process.off('SIGTERM', stop); process.off('SIGINT', stop);
      await server?.stop();
      client.destroy(); await orm.close(); telemetry.log('info', 'workers_stopped', {});
    });
    telemetry.log('info', 'workers_started', {});
    return { stop, finished, metricsUrl: server?.url.toString() };
  } catch (error) { client.destroy(); await orm.close(); throw error; }
}
if (import.meta.main) await (await bootstrapWorkers()).finished;

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

type WorkerRole = 'consumer' | 'publisher' | 'reference';
export interface WorkerOptions {
  databaseUrl?: string; queueUrls?: { wagers: string; dlq: string; events: string }; roles?: readonly WorkerRole[];
  waitTimeSeconds?: number; visibilitySeconds?: number; onCommitted?: ConsumerOptions['onCommitted']; onPublished?: (message: OutboxMessage) => Promise<void>;
}
export async function bootstrapWorkers(options: WorkerOptions = {}) {
  const roles = options.roles ?? (process.env.WORKER_ROLES ?? 'consumer,publisher,reference').split(',') as WorkerRole[];
  if (!roles.length || roles.some(role => !['consumer', 'publisher', 'reference'].includes(role))) throw new Error('WORKER_ROLES inválido.');
  const orm = await createOrm(options.databaseUrl); const client = createSqsClient();
  try {
    const getQueue = async (name: string) => (await client.send(new GetQueueUrlCommand({ QueueName: name }), { abortSignal: AbortSignal.timeout(5000) })).QueueUrl!;
    const urls = options.queueUrls ?? { wagers: await getQueue('wager-transactions.fifo'), dlq: await getQueue('wager-transactions-dlq.fifo'), events: await getQueue('wager-events.fifo') };
    const uow = new MikroFinancialUnitOfWork(orm);
    const workers = roles.map(role => {
      if (role === 'publisher') return new OutboxPublisher(orm, new SqsEventPublisher(client, urls.events), options.onPublished);
      if (role === 'reference') return new ReferenceWorker(orm, new RetryPendingReference(uow));
      return new WagerConsumer(client, new ProcessWager(uow), { queueUrl: urls.wagers, dlqUrl: urls.dlq,
        ...(options.waitTimeSeconds !== undefined ? { waitTimeSeconds: options.waitTimeSeconds } : {}),
        ...(options.visibilitySeconds !== undefined ? { visibilitySeconds: options.visibilitySeconds } : {}),
        ...(options.onCommitted ? { onCommitted: options.onCommitted } : {}) });
    });
    const lifecycle = new WorkerLifecycle(workers);
    const stop = () => lifecycle.requestStop();
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    const finished = lifecycle.run().finally(async () => {
      process.off('SIGTERM', stop); process.off('SIGINT', stop);
      client.destroy(); await orm.close(); telemetry.log('info', 'workers_stopped', {});
    });
    telemetry.log('info', 'workers_started', {});
    return { stop, finished };
  } catch (error) { client.destroy(); await orm.close(); throw error; }
}
if (import.meta.main) await (await bootstrapWorkers()).finished;

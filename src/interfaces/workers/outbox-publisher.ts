import type { MikroORM } from '@mikro-orm/postgresql';
import type { EventPublisher } from '../../application/ports/event-publisher.js';
import type { EventEnvelope } from '../../domain/events/integration-event.js';
import { OutboxMessage } from '../../domain/outbox-message.js';
import { nullTelemetry } from '../../application/ports/telemetry.js';
import type { Telemetry } from '../../application/ports/telemetry.js';

interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: EventEnvelope<unknown>;
  occurred_at: Date;
  attempts: number;
  next_attempt_at: Date | null;
}

export class OutboxPublisher {
  constructor(
    private readonly orm: MikroORM,
    private readonly publisher: EventPublisher,
    private readonly afterPublished?: (message: OutboxMessage) => Promise<void>,
    private readonly beforePublish?: (message: OutboxMessage) => Promise<void>,
    private readonly telemetry: Telemetry = nullTelemetry,
  ) {}

  async tick(now = new Date()): Promise<boolean> {
    return this.orm.em.fork().transactional(
      async (em) => {
        await em.execute("SET LOCAL statement_timeout = '10s'");
        const lag = await em.execute<{ seconds: string }[]>(
          'select coalesce(extract(epoch from (?::timestamptz-min(occurred_at))),0) as seconds from outbox_messages where published_at is null',
          [now],
        );
        this.telemetry.gauge('outbox_lag_seconds', Math.max(0, Number(lag[0]!.seconds)));
        // Publishers concorrentes ignoram linhas já bloqueadas. O lock fica retido durante
        // o envio, com timeout de rede; isso evita dois publishers pegarem a mesma linha ativa.
        const rows = await em.execute<OutboxRow[]>(
          'select * from outbox_messages where published_at is null and (next_attempt_at is null or next_attempt_at<=?) order by occurred_at,id limit 1 for update skip locked',
          [now],
        );
        const row = rows[0];
        if (!row) {
          return false;
        }

        const message = OutboxMessage.rehydrate({
          id: row.id,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          payload: row.payload,
          occurredAt: new Date(row.occurred_at),
          attempts: row.attempts,
          ...(row.next_attempt_at ? { nextAttemptAt: new Date(row.next_attempt_at) } : {}),
        });
        await this.beforePublish?.(message);

        try {
          await this.publisher.publish(message, AbortSignal.timeout(5000));
        } catch {
          message.scheduleRetry(now);
          await em.execute('update outbox_messages set attempts=?,next_attempt_at=? where id=?', [
            message.attempts,
            message.nextAttemptAt!,
            message.id,
          ]);
          this.telemetry.count('outbox_publish_retries_total');
          this.telemetry.log('warn', 'outbox_retry_scheduled', {
            correlationId: message.payload.correlationId,
            walletId: message.aggregateId,
            attempt: message.attempts,
            code: 'PUBLISH_FAILED',
          });

          return true;
        }

        // Uma morte aqui pode repetir um envio já aceito pela SQS. O eventId persistido
        // continua igual: a entrega admite duplicatas e exige deduplicação no consumidor.
        await this.afterPublished?.(message);
        message.markPublished(new Date());
        await em.execute(
          'update outbox_messages set published_at=?,next_attempt_at=null where id=?',
          [message.publishedAt!, message.id],
        );

        return true;
      },
      { clear: true },
    );
  }
}

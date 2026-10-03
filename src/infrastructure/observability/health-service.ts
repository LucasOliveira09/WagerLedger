import { GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { OnModuleDestroy } from '@nestjs/common';

export class HealthService implements OnModuleDestroy {
  constructor(
    private readonly orm: MikroORM,
    private readonly client: SQSClient,
    private readonly queueUrls?: readonly string[],
  ) {}

  async ready() {
    const checks = await Promise.allSettled([
      this.orm.em.fork().transactional(async (em) => {
        await em.execute("SET LOCAL statement_timeout='1s'");
        await em.execute('select 1 from wallets limit 1');
      }),
      this.queueUrls
        ? Promise.all(
            this.queueUrls.map((url) =>
              this.client.send(
                new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }),
                { abortSignal: AbortSignal.timeout(1000) },
              ),
            ),
          )
        : Promise.all(
            ['wager-transactions.fifo', 'wager-transactions-dlq.fifo', 'wager-events.fifo'].map(
              (name) =>
                this.client.send(new GetQueueUrlCommand({ QueueName: name }), {
                  abortSignal: AbortSignal.timeout(1000),
                }),
            ),
          ),
    ]);
    const postgres = checks[0]!.status === 'fulfilled';
    const sqs = checks[1]!.status === 'fulfilled';

    return { status: postgres && sqs ? 'ready' : 'not_ready', postgres, sqs };
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}

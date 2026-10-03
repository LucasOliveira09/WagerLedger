import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { createSqsClient } from '../../src/infrastructure/messaging/sqs-client.js';

export async function createTestQueues() {
  const client = createSqsClient();
  const suffix = crypto.randomUUID();
  const urls: string[] = [];

  try {
    const create = async (name: string, attributes: Record<string, string> = {}, fifo = true) => {
      const result = await client.send(
        new CreateQueueCommand({
          QueueName: `test-${name}-${suffix}${fifo ? '.fifo' : ''}`,
          Attributes: { ...(fifo ? { FifoQueue: 'true' } : {}), ...attributes },
        }),
      );
      urls.push(result.QueueUrl!);
      return result.QueueUrl!;
    };
    const dlq = await create('dlq');
    const arn = (
      await client.send(
        new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ['QueueArn'] }),
      )
    ).Attributes!.QueueArn!;
    const wagers = await create('wagers', {
      VisibilityTimeout: '2',
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 5 }),
    });
    const events = await create('events', {}, false);

    return {
      client,
      wagers,
      dlq,
      events,
      async close() {
        try {
          for (const url of [...urls].reverse()) {
            await client.send(new DeleteQueueCommand({ QueueUrl: url }));
          }
        } finally {
          client.destroy();
        }
      },
    };
  } catch (error) {
    try {
      for (const url of urls.reverse()) {
        await client.send(new DeleteQueueCommand({ QueueUrl: url }));
      }
    } finally {
      client.destroy();
    }

    throw error;
  }
}

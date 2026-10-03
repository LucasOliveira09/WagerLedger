import { CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { createSqsClient } from '../src/infrastructure/messaging/sqs-client.js';

export async function initializeQueues() {
  const client = createSqsClient();
  try {
    const dlq = await client.send(new CreateQueueCommand({ QueueName: 'wager-transactions-dlq.fifo', Attributes: { FifoQueue: 'true' } }));
    const attrs = await client.send(new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl!, AttributeNames: ['QueueArn'] }));
    const wagers = await client.send(new CreateQueueCommand({
      QueueName: 'wager-transactions.fifo',
      Attributes: {
        FifoQueue: 'true', VisibilityTimeout: '30',
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: attrs.Attributes!.QueueArn, maxReceiveCount: 5 }),
      },
    }));
    const events = await client.send(new CreateQueueCommand({ QueueName: 'wager-events.fifo', Attributes: { FifoQueue: 'true' } }));
    return { wagers: wagers.QueueUrl!, dlq: dlq.QueueUrl!, events: events.QueueUrl! };
  } finally {
    client.destroy();
  }
}

if (import.meta.main) console.log(JSON.stringify(await initializeQueues()));

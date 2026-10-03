import { expect, test } from 'bun:test';
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { createSqsClient } from '../../src/infrastructure/messaging/sqs-client.js';

test('FIFO preserva ordem, deduplica e reentrega até redrive para DLQ', async () => {
  const client = createSqsClient();
  const suffix = crypto.randomUUID();
  const urls: string[] = [];

  try {
    const dlq = await client.send(
      new CreateQueueCommand({
        QueueName: `test-dlq-${suffix}.fifo`,
        Attributes: { FifoQueue: 'true' },
      }),
    );
    const dlqUrl = dlq.QueueUrl!;
    urls.push(dlqUrl);
    const attrs = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
    );
    const queue = await client.send(
      new CreateQueueCommand({
        QueueName: `test-wagers-${suffix}.fifo`,
        Attributes: {
          FifoQueue: 'true',
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: attrs.Attributes!.QueueArn,
            maxReceiveCount: 2,
          }),
        },
      }),
    );
    const queueUrl = queue.QueueUrl!;
    urls.push(queueUrl);

    for (const [id, body] of [
      ['first', 'one'],
      ['first', 'one'],
      ['second', 'two'],
    ]) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageGroupId: 'wallet',
          MessageDeduplicationId: id,
          MessageBody: body,
        }),
      );
    }

    const first = (
      await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1 }))
    ).Messages![0]!;
    expect(first.Body).toBe('one');
    await client.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: first.ReceiptHandle! }),
    );
    const second = (
      await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1 }))
    ).Messages![0]!;
    expect(second.Body).toBe('two');
    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: second.ReceiptHandle!,
        VisibilityTimeout: 0,
      }),
    );
    const replay = (await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl })))
      .Messages![0]!;
    expect(replay.MessageId).toBe(second.MessageId);
    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: replay.ReceiptHandle!,
        VisibilityTimeout: 0,
      }),
    );
    await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl }));
    const dead = await client.send(new ReceiveMessageCommand({ QueueUrl: dlqUrl }));
    expect(dead.Messages?.[0]?.Body).toBe('two');
    expect(
      (await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl }))).Messages ?? [],
    ).toHaveLength(0);
  } finally {
    for (const url of urls.reverse()) {
      await client.send(new DeleteQueueCommand({ QueueUrl: url }));
    }

    client.destroy();
  }
}, 30000);

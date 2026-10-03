import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { EventPublisher } from '../../application/ports/event-publisher.js';
import type { OutboxMessage } from '../../domain/outbox-message.js';

export class SqsEventPublisher implements EventPublisher {
  constructor(private readonly client: SQSClient, private readonly queueUrl: string) {}
  async publish(message: OutboxMessage, signal: AbortSignal): Promise<void> {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, ...(this.queueUrl.endsWith('.fifo') ? { MessageGroupId: message.aggregateId, MessageDeduplicationId: message.id } : {}), MessageBody: JSON.stringify(message.payload) }), { abortSignal: signal });
  }
}

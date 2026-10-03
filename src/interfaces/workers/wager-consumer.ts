import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Message, SQSClient } from '@aws-sdk/client-sqs';
import type { ProcessWager } from '../../application/process-wager.js';
import { parseWagerMessage } from './wager-message.js';
import { classifyFailure, retryDelaySeconds } from '../../infrastructure/messaging/retry-policy.js';
import { payloadHash } from '../../application/canonical-payload.js';

export interface ConsumerOptions {
  queueUrl: string; dlqUrl: string; waitTimeSeconds?: number; visibilitySeconds?: number; maxAttempts?: number;
  onCommitted?: (message: ReturnType<typeof parseWagerMessage>) => Promise<void>;
}
export class WagerConsumer {
  constructor(private readonly client: SQSClient, private readonly process: ProcessWager, private readonly options: ConsumerOptions) {}
  async tick(): Promise<number> {
    const wait = this.options.waitTimeSeconds ?? 20;
    const result = await this.client.send(new ReceiveMessageCommand({ QueueUrl: this.options.queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: wait, VisibilityTimeout: this.options.visibilitySeconds ?? 30, MessageSystemAttributeNames: ['ApproximateReceiveCount', 'MessageGroupId'] }), { abortSignal: AbortSignal.timeout((wait + 5) * 1000) });
    for (const message of result.Messages ?? []) await this.handle(message);
    return result.Messages?.length ?? 0;
  }
  async handle(message: Message): Promise<void> {
    let parsed: ReturnType<typeof parseWagerMessage>;
    try {
      parsed = parseWagerMessage(message.Body ?? '');
      await this.process.execute(parsed.input, parsed.key, parsed.context, { messageId: parsed.messageId, consumerName: 'wager-consumer', payloadHash: parsed.payloadHash });
    } catch (error) {
      const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
      if (classifyFailure(error) === 'permanent' || attempt >= (this.options.maxAttempts ?? 5)) {
        await this.client.send(new SendMessageCommand({ QueueUrl: this.options.dlqUrl, MessageBody: message.Body ?? '', MessageGroupId: message.Attributes?.MessageGroupId ?? 'invalid', MessageDeduplicationId: payloadHash({ brokerMessageId: message.MessageId, body: message.Body }), MessageAttributes: { failureCode: { DataType: 'String', StringValue: classifyFailure(error) === 'permanent' ? 'PERMANENT_MESSAGE' : 'RETRY_EXHAUSTED' } } }), { abortSignal: AbortSignal.timeout(5000) });
        await this.ack(message);
      } else {
        await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.options.queueUrl, ReceiptHandle: message.ReceiptHandle!, VisibilityTimeout: retryDelaySeconds(attempt) }), { abortSignal: AbortSignal.timeout(5000) });
      }
      return;
    }
    await this.options.onCommitted?.(parsed);
    await this.ack(message);
  }
  private async ack(message: Message): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.options.queueUrl, ReceiptHandle: message.ReceiptHandle! }), { abortSignal: AbortSignal.timeout(5000) });
  }
}

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Message, SQSClient } from '@aws-sdk/client-sqs';
import type { ProcessWager } from '../../application/process-wager.js';
import { parseWagerMessage } from './wager-message.js';
import { classifyFailure, retryDelaySeconds } from '../../infrastructure/messaging/retry-policy.js';
import { payloadHash } from '../../application/canonical-payload.js';
import { nullTelemetry } from '../../application/ports/telemetry.js';
import type { Telemetry } from '../../application/ports/telemetry.js';

export interface ConsumerOptions {
  queueUrl: string; dlqUrl: string; waitTimeSeconds?: number; visibilitySeconds?: number; maxAttempts?: number;
  onCommitted?: (message: ReturnType<typeof parseWagerMessage>) => Promise<void>;
}
export class WagerConsumer {
  private stopping = false;
  private readonly receiving = new AbortController();
  constructor(private readonly client: SQSClient, private readonly process: ProcessWager, private readonly options: ConsumerOptions, private readonly telemetry: Telemetry = nullTelemetry) {}
  requestStop(): void { this.stopping = true; this.receiving.abort(); }
  async tick(): Promise<number> {
    const wait = this.options.waitTimeSeconds ?? 20;
    let result;
    try {
      result = await this.client.send(new ReceiveMessageCommand({ QueueUrl: this.options.queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: wait, VisibilityTimeout: this.options.visibilitySeconds ?? 30, MessageSystemAttributeNames: ['ApproximateReceiveCount', 'MessageGroupId'] }), { abortSignal: AbortSignal.any([this.receiving.signal, AbortSignal.timeout((wait + 5) * 1000)]) });
    } catch (error) { if (this.stopping) return 0; throw error; }
    for (const message of result.Messages ?? []) {
      if (this.stopping) await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.options.queueUrl, ReceiptHandle: message.ReceiptHandle!, VisibilityTimeout: 0 }), { abortSignal: AbortSignal.timeout(5000) });
      else await this.handle(message);
    }
    return result.Messages?.length ?? 0;
  }
  async handle(message: Message): Promise<void> {
    let parsed: ReturnType<typeof parseWagerMessage> | undefined;
    try {
      parsed = parseWagerMessage(message.Body ?? '');
      await this.process.execute(parsed.input, parsed.key, parsed.context, { messageId: parsed.messageId, consumerName: 'wager-consumer', payloadHash: parsed.payloadHash });
    } catch (error) {
      const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
      const context = parsed ? { ...parsed.context, messageId: parsed.messageId, walletId: parsed.input.walletId, providerId: parsed.input.providerId, attempt } : { messageId: message.MessageId ?? 'unknown', attempt };
      if (classifyFailure(error) === 'permanent' || attempt >= (this.options.maxAttempts ?? 5)) {
        await this.client.send(new SendMessageCommand({ QueueUrl: this.options.dlqUrl, MessageBody: message.Body ?? '', MessageGroupId: message.Attributes?.MessageGroupId ?? 'invalid', MessageDeduplicationId: payloadHash({ brokerMessageId: message.MessageId, body: message.Body }), MessageAttributes: { failureCode: { DataType: 'String', StringValue: classifyFailure(error) === 'permanent' ? 'PERMANENT_MESSAGE' : 'RETRY_EXHAUSTED' } } }), { abortSignal: AbortSignal.timeout(5000) });
        await this.ack(message);
        this.telemetry.count('messages_dlq_total'); this.telemetry.log('warn', 'message_sent_to_dlq', { ...context, code: classifyFailure(error) === 'permanent' ? 'PERMANENT_MESSAGE' : 'RETRY_EXHAUSTED' });
      } else {
        await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.options.queueUrl, ReceiptHandle: message.ReceiptHandle!, VisibilityTimeout: retryDelaySeconds(attempt) }), { abortSignal: AbortSignal.timeout(5000) });
        this.telemetry.count('message_retries_total'); this.telemetry.log('warn', 'message_retry_scheduled', { ...context, code: 'TRANSIENT_FAILURE' });
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

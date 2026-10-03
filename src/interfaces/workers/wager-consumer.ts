import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import type { Message, SQSClient } from '@aws-sdk/client-sqs';
import type { ProcessWager } from '../../application/process-wager.js';
import { parseWagerMessage } from './wager-message.js';

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
    const parsed = parseWagerMessage(message.Body ?? '');
    await this.process.execute(parsed.input, parsed.key, parsed.context, { messageId: parsed.messageId, consumerName: 'wager-consumer', payloadHash: parsed.payloadHash });
    await this.options.onCommitted?.(parsed);
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.options.queueUrl, ReceiptHandle: message.ReceiptHandle! }), { abortSignal: AbortSignal.timeout(5000) });
  }
}

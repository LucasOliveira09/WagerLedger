import { DomainError } from './domain-error.js';

export interface InboxState { messageId: string; consumerName: string; payloadHash: string; receivedAt: Date; processedAt?: Date }
export class InboxMessage {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  private readonly receivedTimestamp: number;
  private processedTimestamp: number | undefined;

  private constructor(state: InboxState) {
    this.messageId = state.messageId; this.consumerName = state.consumerName; this.payloadHash = state.payloadHash;
    this.receivedTimestamp = state.receivedAt.getTime(); this.processedTimestamp = state.processedAt?.getTime();
  }
  static receive(state: Omit<InboxState, 'processedAt'>): InboxMessage { return new InboxMessage(state); }
  static rehydrate(state: InboxState): InboxMessage { return new InboxMessage(state); }
  get receivedAt(): Date { return new Date(this.receivedTimestamp); }
  get processedAt(): Date | undefined { return this.processedTimestamp === undefined ? undefined : new Date(this.processedTimestamp); }
  isProcessed(): boolean { return this.processedTimestamp !== undefined; }
  matchesPayload(hash: string): boolean { return this.payloadHash === hash; }
  markProcessed(at: Date): void {
    if (this.isProcessed()) throw new DomainError('INVALID_MESSAGE_STATE', 'Mensagem já processada.');
    this.processedTimestamp = at.getTime();
  }
}

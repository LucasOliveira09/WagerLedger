import { DomainError } from './domain-error.js';
import { immutableSnapshot } from './events/integration-event.js';
import type { EventEnvelope, IntegrationEvent } from './events/integration-event.js';

export interface OutboxState {
  id: string; aggregateId: string; eventType: string; payload: EventEnvelope<unknown>;
  occurredAt: Date; attempts: number; nextAttemptAt?: Date; publishedAt?: Date;
}
export class OutboxMessage {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<EventEnvelope<unknown>>;
  private readonly occurredTimestamp: number;
  private _attempts: number;
  private nextTimestamp: number | undefined;
  private publishedTimestamp: number | undefined;

  private constructor(state: OutboxState) {
    this.id = state.id; this.aggregateId = state.aggregateId; this.eventType = state.eventType;
    this.payload = immutableSnapshot(state.payload); this.occurredTimestamp = state.occurredAt.getTime();
    this._attempts = state.attempts; this.nextTimestamp = state.nextAttemptAt?.getTime(); this.publishedTimestamp = state.publishedAt?.getTime();
  }
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage({ id: event.eventId, aggregateId: event.aggregateId, eventType: event.eventType, payload: event.toJSON(), occurredAt: event.occurredAt, attempts: 0 });
  }
  static rehydrate(state: OutboxState): OutboxMessage { return new OutboxMessage(state); }
  get attempts(): number { return this._attempts; }
  get occurredAt(): Date { return new Date(this.occurredTimestamp); }
  get nextAttemptAt(): Date | undefined { return this.nextTimestamp === undefined ? undefined : new Date(this.nextTimestamp); }
  get publishedAt(): Date | undefined { return this.publishedTimestamp === undefined ? undefined : new Date(this.publishedTimestamp); }
  isPending(): boolean { return this.publishedTimestamp === undefined; }
  isDue(now: Date): boolean { return this.isPending() && (this.nextTimestamp === undefined || this.nextTimestamp <= now.getTime()); }
  markPublished(at: Date): void { this.assertPending(); this.publishedTimestamp = at.getTime(); }
  scheduleRetry(now: Date): void {
    this.assertPending(); this._attempts++;
    this.nextTimestamp = now.getTime() + Math.min(60000, 500 * 2 ** Math.min(this.attempts - 1, 8));
  }
  private assertPending(): void { if (!this.isPending()) throw new DomainError('INVALID_MESSAGE_STATE', 'Evento já publicado.'); }
}

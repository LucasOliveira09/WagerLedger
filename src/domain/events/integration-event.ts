export interface EventContext { correlationId: string; causationId?: string }
export interface EventEnvelope<T> {
  eventId: string; eventType: string; aggregateId: string; correlationId: string;
  causationId?: string; occurredAt: string; version: number; data: T;
}
export interface IntegrationEventProps<T> extends EventContext {
  eventId: string; aggregateId: string; occurredAt: Date; data: T;
}
export function immutableSnapshot<T>(input: T): T {
  const copy = structuredClone(input);
  function freeze(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value)) freeze(nested);
      Object.freeze(value);
    }
  }
  freeze(copy);
  return copy;
}
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId: string | undefined;
  readonly data: Readonly<T>;
  private readonly timestamp: number;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId; this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId; this.causationId = props.causationId;
    this.timestamp = props.occurredAt.getTime(); this.data = immutableSnapshot(props.data);
  }
  get occurredAt(): Date { return new Date(this.timestamp); }
  toJSON(): EventEnvelope<T> {
    return { eventId: this.eventId, eventType: this.eventType, aggregateId: this.aggregateId, correlationId: this.correlationId,
      ...(this.causationId ? { causationId: this.causationId } : {}), occurredAt: this.occurredAt.toISOString(), version: this.version, data: structuredClone(this.data) as T };
  }
}

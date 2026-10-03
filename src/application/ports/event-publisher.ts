import type { OutboxMessage } from '../../domain/outbox-message.js';
export interface EventPublisher { publish(message: OutboxMessage, signal: AbortSignal): Promise<void> }

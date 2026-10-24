import { OutboxMessage } from '../models/outbox-message';

export const EVENT_PUBLISHER_PORT = Symbol('EVENT_PUBLISHER_PORT');

export interface EventPublisherPort {
  publish(outboxMessage: OutboxMessage): Promise<void>;
}

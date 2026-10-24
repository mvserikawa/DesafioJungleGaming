import { OutboxMessage } from '../models/outbox-message';

export const OUTBOX_REPOSITORY_PORT = Symbol('OUTBOX_REPOSITORY_PORT');

export interface OutboxRepositoryPort {
  save(outbox: OutboxMessage): Promise<void>;
  findDueMessagesWithLock(limit: number, now?: Date): Promise<OutboxMessage[]>;
  update(outbox: OutboxMessage): Promise<void>;
}

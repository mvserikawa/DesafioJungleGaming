import { InboxMessage } from '../models/inbox-message';

export const INBOX_REPOSITORY_PORT = Symbol('INBOX_REPOSITORY_PORT');

export interface InboxRepositoryPort {
  findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null>;
  save(inbox: InboxMessage): Promise<void>;
}

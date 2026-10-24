import { EntityManager } from '@mikro-orm/core';
import { InboxMessage } from '../../../domain/models/inbox-message';
import { InboxRepositoryPort } from '../../../domain/ports/inbox.repository.port';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export class MikroOrmInboxRepository implements InboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  public async findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, {
      consumerName,
      messageId,
    });
    return entity ? entity.toDomain() : null;
  }

  public async save(inbox: InboxMessage): Promise<void> {
    const existing = await this.em.findOne(InboxMessageEntity, {
      consumerName: inbox.consumerName,
      messageId: inbox.messageId,
    });

    if (existing) {
      existing.processedAt = inbox.processedAt;
    } else {
      const entity = InboxMessageEntity.fromDomain(inbox);
      this.em.persist(entity);
    }
  }
}

import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { InboxMessage } from '../../../domain/models/inbox-message';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ fieldName: 'consumer_name', type: 'varchar', length: 64 })
  consumerName!: string;

  @PrimaryKey({ fieldName: 'message_id', type: 'varchar', length: 128 })
  messageId!: string;

  @Property({ fieldName: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Property({ fieldName: 'received_at', type: 'timestamptz' })
  receivedAt: Date = new Date();

  @Property({ fieldName: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date;

  public static fromDomain(inbox: InboxMessage): InboxMessageEntity {
    const entity = new InboxMessageEntity();
    entity.consumerName = inbox.consumerName;
    entity.messageId = inbox.messageId;
    entity.payloadHash = inbox.payloadHash;
    entity.receivedAt = inbox.receivedAt;
    entity.processedAt = inbox.processedAt;
    return entity;
  }

  public toDomain(): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: this.consumerName,
      messageId: this.messageId,
      payloadHash: this.payloadHash,
      receivedAt: this.receivedAt,
      processedAt: this.processedAt,
    });
  }
}

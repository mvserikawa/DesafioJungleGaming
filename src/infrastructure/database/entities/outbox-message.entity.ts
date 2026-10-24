import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { OutboxMessage } from '../../../domain/models/outbox-message';

@Entity({ tableName: 'outbox_messages' })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'varchar', length: 36 })
  id!: string;

  @Property({ fieldName: 'aggregate_id', type: 'varchar', length: 64 })
  aggregateId!: string;

  @Property({ fieldName: 'event_type', type: 'varchar', length: 64 })
  eventType!: string;

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ fieldName: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Property({ type: 'integer', default: 0 })
  attempts!: number;

  @Property({ fieldName: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Property({ fieldName: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date;

  public static fromDomain(outbox: OutboxMessage): OutboxMessageEntity {
    const entity = new OutboxMessageEntity();
    entity.id = outbox.id;
    entity.aggregateId = outbox.aggregateId;
    entity.eventType = outbox.eventType;
    entity.payload = outbox.payload as Record<string, unknown>;
    entity.occurredAt = outbox.occurredAt;
    entity.attempts = outbox.attempts;
    entity.nextAttemptAt = outbox.nextAttemptAt ?? new Date();
    entity.publishedAt = outbox.publishedAt;
    return entity;
  }

  public toDomain(): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: this.id,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      payload: this.payload,
      occurredAt: this.occurredAt,
      attempts: this.attempts,
      nextAttemptAt: this.nextAttemptAt,
      publishedAt: this.publishedAt,
    });
  }
}

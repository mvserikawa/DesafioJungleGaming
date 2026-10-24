import { EntityManager } from '@mikro-orm/core';
import { OutboxMessage } from '../../../domain/models/outbox-message';
import { OutboxRepositoryPort } from '../../../domain/ports/outbox.repository.port';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export class MikroOrmOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  public async save(outbox: OutboxMessage): Promise<void> {
    const entity = OutboxMessageEntity.fromDomain(outbox);
    this.em.persist(entity);
  }

  public async findDueMessagesWithLock(
    limit: number,
    now: Date = new Date(),
  ): Promise<OutboxMessage[]> {
    // Select pending messages using FOR UPDATE SKIP LOCKED for high-throughput concurrency
    const connection = this.em.getConnection();
    const rows = await connection.execute<
      Array<{
        id: string;
        aggregate_id: string;
        event_type: string;
        payload: Record<string, unknown>;
        occurred_at: string;
        attempts: number;
        next_attempt_at: string;
        published_at: string | null;
      }>
    >(
      `SELECT * FROM outbox_messages
       WHERE published_at IS NULL AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );

    return rows.map((row: any) =>
      OutboxMessage.rehydrate({
        id: row.id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload:
          typeof row.payload === 'string'
            ? JSON.parse(row.payload)
            : row.payload,
        occurredAt: new Date(row.occurred_at),
        attempts: row.attempts,
        nextAttemptAt: new Date(row.next_attempt_at),
        publishedAt: row.published_at ? new Date(row.published_at) : undefined,
      }),
    );
  }

  public async update(outbox: OutboxMessage): Promise<void> {
    const connection = this.em.getConnection();
    await connection.execute(
      `UPDATE outbox_messages
       SET attempts = ?, next_attempt_at = ?, published_at = ?
       WHERE id = ?`,
      [outbox.attempts, outbox.nextAttemptAt, outbox.publishedAt, outbox.id],
    );
  }
}

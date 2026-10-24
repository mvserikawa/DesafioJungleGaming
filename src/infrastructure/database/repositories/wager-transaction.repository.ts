import { EntityManager } from '@mikro-orm/core';
import {
  WagerTransaction,
  WagerTransactionStatus,
} from '../../../domain/models/wager-transaction';
import { WagerTransactionRepositoryPort } from '../../../domain/ports/wager-transaction.repository.port';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export class MikroOrmWagerTransactionRepository
  implements WagerTransactionRepositoryPort
{
  constructor(private readonly em: EntityManager) {}

  public async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    return entity ? entity.toDomain() : null;
  }

  public async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      idempotencyKey: key,
    });
    return entity ? entity.toDomain() : null;
  }

  public async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return entity ? entity.toDomain() : null;
  }

  public async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      { status: WagerTransactionStatus.PendingReference },
      { limit, orderBy: { createdAt: 'ASC' } },
    );
    return entities.map((e) => e.toDomain());
  }

  public async findReversal(
    providerId: string,
    referenceExternalTransactionId: string,
    kind: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      referenceExternalTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return entity ? entity.toDomain() : null;
  }

  public async save(transaction: WagerTransaction): Promise<void> {
    const existing = await this.em.findOne(WagerTransactionEntity, {
      id: transaction.id,
    });
    if (existing) {
      existing.status = transaction.status;
      existing.failureCode = transaction.failureCode;
      existing.processedAt = transaction.processedAt;
      existing.referenceTransactionId = transaction.referenceTransactionId;
    } else {
      const entity = WagerTransactionEntity.fromDomain(transaction);
      this.em.persist(entity);
    }
  }
}

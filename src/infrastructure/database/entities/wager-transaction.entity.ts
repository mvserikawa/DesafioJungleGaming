import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { FailureCode } from '../../../domain/errors/failure-codes';
import { Money } from '../../../domain/models/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/models/wager-transaction';

@Entity({ tableName: 'wager_transactions' })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'varchar', length: 36 })
  id!: string;

  @Property({ fieldName: 'provider_id', type: 'varchar', length: 64 })
  providerId!: string;

  @Property({ fieldName: 'external_transaction_id', type: 'varchar', length: 128 })
  externalTransactionId!: string;

  @Property({ fieldName: 'idempotency_key', type: 'varchar', length: 256 })
  idempotencyKey!: string;

  @Property({ fieldName: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Property({ fieldName: 'wallet_id', type: 'varchar', length: 36 })
  walletId!: string;

  @Property({ fieldName: 'player_id', type: 'varchar', length: 64 })
  playerId!: string;

  @Property({ fieldName: 'round_id', type: 'varchar', length: 128 })
  roundId!: string;

  @Property({ fieldName: 'game_id', type: 'varchar', length: 128 })
  gameId!: string;

  @Property({ type: 'varchar', length: 20 })
  kind!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({
    fieldName: 'reference_external_transaction_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({
    fieldName: 'reference_transaction_id',
    type: 'varchar',
    length: 36,
    nullable: true,
  })
  referenceTransactionId?: string;

  @Property({ type: 'varchar', length: 30 })
  status!: string;

  @Property({ fieldName: 'failure_code', type: 'varchar', length: 50, nullable: true })
  failureCode?: string;

  @Property({ fieldName: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date;

  @Property({ fieldName: 'created_at', type: 'timestamptz' })
  createdAt: Date = new Date();

  public static fromDomain(tx: WagerTransaction): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();
    entity.id = tx.id;
    entity.providerId = tx.providerId;
    entity.externalTransactionId = tx.externalTransactionId;
    entity.idempotencyKey = tx.idempotencyKey;
    entity.payloadHash = tx.payloadHash;
    entity.walletId = tx.walletId;
    entity.playerId = tx.playerId;
    entity.roundId = tx.roundId;
    entity.gameId = tx.gameId;
    entity.kind = tx.kind;
    entity.amount = tx.money.toString();
    entity.currency = tx.money.currency;
    entity.referenceExternalTransactionId = tx.referenceExternalTransactionId;
    entity.referenceTransactionId = tx.referenceTransactionId;
    entity.status = tx.status;
    entity.failureCode = tx.failureCode;
    entity.processedAt = tx.processedAt;
    entity.createdAt = tx.createdAt;
    return entity;
  }

  public toDomain(): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      payloadHash: this.payloadHash,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind as WagerTransactionKind,
      money: Money.rehydrate(this.amount, this.currency),
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      referenceTransactionId: this.referenceTransactionId,
      status: this.status as WagerTransactionStatus,
      failureCode: this.failureCode as FailureCode | undefined,
      processedAt: this.processedAt,
      createdAt: this.createdAt,
    });
  }
}

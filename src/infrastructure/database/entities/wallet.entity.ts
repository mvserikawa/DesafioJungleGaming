import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { Money } from '../../../domain/models/money';
import { Wallet } from '../../../domain/models/wallet';

@Entity({ tableName: 'wallets' })
export class WalletEntity {
  @PrimaryKey({ type: 'varchar', length: 36 })
  id!: string;

  @Property({ fieldName: 'player_id', type: 'varchar', length: 64 })
  playerId!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  balance!: string;

  @Property({ type: 'integer', default: 1 })
  version!: number;

  @Property({ fieldName: 'created_at', type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ fieldName: 'updated_at', type: 'timestamptz' })
  updatedAt: Date = new Date();

  public static fromDomain(wallet: Wallet): WalletEntity {
    const entity = new WalletEntity();
    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toString();
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;
    return entity;
  }

  public toDomain(): Wallet {
    return Wallet.rehydrate({
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: Money.rehydrate(this.balance, this.currency),
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }
}

import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../../domain/models/ledger-entry';
import { Money } from '../../../domain/models/money';

@Entity({ tableName: 'wallet_ledger_entries' })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'varchar', length: 36 })
  id!: string;

  @Property({ fieldName: 'wallet_id', type: 'varchar', length: 36 })
  walletId!: string;

  @Property({ fieldName: 'transaction_id', type: 'varchar', length: 36 })
  transactionId!: string;

  @Property({ type: 'varchar', length: 10 })
  direction!: string;

  @Property({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: 'varchar', length: 3 })
  currency!: string;

  @Property({ fieldName: 'balance_before', type: 'decimal', precision: 18, scale: 2 })
  balanceBefore!: string;

  @Property({ fieldName: 'balance_after', type: 'decimal', precision: 18, scale: 2 })
  balanceAfter!: string;

  @Property({ fieldName: 'created_at', type: 'timestamptz' })
  createdAt: Date = new Date();

  public static fromDomain(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();
    entity.id = entry.id;
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.amount = entry.money.toString();
    entity.currency = entry.money.currency;
    entity.balanceBefore = entry.balanceBefore.toString();
    entity.balanceAfter = entry.balanceAfter.toString();
    entity.createdAt = entry.createdAt;
    return entity;
  }

  public toDomain(): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      direction: this.direction as LedgerDirection,
      money: Money.rehydrate(this.amount, this.currency),
      balanceBefore: Money.rehydrate(this.balanceBefore, this.currency),
      balanceAfter: Money.rehydrate(this.balanceAfter, this.currency),
      createdAt: this.createdAt,
    });
  }
}

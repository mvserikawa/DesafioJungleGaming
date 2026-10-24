import { EntityManager, LockMode } from '@mikro-orm/core';
import { Wallet } from '../../../domain/models/wallet';
import { WalletRepositoryPort } from '../../../domain/ports/wallet.repository.port';
import { WalletEntity } from '../entities/wallet.entity';

export class MikroOrmWalletRepository implements WalletRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  public async findById(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id });
    return entity ? entity.toDomain() : null;
  }

  public async findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { playerId, currency });
    return entity ? entity.toDomain() : null;
  }

  public async findByIdWithLock(id: string): Promise<Wallet | null> {
    // Acquire SELECT ... FOR UPDATE pessimistic row lock
    const entity = await this.em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return entity ? entity.toDomain() : null;
  }

  public async save(wallet: Wallet): Promise<void> {
    const existing = await this.em.findOne(WalletEntity, { id: wallet.id });
    if (existing) {
      existing.balance = wallet.balance.toString();
      existing.version = wallet.version;
      existing.updatedAt = wallet.updatedAt;
    } else {
      const entity = WalletEntity.fromDomain(wallet);
      this.em.persist(entity);
    }
  }
}

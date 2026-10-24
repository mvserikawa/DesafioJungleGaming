import { EntityManager } from '@mikro-orm/core';
import { WalletLedgerEntry } from '../../../domain/models/ledger-entry';
import { Money } from '../../../domain/models/money';
import {
  LedgerPaginationOptions,
  LedgerRepositoryPort,
  PaginatedLedgerResult,
  ReconciledBalanceResult,
} from '../../../domain/ports/ledger.repository.port';
import { WalletLedgerEntryEntity } from '../entities/ledger-entry.entity';

export class MikroOrmLedgerRepository implements LedgerRepositoryPort {
  constructor(private readonly em: EntityManager) {}

  public async save(entry: WalletLedgerEntry): Promise<void> {
    const entity = WalletLedgerEntryEntity.fromDomain(entry);
    this.em.persist(entity);
  }

  public async findByWalletId(
    walletId: string,
    options: LedgerPaginationOptions,
  ): Promise<PaginatedLedgerResult> {
    const where: Record<string, unknown> = { walletId };

    if (options.cursor) {
      try {
        const decodedDate = new Date(
          Buffer.from(options.cursor, 'base64').toString('utf8'),
        );
        where.createdAt = { $lt: decodedDate };
      } catch {
        // Fallback if cursor parsing fails
      }
    }

    const limit = options.limit;
    const entities = await this.em.find(WalletLedgerEntryEntity, where, {
      limit: limit + 1,
      orderBy: { createdAt: 'DESC' },
    });

    const hasMore = entities.length > limit;
    const items = hasMore ? entities.slice(0, limit) : entities;
    const entries = items.map((e) => e.toDomain());

    let nextCursor: string | undefined;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = Buffer.from(lastItem.createdAt.toISOString()).toString('base64');
    }

    return { entries, nextCursor };
  }

  public async calculateReconciledBalance(
    walletId: string,
    currency: string,
  ): Promise<ReconciledBalanceResult> {
    const connection = this.em.getConnection();
    const result = await connection.execute<{
      sum_balance: string | null;
      total_count: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS sum_balance,
         COUNT(*) AS total_count
       FROM wallet_ledger_entries
       WHERE wallet_id = ?`,
      [walletId],
    );

    const row = result[0];
    const calculatedAmount = row?.sum_balance ?? '0.00';
    const checkedEntries = parseInt(row?.total_count ?? '0', 10);

    return {
      calculatedBalance: Money.rehydrate(calculatedAmount, currency),
      checkedEntries,
    };
  }
}

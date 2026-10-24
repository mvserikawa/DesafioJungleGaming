import { AsyncLocalStorage } from 'async_hooks';
import { InboxMessage } from '../../src/domain/models/inbox-message';
import { WalletLedgerEntry } from '../../src/domain/models/ledger-entry';
import { Money } from '../../src/domain/models/money';
import { OutboxMessage } from '../../src/domain/models/outbox-message';
import { WagerTransaction } from '../../src/domain/models/wager-transaction';
import { Wallet } from '../../src/domain/models/wallet';
import { InboxRepositoryPort } from '../../src/domain/ports/inbox.repository.port';
import {
  LedgerPaginationOptions,
  LedgerRepositoryPort,
  PaginatedLedgerResult,
  ReconciledBalanceResult,
} from '../../src/domain/ports/ledger.repository.port';
import { OutboxRepositoryPort } from '../../src/domain/ports/outbox.repository.port';
import { UnitOfWorkPort } from '../../src/domain/ports/unit-of-work.port';
import { WagerTransactionRepositoryPort } from '../../src/domain/ports/wager-transaction.repository.port';
import { WalletRepositoryPort } from '../../src/domain/ports/wallet.repository.port';

interface TxContext {
  releaseCallbacks: Array<() => void>;
}

export class InMemoryUnitOfWork implements UnitOfWorkPort {
  public static storage = new AsyncLocalStorage<TxContext>();

  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    const ctx: TxContext = { releaseCallbacks: [] };
    return InMemoryUnitOfWork.storage.run(ctx, async () => {
      try {
        return await work();
      } finally {
        for (const cb of ctx.releaseCallbacks) {
          cb();
        }
      }
    });
  }
}

export class InMemoryWalletRepository implements WalletRepositoryPort {
  public wallets = new Map<string, Wallet>();
  private lockQueues = new Map<string, Array<() => void>>();
  private activeLocks = new Set<string>();

  public async acquireLock(id: string): Promise<() => void> {
    if (!this.activeLocks.has(id)) {
      this.activeLocks.add(id);
      return () => {
        const next = this.lockQueues.get(id)?.shift();
        if (next) {
          next();
        } else {
          this.activeLocks.delete(id);
        }
      };
    }

    return new Promise((resolve) => {
      if (!this.lockQueues.has(id)) {
        this.lockQueues.set(id, []);
      }
      this.lockQueues.get(id)!.push(() => {
        resolve(() => {
          const next = this.lockQueues.get(id)?.shift();
          if (next) {
            next();
          } else {
            this.activeLocks.delete(id);
          }
        });
      });
    });
  }

  public async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  public async findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    for (const wallet of this.wallets.values()) {
      if (wallet.playerId === playerId && wallet.currency === currency) {
        return wallet;
      }
    }
    return null;
  }

  public async findByIdWithLock(id: string): Promise<Wallet | null> {
    const release = await this.acquireLock(id);
    const tx = InMemoryUnitOfWork.storage.getStore();
    if (tx) {
      tx.releaseCallbacks.push(release);
    } else {
      queueMicrotask(release);
    }
    return this.wallets.get(id) ?? null;
  }

  public async save(wallet: Wallet): Promise<void> {
    this.wallets.set(wallet.id, wallet);
  }
}

export class InMemoryWagerTransactionRepository
  implements WagerTransactionRepositoryPort
{
  public transactions = new Map<string, WagerTransaction>();

  public async findById(id: string): Promise<WagerTransaction | null> {
    return this.transactions.get(id) ?? null;
  }

  public async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (tx.idempotencyKey === key) return tx;
    }
    return null;
  }

  public async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (
        tx.providerId === providerId &&
        tx.externalTransactionId === externalTransactionId
      ) {
        return tx;
      }
    }
    return null;
  }

  public async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const list: WagerTransaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.status === 'PENDING_REFERENCE') {
        list.push(tx);
        if (list.length >= limit) break;
      }
    }
    return list;
  }

  public async findReversal(
    providerId: string,
    referenceExternalTransactionId: string,
    kind: string,
  ): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (
        tx.providerId === providerId &&
        tx.referenceExternalTransactionId === referenceExternalTransactionId &&
        tx.kind === kind &&
        tx.status === 'PROCESSED'
      ) {
        return tx;
      }
    }
    return null;
  }

  public async save(transaction: WagerTransaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }
}

export class InMemoryLedgerRepository implements LedgerRepositoryPort {
  public entries: WalletLedgerEntry[] = [];

  public async save(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  public async findByWalletId(
    walletId: string,
    options: LedgerPaginationOptions,
  ): Promise<PaginatedLedgerResult> {
    const filtered = this.entries
      .filter((e) => e.walletId === walletId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const limit = options.limit;
    let startIndex = 0;
    if (options.cursor) {
      const cursorDate = new Date(Buffer.from(options.cursor, 'base64').toString('ascii'));
      startIndex = filtered.findIndex((e) => e.createdAt < cursorDate);
      if (startIndex === -1) startIndex = filtered.length;
    }

    const paged = filtered.slice(startIndex, startIndex + limit);
    const nextCursor =
      paged.length === limit
        ? Buffer.from(paged[paged.length - 1].createdAt.toISOString()).toString('base64')
        : undefined;

    return { entries: paged, nextCursor };
  }

  public async calculateReconciledBalance(
    walletId: string,
    currency: string,
  ): Promise<ReconciledBalanceResult> {
    const walletEntries = this.entries.filter((e) => e.walletId === walletId);
    let total = Money.zero(currency);

    for (const entry of walletEntries) {
      if (entry.direction === 'CREDIT') {
        total = total.add(entry.money);
      } else if (entry.direction === 'DEBIT') {
        total = total.subtract(entry.money);
      }
    }

    return { calculatedBalance: total, checkedEntries: walletEntries.length };
  }
}

export class InMemoryInboxRepository implements InboxRepositoryPort {
  public messages = new Map<string, InboxMessage>();

  public async findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    return this.messages.get(`${consumerName}:${messageId}`) ?? null;
  }

  public async save(inbox: InboxMessage): Promise<void> {
    this.messages.set(`${inbox.consumerName}:${inbox.messageId}`, inbox);
  }
}

export class InMemoryOutboxRepository implements OutboxRepositoryPort {
  public messages: OutboxMessage[] = [];

  public async save(outbox: OutboxMessage): Promise<void> {
    this.messages.push(outbox);
  }

  public async findDueMessagesWithLock(limit: number, now: Date = new Date()): Promise<OutboxMessage[]> {
    return this.messages.filter((m) => m.isDue(now)).slice(0, limit);
  }

  public async update(outbox: OutboxMessage): Promise<void> {
    const idx = this.messages.findIndex((m) => m.id === outbox.id);
    if (idx !== -1) {
      this.messages[idx] = outbox;
    }
  }
}

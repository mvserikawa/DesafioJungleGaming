import { randomUUID } from 'crypto';
import { FailureCode } from '../../domain/errors/failure-codes';
import { WagerTransactionRejected } from '../../domain/events/wager-transaction-rejected.event';
import { OutboxMessage } from '../../domain/models/outbox-message';
import { WagerTransactionStatus } from '../../domain/models/wager-transaction';
import { OUTBOX_REPOSITORY_PORT, OutboxRepositoryPort } from '../../domain/ports/outbox.repository.port';
import { UNIT_OF_WORK_PORT, UnitOfWorkPort } from '../../domain/ports/unit-of-work.port';
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  WagerTransactionRepositoryPort,
} from '../../domain/ports/wager-transaction.repository.port';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case';

export interface ResolvePendingReferencesOptions {
  batchSize?: number;
  maxAgeMs?: number; // TTL after which pending reference is rejected
}

export class ResolvePendingReferencesUseCase {
  constructor(
    private readonly txRepo: WagerTransactionRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly processUseCase: ProcessWagerTransactionUseCase,
    private readonly uow: UnitOfWorkPort,
  ) {}

  public async execute(options: ResolvePendingReferencesOptions = {}): Promise<number> {
    const batchSize = options.batchSize ?? 50;
    const maxAgeMs = options.maxAgeMs ?? 300000; // 5 minutes TTL default
    const now = new Date();

    const pendingList = await this.txRepo.findPendingReferences(batchSize);
    let resolvedCount = 0;

    for (const tx of pendingList) {
      if (tx.status !== WagerTransactionStatus.PendingReference) continue;

      const age = now.getTime() - tx.createdAt.getTime();

      // Check if reference has arrived
      if (tx.referenceExternalTransactionId) {
        const refTx = await this.txRepo.findByProviderAndExternalId(
          tx.providerId,
          tx.referenceExternalTransactionId,
        );

        if (refTx && refTx.status === WagerTransactionStatus.Processed) {
          // Reference is now available! Re-execute transaction processing
          await this.processUseCase.execute(
            {
              providerId: tx.providerId,
              externalTransactionId: tx.externalTransactionId,
              playerId: tx.playerId,
              walletId: tx.walletId,
              roundId: tx.roundId,
              gameId: tx.gameId,
              kind: tx.kind,
              money: tx.money.toJSON(),
              referenceExternalTransactionId: tx.referenceExternalTransactionId,
            },
            {
              idempotencyKey: tx.idempotencyKey,
              correlationId: `retry-pending-${tx.id}`,
            },
          );
          resolvedCount++;
          continue;
        }
      }

      // If reference still absent and exceeded TTL, reject transaction
      if (age > maxAgeMs) {
        await this.uow.runInTransaction(async () => {
          tx.reject(FailureCode.PENDING_REFERENCE_EXPIRED, now);
          await this.txRepo.save(tx);

          const event = WagerTransactionRejected.from(
            tx,
            FailureCode.PENDING_REFERENCE_EXPIRED,
            {
              eventId: randomUUID(),
              correlationId: `expired-pending-${tx.id}`,
              occurredAt: now,
            },
          );
          await this.outboxRepo.save(OutboxMessage.enqueue(event));
          resolvedCount++;
        });
      }
    }

    return resolvedCount;
  }
}

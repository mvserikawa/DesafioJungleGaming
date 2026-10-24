import { randomUUID } from 'crypto';
import {
  CurrencyMismatchError,
  IdempotencyConflictError,
  WalletNotFoundError,
} from '../../domain/errors/domain-errors';
import { FailureCode } from '../../domain/errors/failure-codes';
import { WagerTransactionPendingReference } from '../../domain/events/wager-transaction-pending-reference.event';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction-processed.event';
import { WagerTransactionRejected } from '../../domain/events/wager-transaction-rejected.event';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event';
import { InboxMessage } from '../../domain/models/inbox-message';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../domain/models/ledger-entry';
import { Money } from '../../domain/models/money';
import { OutboxMessage } from '../../domain/models/outbox-message';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/models/wager-transaction';
import { Wallet } from '../../domain/models/wallet';
import { computeCanonicalPayloadHash } from '../../domain/utils/canonical-hash';
import { INBOX_REPOSITORY_PORT, InboxRepositoryPort } from '../../domain/ports/inbox.repository.port';
import { LEDGER_REPOSITORY_PORT, LedgerRepositoryPort } from '../../domain/ports/ledger.repository.port';
import { OUTBOX_REPOSITORY_PORT, OutboxRepositoryPort } from '../../domain/ports/outbox.repository.port';
import { UNIT_OF_WORK_PORT, UnitOfWorkPort } from '../../domain/ports/unit-of-work.port';
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  WagerTransactionRepositoryPort,
} from '../../domain/ports/wager-transaction.repository.port';
import { WALLET_REPOSITORY_PORT, WalletRepositoryPort } from '../../domain/ports/wallet.repository.port';
import { SubmitTransactionDto, TransactionResponseDto } from '../dtos/wagering.dto';

export interface ProcessTransactionOptions {
  idempotencyKey: string;
  inboxMessageId?: string;
  consumerName?: string;
  correlationId?: string;
  causationId?: string;
}

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly txRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: LedgerRepositoryPort,
    private readonly inboxRepo: InboxRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly uow: UnitOfWorkPort,
  ) {}

  public async execute(
    dto: SubmitTransactionDto,
    options: ProcessTransactionOptions,
  ): Promise<TransactionResponseDto> {
    const money = Money.from(dto.money);
    const correlationId = options.correlationId ?? randomUUID();
    const causationId = options.causationId;

    // Canonical payload hash calculation
    const payloadHash = computeCanonicalPayloadHash({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: { amount: money.toString(), currency: money.currency },
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    });

    return this.uow.runInTransaction(async () => {
      // 1. Acquire Pessimistic Row Lock on Wallet (Unit of concurrency is walletId)
      const wallet = await this.walletRepo.findByIdWithLock(dto.walletId);
      if (!wallet) {
        throw new WalletNotFoundError(dto.walletId);
      }

      if (wallet.playerId !== dto.playerId) {
        throw new Error(
          `Wallet ${dto.walletId} does not belong to player ${dto.playerId}`,
        );
      }

      if (wallet.currency !== money.currency) {
        throw new CurrencyMismatchError(wallet.currency, money.currency);
      }

      // 2. Idempotency Check by Idempotency-Key
      const existingTx = await this.txRepo.findByIdempotencyKey(options.idempotencyKey);
      if (existingTx) {
        if (!existingTx.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(options.idempotencyKey);
        }

        // If transaction already reached terminal state, return idempotent replay
        if (existingTx.isTerminal()) {
          return {
            transactionId: existingTx.id,
            status: existingTx.status,
            failureCode: existingTx.failureCode,
            balance: wallet.balance.toJSON(),
            idempotentReplay: true,
          };
        }
      }

      // 3. Inbox Check (if delivered through messaging queue)
      let inboxMessage: InboxMessage | undefined;
      if (options.inboxMessageId && options.consumerName) {
        const existingInbox = await this.inboxRepo.findByConsumerAndMessageId(
          options.consumerName,
          options.inboxMessageId,
        );

        if (existingInbox && existingInbox.isProcessed()) {
          const txByExt = await this.txRepo.findByProviderAndExternalId(
            dto.providerId,
            dto.externalTransactionId,
          );
          if (txByExt) {
            return {
              transactionId: txByExt.id,
              status: txByExt.status,
              failureCode: txByExt.failureCode,
              balance: wallet.balance.toJSON(),
              idempotentReplay: true,
            };
          }
        }

        inboxMessage =
          existingInbox ??
          InboxMessage.receive({
            consumerName: options.consumerName,
            messageId: options.inboxMessageId,
            payloadHash,
          });
      }

      const now = new Date();
      const tx =
        existingTx && existingTx.status === WagerTransactionStatus.PendingReference
          ? existingTx
          : WagerTransaction.create({
              id: randomUUID(),
              providerId: dto.providerId,
              externalTransactionId: dto.externalTransactionId,
              idempotencyKey: options.idempotencyKey,
              payloadHash,
              walletId: wallet.id,
              playerId: wallet.playerId,
              roundId: dto.roundId,
              gameId: dto.gameId,
              kind: dto.kind,
              money,
              referenceExternalTransactionId: dto.referenceExternalTransactionId,
              createdAt: now,
            });

      // 4. Process operation by Kind
      switch (dto.kind) {
        case WagerTransactionKind.Loss: {
          tx.markProcessed(undefined, now);
          await this.txRepo.save(tx);

          const event = WagerTransactionProcessed.from(tx, {
            eventId: randomUUID(),
            correlationId,
            causationId,
            occurredAt: now,
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(event));
          break;
        }

        case WagerTransactionKind.Bet: {
          if (!wallet.canDebit(money)) {
            tx.reject(FailureCode.INSUFFICIENT_FUNDS, now);
            await this.txRepo.save(tx);

            const event = WagerTransactionRejected.from(
              tx,
              FailureCode.INSUFFICIENT_FUNDS,
              {
                eventId: randomUUID(),
                correlationId,
                causationId,
                occurredAt: now,
              },
            );
            await this.outboxRepo.save(OutboxMessage.enqueue(event));
          } else {
            const { balanceBefore, balanceAfter } = wallet.debit(money, now);
            tx.markProcessed(undefined, now);

            await this.walletRepo.save(wallet);
            await this.txRepo.save(tx);

            const ledgerEntry = WalletLedgerEntry.create({
              id: randomUUID(),
              walletId: wallet.id,
              transactionId: tx.id,
              direction: LedgerDirection.Debit,
              money,
              balanceBefore,
              balanceAfter,
              createdAt: now,
            });
            await this.ledgerRepo.save(ledgerEntry);

            const processedEvent = WagerTransactionProcessed.from(tx, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));

            const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
          }
          break;
        }

        case WagerTransactionKind.Win: {
          let refTxId: string | undefined;
          if (dto.referenceExternalTransactionId) {
            const refTx = await this.txRepo.findByProviderAndExternalId(
              dto.providerId,
              dto.referenceExternalTransactionId,
            );
            if (refTx && refTx.roundId === dto.roundId) {
              refTxId = refTx.id;
            }
          }

          const { balanceBefore, balanceAfter } = wallet.credit(money, now);
          tx.markProcessed(refTxId, now);

          await this.walletRepo.save(wallet);
          await this.txRepo.save(tx);

          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Credit,
            money,
            balanceBefore,
            balanceAfter,
            createdAt: now,
          });
          await this.ledgerRepo.save(ledgerEntry);

          const processedEvent = WagerTransactionProcessed.from(tx, {
            eventId: randomUUID(),
            correlationId,
            causationId,
            occurredAt: now,
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));

          const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
            eventId: randomUUID(),
            correlationId,
            causationId,
            occurredAt: now,
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
          break;
        }

        case WagerTransactionKind.Refund: {
          const refTx = await this.txRepo.findByProviderAndExternalId(
            dto.providerId,
            dto.referenceExternalTransactionId!,
          );

          if (!refTx) {
            // Out of order reference: persist as PENDING_REFERENCE
            tx.markPendingReference();
            await this.txRepo.save(tx);

            const pendingEvent = WagerTransactionPendingReference.from(tx, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(pendingEvent));
            break;
          }

          // Validate reference rules
          const validationError = this.validateRefundReference(refTx, wallet, dto, money);
          if (validationError) {
            tx.reject(validationError, now);
            await this.txRepo.save(tx);

            const rejectedEvent = WagerTransactionRejected.from(tx, validationError, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));
            break;
          }

          // Check if already refunded
          const alreadyRefunded = await this.txRepo.findReversal(
            dto.providerId,
            refTx.externalTransactionId,
            WagerTransactionKind.Refund,
          );

          if (alreadyRefunded) {
            tx.reject(FailureCode.REFERENCE_ALREADY_REVERSED, now);
            await this.txRepo.save(tx);

            const rejectedEvent = WagerTransactionRejected.from(
              tx,
              FailureCode.REFERENCE_ALREADY_REVERSED,
              {
                eventId: randomUUID(),
                correlationId,
                causationId,
                occurredAt: now,
              },
            );
            await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));
            break;
          }

          // Refund credits wallet
          const { balanceBefore, balanceAfter } = wallet.credit(money, now);
          tx.markProcessed(refTx.id, now);

          await this.walletRepo.save(wallet);
          await this.txRepo.save(tx);

          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Credit,
            money,
            balanceBefore,
            balanceAfter,
            createdAt: now,
          });
          await this.ledgerRepo.save(ledgerEntry);

          const processedEvent = WagerTransactionProcessed.from(tx, {
            eventId: randomUUID(),
            correlationId,
            causationId,
            occurredAt: now,
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));

          const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
            eventId: randomUUID(),
            correlationId,
            causationId,
            occurredAt: now,
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
          break;
        }

        case WagerTransactionKind.Rollback: {
          const refTx = await this.txRepo.findByProviderAndExternalId(
            dto.providerId,
            dto.referenceExternalTransactionId!,
          );

          if (!refTx) {
            // Out of order reference: persist as PENDING_REFERENCE
            tx.markPendingReference();
            await this.txRepo.save(tx);

            const pendingEvent = WagerTransactionPendingReference.from(tx, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(pendingEvent));
            break;
          }

          // Validate reference rules
          const validationError = this.validateRollbackReference(refTx, wallet, dto, money);
          if (validationError) {
            tx.reject(validationError, now);
            await this.txRepo.save(tx);

            const rejectedEvent = WagerTransactionRejected.from(tx, validationError, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));
            break;
          }

          // Check if already rolled back
          const alreadyRolledBack = await this.txRepo.findReversal(
            dto.providerId,
            refTx.externalTransactionId,
            WagerTransactionKind.Rollback,
          );

          if (alreadyRolledBack) {
            tx.reject(FailureCode.REFERENCE_ALREADY_REVERSED, now);
            await this.txRepo.save(tx);

            const rejectedEvent = WagerTransactionRejected.from(
              tx,
              FailureCode.REFERENCE_ALREADY_REVERSED,
              {
                eventId: randomUUID(),
                correlationId,
                causationId,
                occurredAt: now,
              },
            );
            await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));
            break;
          }

          const direction = tx.ledgerDirectionFor(refTx);

          if (direction === LedgerDirection.Debit) {
            // Reversal requires debit (e.g., rolling back WIN or REFUND)
            if (!wallet.canDebit(money)) {
              // Rule 7.9: Reversão que produziria saldo negativo é rejeitada explicitamente com NEGATIVE_BALANCE_PREVENTED
              tx.reject(FailureCode.NEGATIVE_BALANCE_PREVENTED, now);
              await this.txRepo.save(tx);

              const rejectedEvent = WagerTransactionRejected.from(
                tx,
                FailureCode.NEGATIVE_BALANCE_PREVENTED,
                {
                  eventId: randomUUID(),
                  correlationId,
                  causationId,
                  occurredAt: now,
                },
              );
              await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));
              break;
            }

            const { balanceBefore, balanceAfter } = wallet.debit(money, now);
            tx.markProcessed(refTx.id, now);

            await this.walletRepo.save(wallet);
            await this.txRepo.save(tx);

            const ledgerEntry = WalletLedgerEntry.create({
              id: randomUUID(),
              walletId: wallet.id,
              transactionId: tx.id,
              direction: LedgerDirection.Debit,
              money,
              balanceBefore,
              balanceAfter,
              createdAt: now,
            });
            await this.ledgerRepo.save(ledgerEntry);

            const processedEvent = WagerTransactionProcessed.from(tx, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));

            const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
          } else {
            // Reversal requires credit (e.g. rolling back a BET)
            const { balanceBefore, balanceAfter } = wallet.credit(money, now);
            tx.markProcessed(refTx.id, now);

            await this.walletRepo.save(wallet);
            await this.txRepo.save(tx);

            const ledgerEntry = WalletLedgerEntry.create({
              id: randomUUID(),
              walletId: wallet.id,
              transactionId: tx.id,
              direction: LedgerDirection.Credit,
              money,
              balanceBefore,
              balanceAfter,
              createdAt: now,
            });
            await this.ledgerRepo.save(ledgerEntry);

            const processedEvent = WagerTransactionProcessed.from(tx, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));

            const balanceEvent = WalletBalanceChanged.from(wallet, ledgerEntry, {
              eventId: randomUUID(),
              correlationId,
              causationId,
              occurredAt: now,
            });
            await this.outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
          }
          break;
        }

        default:
          throw new Error(`Unsupported transaction kind: ${dto.kind}`);
      }

      // Mark inbox message processed if applicable
      if (inboxMessage) {
        inboxMessage.markProcessed(now);
        await this.inboxRepo.save(inboxMessage);
      }

      return {
        transactionId: tx.id,
        status: tx.status,
        failureCode: tx.failureCode,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }

  private validateRefundReference(
    refTx: WagerTransaction,
    wallet: Wallet,
    dto: SubmitTransactionDto,
    money: Money,
  ): FailureCode | null {
    if (refTx.status !== WagerTransactionStatus.Processed) {
      return FailureCode.REFERENCE_INVALID_STATE;
    }
    if (refTx.kind !== WagerTransactionKind.Bet) {
      return FailureCode.REFERENCE_INVALID_KIND;
    }
    if (
      refTx.walletId !== wallet.id ||
      refTx.playerId !== wallet.playerId ||
      refTx.roundId !== dto.roundId ||
      refTx.money.currency !== money.currency
    ) {
      return FailureCode.REFERENCE_MISMATCH;
    }
    if (!refTx.money.equals(money)) {
      return FailureCode.AMOUNT_MISMATCH;
    }
    return null;
  }

  private validateRollbackReference(
    refTx: WagerTransaction,
    wallet: Wallet,
    dto: SubmitTransactionDto,
    money: Money,
  ): FailureCode | null {
    if (refTx.status !== WagerTransactionStatus.Processed) {
      return FailureCode.REFERENCE_INVALID_STATE;
    }
    if (
      refTx.kind !== WagerTransactionKind.Bet &&
      refTx.kind !== WagerTransactionKind.Win &&
      refTx.kind !== WagerTransactionKind.Refund
    ) {
      return FailureCode.REFERENCE_INVALID_KIND;
    }
    if (
      refTx.walletId !== wallet.id ||
      refTx.playerId !== wallet.playerId ||
      refTx.roundId !== dto.roundId ||
      refTx.money.currency !== money.currency
    ) {
      return FailureCode.REFERENCE_MISMATCH;
    }
    if (!refTx.money.equals(money)) {
      return FailureCode.AMOUNT_MISMATCH;
    }
    return null;
  }
}

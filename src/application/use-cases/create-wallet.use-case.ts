import { randomUUID } from 'crypto';
import { WalletAlreadyExistsError } from '../../domain/errors/domain-errors';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../../domain/models/ledger-entry';
import { Money } from '../../domain/models/money';
import { OutboxMessage } from '../../domain/models/outbox-message';
import { WagerTransaction } from '../../domain/models/wager-transaction';
import { Wallet } from '../../domain/models/wallet';
import { LEDGER_REPOSITORY_PORT, LedgerRepositoryPort } from '../../domain/ports/ledger.repository.port';
import { OUTBOX_REPOSITORY_PORT, OutboxRepositoryPort } from '../../domain/ports/outbox.repository.port';
import { UNIT_OF_WORK_PORT, UnitOfWorkPort } from '../../domain/ports/unit-of-work.port';
import {
  WAGER_TRANSACTION_REPOSITORY_PORT,
  WagerTransactionRepositoryPort,
} from '../../domain/ports/wager-transaction.repository.port';
import { WALLET_REPOSITORY_PORT, WalletRepositoryPort } from '../../domain/ports/wallet.repository.port';
import { CreateWalletDto, WalletResponseDto } from '../dtos/wagering.dto';

export class CreateWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly txRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: LedgerRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly uow: UnitOfWorkPort,
  ) {}

  public async execute(dto: CreateWalletDto): Promise<WalletResponseDto> {
    const initialMoney = Money.from(dto.initialBalance);

    return this.uow.runInTransaction(async () => {
      // Invariant: at most one wallet per playerId + currency
      const existing = await this.walletRepo.findByPlayerIdAndCurrency(
        dto.playerId,
        initialMoney.currency,
      );

      if (existing) {
        throw new WalletAlreadyExistsError(dto.playerId, initialMoney.currency);
      }

      const walletId = randomUUID();
      const wallet = Wallet.open({
        id: walletId,
        playerId: dto.playerId,
        initialBalance: initialMoney,
      });

      await this.walletRepo.save(wallet);

      // If initial balance is greater than zero, create OPENING transaction and ledger entry
      if (initialMoney.isPositive()) {
        const txId = randomUUID();
        const openingTx = WagerTransaction.createOpening({
          id: txId,
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: initialMoney,
        });

        await this.txRepo.save(openingTx);

        const zero = Money.zero(initialMoney.currency);
        const ledgerEntry = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: wallet.id,
          transactionId: openingTx.id,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: zero,
          balanceAfter: initialMoney,
        });

        await this.ledgerRepo.save(ledgerEntry);

        const event = WalletBalanceChanged.from(wallet, ledgerEntry, {
          eventId: randomUUID(),
          correlationId: `wallet-open-${wallet.id}`,
        });

        const outbox = OutboxMessage.enqueue(event);
        await this.outboxRepo.save(outbox);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
      };
    });
  }
}

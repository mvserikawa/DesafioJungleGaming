import { WalletNotFoundError } from '../../domain/errors/domain-errors';
import { LedgerRepositoryPort } from '../../domain/ports/ledger.repository.port';
import { WalletRepositoryPort } from '../../domain/ports/wallet.repository.port';
import { ReconcileWalletResponseDto } from '../dtos/wagering.dto';

export interface LoggerPort {
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly ledgerRepo: LedgerRepositoryPort,
    private readonly logger?: LoggerPort,
  ) {}

  public async execute(walletId: string): Promise<ReconcileWalletResponseDto> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const { calculatedBalance, checkedEntries } =
      await this.ledgerRepo.calculateReconciledBalance(wallet.id, wallet.currency);

    const difference = wallet.balance.subtract(calculatedBalance);
    const consistent = difference.isZero();

    if (!consistent) {
      this.logger?.warn('Wallet reconciliation divergence detected!', {
        walletId: wallet.id,
        storedBalance: wallet.balance.toString(),
        calculatedBalance: calculatedBalance.toString(),
        difference: difference.toString(),
        checkedEntries,
      });
    } else {
      this.logger?.info('Wallet reconciliation consistent', {
        walletId: wallet.id,
        balance: wallet.balance.toString(),
        checkedEntries,
      });
    }

    return {
      walletId: wallet.id,
      storedBalance: wallet.balance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries,
    };
  }
}

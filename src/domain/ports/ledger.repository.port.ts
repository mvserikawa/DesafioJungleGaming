import { WalletLedgerEntry } from '../models/ledger-entry';
import { Money } from '../models/money';

export const LEDGER_REPOSITORY_PORT = Symbol('LEDGER_REPOSITORY_PORT');

export interface LedgerPaginationOptions {
  cursor?: string;
  limit: number;
}

export interface PaginatedLedgerResult {
  entries: WalletLedgerEntry[];
  nextCursor?: string;
}

export interface ReconciledBalanceResult {
  calculatedBalance: Money;
  checkedEntries: number;
}

export interface LedgerRepositoryPort {
  save(entry: WalletLedgerEntry): Promise<void>;
  findByWalletId(
    walletId: string,
    options: LedgerPaginationOptions,
  ): Promise<PaginatedLedgerResult>;
  calculateReconciledBalance(
    walletId: string,
    currency: string,
  ): Promise<ReconciledBalanceResult>;
}

import { LedgerPaginationOptions, LedgerRepositoryPort, PaginatedLedgerResult } from '../../domain/ports/ledger.repository.port';

export class GetLedgerUseCase {
  constructor(private readonly ledgerRepo: LedgerRepositoryPort) {}

  public async execute(
    walletId: string,
    options: LedgerPaginationOptions,
  ): Promise<PaginatedLedgerResult> {
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    return this.ledgerRepo.findByWalletId(walletId, {
      cursor: options.cursor,
      limit,
    });
  }
}

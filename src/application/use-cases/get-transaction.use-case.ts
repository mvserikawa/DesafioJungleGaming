import { WagerTransaction } from '../../domain/models/wager-transaction';
import { WagerTransactionRepositoryPort } from '../../domain/ports/wager-transaction.repository.port';

export class GetTransactionUseCase {
  constructor(private readonly txRepo: WagerTransactionRepositoryPort) {}

  public async getById(transactionId: string): Promise<WagerTransaction | null> {
    return this.txRepo.findById(transactionId);
  }

  public async getByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.txRepo.findByProviderAndExternalId(providerId, externalTransactionId);
  }
}

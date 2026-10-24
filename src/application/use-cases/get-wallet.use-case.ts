import { WalletNotFoundError } from '../../domain/errors/domain-errors';
import { WalletRepositoryPort } from '../../domain/ports/wallet.repository.port';
import { WalletResponseDto } from '../dtos/wagering.dto';

export class GetWalletUseCase {
  constructor(private readonly walletRepo: WalletRepositoryPort) {}

  public async execute(walletId: string): Promise<WalletResponseDto> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}

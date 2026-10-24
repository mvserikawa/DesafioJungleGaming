import { Wallet } from '../models/wallet';

export const WALLET_REPOSITORY_PORT = Symbol('WALLET_REPOSITORY_PORT');

export interface WalletRepositoryPort {
  findById(id: string): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(playerId: string, currency: string): Promise<Wallet | null>;
  findByIdWithLock(id: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
}

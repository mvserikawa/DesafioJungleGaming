import { WagerTransaction } from '../models/wager-transaction';

export const WAGER_TRANSACTION_REPOSITORY_PORT = Symbol('WAGER_TRANSACTION_REPOSITORY_PORT');

export interface WagerTransactionRepositoryPort {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  findPendingReferences(limit: number): Promise<WagerTransaction[]>;
  findReversal(
    providerId: string,
    referenceExternalTransactionId: string,
    kind: string,
  ): Promise<WagerTransaction | null>;
  save(transaction: WagerTransaction): Promise<void>;
}

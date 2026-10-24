import { FailureCode } from '../../domain/errors/failure-codes';
import { MoneyProps } from '../../domain/models/money';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/models/wager-transaction';

export interface CreateWalletDto {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface WalletResponseDto {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitTransactionDto {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface TransactionResponseDto {
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  balance: MoneyProps;
  idempotentReplay: boolean;
}

export interface ReconcileWalletResponseDto {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FailureCode } from '../../domain/errors/failure-codes';
import { MoneyProps } from '../../domain/models/money';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/models/wager-transaction';

export class MoneyDto implements MoneyProps {
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}

export class WalletResponseDto {
  id!: string;
  playerId!: string;
  balance!: MoneyProps;
  version!: number;
  createdAt!: string;
  updatedAt!: string;
}

export class SubmitTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsString()
  @IsOptional()
  referenceExternalTransactionId?: string;
}

export class TransactionResponseDto {
  transactionId!: string;
  status!: WagerTransactionStatus;
  failureCode?: FailureCode;
  balance!: MoneyProps;
  idempotentReplay!: boolean;
}

export class ReconcileWalletResponseDto {
  walletId!: string;
  storedBalance!: MoneyProps;
  calculatedBalance!: MoneyProps;
  difference!: MoneyProps;
  consistent!: boolean;
  checkedEntries!: number;
}

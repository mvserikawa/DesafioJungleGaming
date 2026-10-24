import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreateWalletUseCase } from '../../../application/use-cases/create-wallet.use-case';
import { GetLedgerUseCase } from '../../../application/use-cases/get-ledger.use-case';
import { GetWalletUseCase } from '../../../application/use-cases/get-wallet.use-case';
import { ReconcileWalletUseCase } from '../../../application/use-cases/reconcile-wallet.use-case';
import {
  CreateWalletDto,
  ReconcileWalletResponseDto,
  WalletResponseDto,
} from '../../../application/dtos/wagering.dto';
import { PaginatedLedgerResult } from '../../../domain/ports/ledger.repository.port';

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly getLedgerUseCase: GetLedgerUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async createWallet(
    @Body() dto: CreateWalletDto,
  ): Promise<WalletResponseDto> {
    return this.createWalletUseCase.execute(dto);
  }

  @Get(':walletId')
  public async getWallet(
    @Param('walletId') walletId: string,
  ): Promise<WalletResponseDto> {
    return this.getWalletUseCase.execute(walletId);
  }

  @Get(':walletId/ledger')
  public async getLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<PaginatedLedgerResult> {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    return this.getLedgerUseCase.execute(walletId, { cursor, limit });
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  public async reconcile(
    @Param('walletId') walletId: string,
  ): Promise<ReconcileWalletResponseDto> {
    return this.reconcileWalletUseCase.execute(walletId);
  }
}

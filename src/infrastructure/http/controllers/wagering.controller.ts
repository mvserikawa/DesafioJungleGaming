import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { GetTransactionUseCase } from '../../../application/use-cases/get-transaction.use-case';
import { ProcessWagerTransactionUseCase } from '../../../application/use-cases/process-wager-transaction.use-case';
import {
  SubmitTransactionDto,
  TransactionResponseDto,
} from '../../../application/dtos/wagering.dto';
import { WagerTransactionStatus } from '../../../domain/models/wager-transaction';
import { metricsService } from '../../observability/metrics.service';

@Controller()
export class WageringController {
  constructor(
    private readonly processWagerUseCase: ProcessWagerTransactionUseCase,
    private readonly getTxUseCase: GetTransactionUseCase,
  ) {}

  @Post('wagering/transactions')
  public async submitTransaction(
    @Body() dto: SubmitTransactionDto,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Headers('x-correlation-id') correlationIdHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionResponseDto> {
    const idempotencyKey =
      idempotencyKeyHeader || `${dto.providerId}:${dto.externalTransactionId}`;

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const startTime = performance.now();
    const result = await this.processWagerUseCase.execute(dto, {
      idempotencyKey,
      correlationId: correlationIdHeader,
    });

    const durationSec = (performance.now() - startTime) / 1000;
    metricsService.processingLatencySeconds.observe(
      { kind: dto.kind, status: result.status },
      durationSec,
    );

    if (result.idempotentReplay) {
      metricsService.idempotentReplaysTotal.inc({ provider: dto.providerId });
    }

    metricsService.wagerTransactionsTotal.inc({
      status: result.status,
      provider: dto.providerId,
      kind: dto.kind,
    });

    // Clean HTTP status mapping
    if (result.status === WagerTransactionStatus.Processed) {
      res.status(HttpStatus.OK);
    } else if (result.status === WagerTransactionStatus.PendingReference) {
      res.status(HttpStatus.ACCEPTED);
    } else if (result.status === WagerTransactionStatus.Rejected) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
    } else {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return result;
  }

  @Get('wagering/transactions/:transactionId')
  public async getTransactionById(
    @Param('transactionId') transactionId: string,
  ): Promise<any> {
    const tx = await this.getTxUseCase.getById(transactionId);
    if (!tx) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      failureCode: tx.failureCode,
      referenceTransactionId: tx.referenceTransactionId,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      processedAt: tx.processedAt?.toISOString(),
      createdAt: tx.createdAt.toISOString(),
    };
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  public async getTransactionByExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ): Promise<any> {
    const tx = await this.getTxUseCase.getByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!tx) {
      throw new NotFoundException(
        `Transaction ${externalTransactionId} for provider ${providerId} not found`,
      );
    }
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      failureCode: tx.failureCode,
      referenceTransactionId: tx.referenceTransactionId,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      processedAt: tx.processedAt?.toISOString(),
      createdAt: tx.createdAt.toISOString(),
    };
  }
}

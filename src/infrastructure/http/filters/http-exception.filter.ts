import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  CurrencyMismatchError,
  DomainError,
  IdempotencyConflictError,
  InvalidMoneyError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '../../../domain/errors/domain-errors';
import { FailureCode } from '../../../domain/errors/failure-codes';
import { appLogger } from '../../observability/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let failureCode = FailureCode.INTERNAL_ERROR;
    let message = 'An unexpected internal error occurred';
    let details: unknown = undefined;

    if (exception instanceof IdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      failureCode = FailureCode.IDEMPOTENCY_CONFLICT;
      message = exception.message;
    } else if (exception instanceof WalletAlreadyExistsError) {
      status = HttpStatus.CONFLICT;
      failureCode = FailureCode.WALLET_ALREADY_EXISTS;
      message = exception.message;
    } else if (exception instanceof WalletNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      failureCode = FailureCode.WALLET_NOT_FOUND;
      message = exception.message;
    } else if (
      exception instanceof CurrencyMismatchError ||
      exception instanceof InvalidMoneyError
    ) {
      status = HttpStatus.BAD_REQUEST;
      failureCode = exception.code;
      message = exception.message;
    } else if (exception instanceof DomainError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      failureCode = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message =
        typeof res === 'object' && res !== null && 'message' in res
          ? (res as any).message
          : exception.message;
      details = res;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    appLogger.warn('HTTP request failed with error', {
      path: request.path,
      method: request.method,
      statusCode: status,
      failureCode,
      message,
    });

    response.status(status).json({
      statusCode: status,
      failureCode,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

import pino from 'pino';

export interface LogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  [key: string]: unknown;
}

export class AppLogger {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  public info(message: string, context?: LogContext): void {
    this.logger.info(context ?? {}, message);
  }

  public warn(message: string, context?: LogContext): void {
    this.logger.warn(context ?? {}, message);
  }

  public error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errObj = error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    this.logger.error({ ...errObj, ...(context ?? {}) }, message);
  }

  public debug(message: string, context?: LogContext): void {
    this.logger.debug(context ?? {}, message);
  }
}

export const appLogger = new AppLogger();

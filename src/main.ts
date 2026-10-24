import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './infrastructure/http/filters/http-exception.filter';
import { LoggingInterceptor } from './infrastructure/http/interceptors/logging.interceptor';
import { appLogger } from './infrastructure/observability/logger.service';
import { OutboxWorkerService } from './infrastructure/messaging/outbox/outbox-worker.service';
import { SqsConsumerService } from './infrastructure/messaging/sqs/sqs-consumer.service';
import { PendingReferenceWorkerService } from './infrastructure/messaging/outbox/pending-reference-worker.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: false, // Use our structured Pino logger
  });

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Background workers (only if not disabled by env)
  if (process.env.START_WORKERS !== 'false') {
    const outboxWorker = app.get(OutboxWorkerService);
    outboxWorker.start();

    const sqsConsumer = app.get(SqsConsumerService);
    sqsConsumer.start();

    const pendingRefWorker = app.get(PendingReferenceWorkerService);
    pendingRefWorker.start();

    const shutdown = async (signal: string) => {
      appLogger.info(`Received ${signal}, commencing graceful shutdown...`);
      outboxWorker.stop();
      await sqsConsumer.stop();
      pendingRefWorker.stop();
      await app.close();
      appLogger.info('Graceful shutdown completed successfully.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  appLogger.info(`Distributed Wagering Processor service listening on port ${port}`);
}

bootstrap().catch((err) => {
  appLogger.error('Fatal startup error', err);
  process.exit(1);
});

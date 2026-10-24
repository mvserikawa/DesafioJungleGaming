import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/core';
import mikroOrmConfig from './infrastructure/database/mikro-orm.config';
import { WALLET_REPOSITORY_PORT } from './domain/ports/wallet.repository.port';
import { WAGER_TRANSACTION_REPOSITORY_PORT } from './domain/ports/wager-transaction.repository.port';
import { LEDGER_REPOSITORY_PORT } from './domain/ports/ledger.repository.port';
import { INBOX_REPOSITORY_PORT } from './domain/ports/inbox.repository.port';
import { OUTBOX_REPOSITORY_PORT } from './domain/ports/outbox.repository.port';
import { UNIT_OF_WORK_PORT } from './domain/ports/unit-of-work.port';
import { EVENT_PUBLISHER_PORT } from './domain/ports/event-publisher.port';
import { PROVIDER_IDENTITY_PORT } from './domain/ports/provider-identity.port';

import { MikroOrmWalletRepository } from './infrastructure/database/repositories/wallet.repository';
import { MikroOrmWagerTransactionRepository } from './infrastructure/database/repositories/wager-transaction.repository';
import { MikroOrmLedgerRepository } from './infrastructure/database/repositories/ledger.repository';
import { MikroOrmInboxRepository } from './infrastructure/database/repositories/inbox.repository';
import { MikroOrmOutboxRepository } from './infrastructure/database/repositories/outbox.repository';
import { MikroOrmUnitOfWork } from './infrastructure/database/mikro-orm.unit-of-work';

import { createSqsClient } from './infrastructure/messaging/sqs/sqs-client.factory';
import { SqsEventPublisher } from './infrastructure/messaging/outbox/sqs-event-publisher';
import { DefaultProviderIdentityService } from './infrastructure/http/guards/provider-auth.guard';

import { CreateWalletUseCase } from './application/use-cases/create-wallet.use-case';
import { GetWalletUseCase } from './application/use-cases/get-wallet.use-case';
import { GetLedgerUseCase } from './application/use-cases/get-ledger.use-case';
import { GetTransactionUseCase } from './application/use-cases/get-transaction.use-case';
import { ReconcileWalletUseCase } from './application/use-cases/reconcile-wallet.use-case';
import { ProcessWagerTransactionUseCase } from './application/use-cases/process-wager-transaction.use-case';
import { ResolvePendingReferencesUseCase } from './application/use-cases/resolve-pending-references.use-case';

import { WalletsController } from './infrastructure/http/controllers/wallets.controller';
import { WageringController } from './infrastructure/http/controllers/wagering.controller';
import { HealthController } from './infrastructure/http/controllers/health.controller';

import { OutboxWorkerService } from './infrastructure/messaging/outbox/outbox-worker.service';
import { SqsConsumerService } from './infrastructure/messaging/sqs/sqs-consumer.service';
import { PendingReferenceWorkerService } from './infrastructure/messaging/outbox/pending-reference-worker.service';
import { SQSClient } from '@aws-sdk/client-sqs';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [WalletsController, WageringController, HealthController],
  providers: [
    // SQS Client
    {
      provide: SQSClient,
      useFactory: () => createSqsClient(),
    },

    // Repositories & Ports
    {
      provide: WALLET_REPOSITORY_PORT,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmWalletRepository(em),
    },
    {
      provide: WAGER_TRANSACTION_REPOSITORY_PORT,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmWagerTransactionRepository(em),
    },
    {
      provide: LEDGER_REPOSITORY_PORT,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmLedgerRepository(em),
    },
    {
      provide: INBOX_REPOSITORY_PORT,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmInboxRepository(em),
    },
    {
      provide: OUTBOX_REPOSITORY_PORT,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmOutboxRepository(em),
    },
    {
      provide: UNIT_OF_WORK_PORT,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmUnitOfWork(em),
    },
    {
      provide: EVENT_PUBLISHER_PORT,
      inject: [SQSClient],
      useFactory: (sqsClient: SQSClient) =>
        new SqsEventPublisher(
          sqsClient,
          process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo',
        ),
    },
    {
      provide: PROVIDER_IDENTITY_PORT,
      useClass: DefaultProviderIdentityService,
    },

    // Application Use Cases
    {
      provide: CreateWalletUseCase,
      inject: [
        WALLET_REPOSITORY_PORT,
        WAGER_TRANSACTION_REPOSITORY_PORT,
        LEDGER_REPOSITORY_PORT,
        OUTBOX_REPOSITORY_PORT,
        UNIT_OF_WORK_PORT,
      ],
      useFactory: (w, t, l, o, uow) => new CreateWalletUseCase(w, t, l, o, uow),
    },
    {
      provide: GetWalletUseCase,
      inject: [WALLET_REPOSITORY_PORT],
      useFactory: (w) => new GetWalletUseCase(w),
    },
    {
      provide: GetLedgerUseCase,
      inject: [LEDGER_REPOSITORY_PORT],
      useFactory: (l) => new GetLedgerUseCase(l),
    },
    {
      provide: GetTransactionUseCase,
      inject: [WAGER_TRANSACTION_REPOSITORY_PORT],
      useFactory: (t) => new GetTransactionUseCase(t),
    },
    {
      provide: ReconcileWalletUseCase,
      inject: [WALLET_REPOSITORY_PORT, LEDGER_REPOSITORY_PORT],
      useFactory: (w, l) => new ReconcileWalletUseCase(w, l),
    },
    {
      provide: ProcessWagerTransactionUseCase,
      inject: [
        WALLET_REPOSITORY_PORT,
        WAGER_TRANSACTION_REPOSITORY_PORT,
        LEDGER_REPOSITORY_PORT,
        INBOX_REPOSITORY_PORT,
        OUTBOX_REPOSITORY_PORT,
        UNIT_OF_WORK_PORT,
      ],
      useFactory: (w, t, l, i, o, uow) =>
        new ProcessWagerTransactionUseCase(w, t, l, i, o, uow),
    },
    {
      provide: ResolvePendingReferencesUseCase,
      inject: [
        WAGER_TRANSACTION_REPOSITORY_PORT,
        OUTBOX_REPOSITORY_PORT,
        ProcessWagerTransactionUseCase,
        UNIT_OF_WORK_PORT,
      ],
      useFactory: (t, o, p, uow) =>
        new ResolvePendingReferencesUseCase(t, o, p, uow),
    },

    // Background Workers
    {
      provide: OutboxWorkerService,
      inject: [OUTBOX_REPOSITORY_PORT, EVENT_PUBLISHER_PORT],
      useFactory: (outboxRepo, publisher) =>
        new OutboxWorkerService(outboxRepo, publisher, {
          batchSize: 50,
          pollIntervalMs: 500,
        }),
    },
    {
      provide: SqsConsumerService,
      inject: [SQSClient, ProcessWagerTransactionUseCase],
      useFactory: (sqsClient, processUseCase) =>
        new SqsConsumerService(sqsClient, processUseCase, {
          queueUrl:
            process.env.SQS_QUEUE_URL ||
            'http://localhost:4566/000000000000/wager-transactions.fifo',
          dlqUrl:
            process.env.SQS_DLQ_URL ||
            'http://localhost:4566/000000000000/wager-transactions-dlq.fifo',
          maxReceiveCount: 3,
        }),
    },
  {
    provide: PendingReferenceWorkerService,
    inject: [ResolvePendingReferencesUseCase, EntityManager],
    useFactory: (
      resolveUseCase: ResolvePendingReferencesUseCase,
      em: EntityManager,
  ) =>
    new PendingReferenceWorkerService(resolveUseCase, em, {
      intervalMs: 5000,
      batchSize: 50,
    }),
},
  ],
})
export class AppModule {}

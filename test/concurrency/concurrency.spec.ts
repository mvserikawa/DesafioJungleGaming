import { beforeEach, describe, expect, it } from 'bun:test';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/reconcile-wallet.use-case';
import { ResolvePendingReferencesUseCase } from '../../src/application/use-cases/resolve-pending-references.use-case';
import { OutboxWorkerService } from '../../src/infrastructure/messaging/outbox/outbox-worker.service';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs/sqs-consumer.service';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/models/wager-transaction';
import { EventPublisherPort } from '../../src/domain/ports/event-publisher.port';
import { OutboxMessage } from '../../src/domain/models/outbox-message';
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryUnitOfWork,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '../mocks/in-memory-uow';

describe('Concurrency and Failure Recovery Scenarios', () => {
  let walletRepo: InMemoryWalletRepository;
  let txRepo: InMemoryWagerTransactionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let uow: InMemoryUnitOfWork;

  let createWalletUseCase: CreateWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;
  let resolvePendingUseCase: ResolvePendingReferencesUseCase;

  beforeEach(() => {
    walletRepo = new InMemoryWalletRepository();
    txRepo = new InMemoryWagerTransactionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    inboxRepo = new InMemoryInboxRepository();
    outboxRepo = new InMemoryOutboxRepository();
    uow = new InMemoryUnitOfWork();

    createWalletUseCase = new CreateWalletUseCase(
      walletRepo,
      txRepo,
      ledgerRepo,
      outboxRepo,
      uow,
    );
    processWagerUseCase = new ProcessWagerTransactionUseCase(
      walletRepo,
      txRepo,
      ledgerRepo,
      inboxRepo,
      outboxRepo,
      uow,
    );
    reconcileWalletUseCase = new ReconcileWalletUseCase(walletRepo, ledgerRepo);
    resolvePendingUseCase = new ResolvePendingReferencesUseCase(
      txRepo,
      outboxRepo,
      processWagerUseCase,
      uow,
    );
  });

  it('1. Same bet submitted 50 times in parallel results in exactly ONE debit', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-50-parallel',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    const dto = {
      providerId: 'provider-burst',
      externalTransactionId: 'burst-bet-1',
      playerId: 'player-50-parallel',
      walletId: wallet.id,
      roundId: 'round-burst',
      gameId: 'game-burst',
      kind: WagerTransactionKind.Bet,
      money: { amount: '10.00', currency: 'BRL' },
    };

    // 50 concurrent invocations with the same idempotency key
    const promises = Array.from({ length: 50 }, () =>
      processWagerUseCase.execute(dto, { idempotencyKey: 'burst-bet-key-1' }),
    );

    const results = await Promise.all(promises);

    // All results must report PROCESSED
    for (const res of results) {
      expect(res.status).toBe(WagerTransactionStatus.Processed);
    }

    // Exactly 1 initial call (idempotentReplay: false) and 49 replays (idempotentReplay: true)
    const initialCalls = results.filter((r) => !r.idempotentReplay);
    const replays = results.filter((r) => r.idempotentReplay);

    expect(initialCalls.length).toBe(1);
    expect(replays.length).toBe(49);

    // Wallet balance must have been debited exactly once: 1000.00 - 10.00 = 990.00
    const updatedWallet = await walletRepo.findById(wallet.id);
    expect(updatedWallet?.balance.toString()).toBe('990.00');

    // Exactly 1 opening credit + 1 bet debit in ledger
    const walletEntries = ledgerRepo.entries.filter((e) => e.walletId === wallet.id);
    expect(walletEntries.length).toBe(2);

    // Invariant: wallet.balance == sum(ledger entries)
    const recon = await reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance).toEqual({ amount: '990.00', currency: 'BRL' });
  });

  it('2. Racing operations competing for same wallet balance (Section 8 scenario)', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-race',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const bet1 = processWagerUseCase.execute(
      {
        providerId: 'provider-1',
        externalTransactionId: 'race-bet-1',
        playerId: 'player-race',
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '80.00', currency: 'BRL' },
      },
      { idempotencyKey: 'race-key-1' },
    );

    const bet2 = processWagerUseCase.execute(
      {
        providerId: 'provider-1',
        externalTransactionId: 'race-bet-2',
        playerId: 'player-race',
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '80.00', currency: 'BRL' },
      },
      { idempotencyKey: 'race-key-2' },
    );

    const [r1, r2] = await Promise.all([bet1, bet2]);
    const statuses = [r1.status, r2.status].sort();

    expect(statuses).toEqual([
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
    ]);

    const updatedWallet = await walletRepo.findById(wallet.id);
    expect(updatedWallet?.balance.toString()).toBe('20.00');

    const recon = await reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
  });

  it('3. Multiple distinct wallets processed in parallel with high concurrency', async () => {
    const walletCount = 5;
    const betsPerWallet = 5;

    const wallets = await Promise.all(
      Array.from({ length: walletCount }, (_, i) =>
        createWalletUseCase.execute({
          playerId: `multi-player-${i}`,
          initialBalance: { amount: '100.00', currency: 'BRL' },
        }),
      ),
    );

    const allOperations: Promise<any>[] = [];
    for (let w = 0; w < walletCount; w++) {
      for (let b = 0; b < betsPerWallet; b++) {
        allOperations.push(
          processWagerUseCase.execute(
            {
              providerId: 'provider-multi',
              externalTransactionId: `tx-w${w}-b${b}`,
              playerId: wallets[w].playerId,
              walletId: wallets[w].id,
              roundId: `round-${b}`,
              gameId: 'game-multi',
              kind: WagerTransactionKind.Bet,
              money: { amount: '10.00', currency: 'BRL' },
            },
            { idempotencyKey: `multi-key-w${w}-b${b}` },
          ),
        );
      }
    }

    await Promise.all(allOperations);

    // Verify all wallets and their reconciliations
    for (const w of wallets) {
      const recon = await reconcileWalletUseCase.execute(w.id);
      expect(recon.consistent).toBe(true);
      // 100.00 - 5 * 10.00 = 50.00
      expect(recon.storedBalance).toEqual({ amount: '50.00', currency: 'BRL' });
      expect(recon.checkedEntries).toBe(6); // 1 opening + 5 bets
    }
  });

  it('4. Two publishers running concurrently on the same outbox', async () => {
    const publishedEvents: string[] = [];
    const mockPublisher: EventPublisherPort = {
      publish: async (msg: OutboxMessage) => {
        publishedEvents.push(msg.id);
      },
    };

    const worker1 = new OutboxWorkerService(outboxRepo, mockPublisher, { batchSize: 10 });
    const worker2 = new OutboxWorkerService(outboxRepo, mockPublisher, { batchSize: 10 });

    // Seed wallet and transactions generating outbox events
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-outbox',
      initialBalance: { amount: '200.00', currency: 'BRL' },
    });

    await processWagerUseCase.execute(
      {
        providerId: 'p1',
        externalTransactionId: 'tx-pub-1',
        playerId: 'player-outbox',
        walletId: wallet.id,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '20.00', currency: 'BRL' },
      },
      { idempotencyKey: 'pub-key-1' },
    );

    // Both workers tick simultaneously
    await Promise.all([worker1.tick(), worker2.tick()]);

    // All events are published
    const remainingPending = await outboxRepo.findDueMessagesWithLock(10);
    expect(remainingPending.length).toBe(0);
  });

  it('5. Worker crash after commit and before SQS ACK: redelivery is idempotent', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-redelivery',
      initialBalance: { amount: '200.00', currency: 'BRL' },
    });

    const mockSqsClient = {
      send: async () => ({}),
    } as any;

    const consumer = new SqsConsumerService(mockSqsClient, processWagerUseCase, {
      queueUrl: 'http://test-queue',
      dlqUrl: 'http://test-dlq',
      consumerName: 'test-consumer',
    });

    const sqsMessage = {
      MessageId: 'sqs-msg-12345',
      Body: JSON.stringify({
        messageId: 'sqs-msg-12345',
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: {
          providerId: 'provider-crash',
          externalTransactionId: 'crash-tx-1',
          idempotencyKey: 'provider-crash:crash-tx-1',
          playerId: 'player-redelivery',
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '50.00', currency: 'BRL' },
        },
      }),
    };

    // First delivery (commits)
    await consumer.handleMessage(sqsMessage);

    // Balance is now 150.00
    let currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('150.00');

    // Second delivery (simulating crash before ack, redelivery from SQS)
    await consumer.handleMessage(sqsMessage);

    // Balance MUST still be 150.00 — NO duplicate debit!
    currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('150.00');

    // Ledger has exactly 1 debit entry for this bet
    const walletEntries = ledgerRepo.entries.filter((e) => e.walletId === wallet.id);
    expect(walletEntries.length).toBe(2); // 1 opening + 1 bet
  });

  it('6. ROLLBACK delivered before referenced BET (Out of Order resolution)', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-ooo',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    // 1. ROLLBACK arrives first!
    const earlyRollback = await processWagerUseCase.execute(
      {
        providerId: 'provider-ooo',
        externalTransactionId: 'rb-early',
        playerId: 'player-ooo',
        walletId: wallet.id,
        roundId: 'round-ooo',
        gameId: 'game-ooo',
        kind: WagerTransactionKind.Rollback,
        money: { amount: '40.00', currency: 'BRL' },
        referenceExternalTransactionId: 'bet-late',
      },
      { idempotencyKey: 'key-rb-early' },
    );

    expect(earlyRollback.status).toBe(WagerTransactionStatus.PendingReference);
    // Balance unaffected
    let currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('100.00');

    // 2. BET arrives later!
    const lateBet = await processWagerUseCase.execute(
      {
        providerId: 'provider-ooo',
        externalTransactionId: 'bet-late',
        playerId: 'player-ooo',
        walletId: wallet.id,
        roundId: 'round-ooo',
        gameId: 'game-ooo',
        kind: WagerTransactionKind.Bet,
        money: { amount: '40.00', currency: 'BRL' },
      },
      { idempotencyKey: 'key-bet-late' },
    );

    expect(lateBet.status).toBe(WagerTransactionStatus.Processed);
    // Balance debited by BET: 100.00 - 40.00 = 60.00
    currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('60.00');

    // 3. Pending reference worker ticks and resolves pending rollback
    const resolvedCount = await resolvePendingUseCase.execute({ maxAgeMs: 60000 });
    expect(resolvedCount).toBe(1);

    // Rollback of BET is CREDIT: 60.00 + 40.00 = 100.00
    currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('100.00');

    // Ledger reconciliation invariant check
    const recon = await reconcileWalletUseCase.execute(wallet.id);
    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  it('7. Service restart with final ledger consistency verification', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-restart',
      initialBalance: { amount: '300.00', currency: 'BRL' },
    });

    // Run multiple mixed operations
    await processWagerUseCase.execute(
      {
        providerId: 'p1',
        externalTransactionId: 'tx-1',
        playerId: 'player-restart',
        walletId: wallet.id,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '50.00', currency: 'BRL' },
      },
      { idempotencyKey: 'k1' },
    );

    await processWagerUseCase.execute(
      {
        providerId: 'p1',
        externalTransactionId: 'tx-2',
        playerId: 'player-restart',
        walletId: wallet.id,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Win,
        money: { amount: '120.00', currency: 'BRL' },
      },
      { idempotencyKey: 'k2' },
    );

    await processWagerUseCase.execute(
      {
        providerId: 'p1',
        externalTransactionId: 'tx-3',
        playerId: 'player-restart',
        walletId: wallet.id,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Loss,
        money: { amount: '20.00', currency: 'BRL' },
      },
      { idempotencyKey: 'k3' },
    );

    // Simulate service restart: instantiate fresh new use case instances pointing to same persistence
    const restartedReconcileUseCase = new ReconcileWalletUseCase(
      walletRepo,
      ledgerRepo,
    );
    const recon = await restartedReconcileUseCase.execute(wallet.id);

    // Expected balance: 300 - 50 + 120 = 370.00 BRL
    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance).toEqual({ amount: '370.00', currency: 'BRL' });
    expect(recon.calculatedBalance).toEqual({ amount: '370.00', currency: 'BRL' });
    expect(recon.difference).toEqual({ amount: '0.00', currency: 'BRL' });
  });
});

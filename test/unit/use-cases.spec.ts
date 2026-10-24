import { beforeEach, describe, expect, it } from 'bun:test';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/reconcile-wallet.use-case';
import {
  IdempotencyConflictError,
  WalletAlreadyExistsError,
} from '../../src/domain/errors/domain-errors';
import { FailureCode } from '../../src/domain/errors/failure-codes';
import {
  LedgerDirection,
} from '../../src/domain/models/ledger-entry';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/models/wager-transaction';
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryUnitOfWork,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '../mocks/in-memory-uow';

describe('Application Use Cases', () => {
  let walletRepo: InMemoryWalletRepository;
  let txRepo: InMemoryWagerTransactionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let inboxRepo: InMemoryInboxRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let uow: InMemoryUnitOfWork;

  let createWalletUseCase: CreateWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;

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
  });

  describe('CreateWalletUseCase', () => {
    it('creates a new wallet and records internal OPENING transaction and ledger entry', async () => {
      const res = await createWalletUseCase.execute({
        playerId: 'player-1',
        initialBalance: { amount: '1000.00', currency: 'BRL' },
      });

      expect(res.id).toBeDefined();
      expect(res.playerId).toBe('player-1');
      expect(res.balance).toEqual({ amount: '1000.00', currency: 'BRL' });
      expect(res.version).toBe(1);

      // Verify internal opening transaction
      const openingTx = await txRepo.findByProviderAndExternalId(
        'INTERNAL',
        `opening-${res.id}`,
      );
      expect(openingTx).toBeDefined();
      expect(openingTx?.kind).toBe(WagerTransactionKind.Opening);
      expect(openingTx?.status).toBe(WagerTransactionStatus.Processed);

      // Verify ledger entry
      expect(ledgerRepo.entries.length).toBe(1);
      expect(ledgerRepo.entries[0].direction).toBe(LedgerDirection.Credit);
      expect(ledgerRepo.entries[0].money.toString()).toBe('1000.00');

      // Verify outbox message
      expect(outboxRepo.messages.length).toBe(1);
      expect(outboxRepo.messages[0].eventType).toBe('WalletBalanceChanged');
    });

    it('rejects duplicate wallet for same playerId and currency', async () => {
      await createWalletUseCase.execute({
        playerId: 'player-1',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });

      expect(
        createWalletUseCase.execute({
          playerId: 'player-1',
          initialBalance: { amount: '50.00', currency: 'BRL' },
        }),
      ).rejects.toThrow(WalletAlreadyExistsError);
    });
  });

  describe('ProcessWagerTransactionUseCase', () => {
    let walletId: string;

    beforeEach(async () => {
      const wallet = await createWalletUseCase.execute({
        playerId: 'player-1',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });
      walletId = wallet.id;
    });

    it('processes a valid BET: debits wallet, creates DEBIT ledger, outbox events', async () => {
      const res = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'bet-1',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '25.00', currency: 'BRL' },
        },
        { idempotencyKey: 'provider-a:bet-1' },
      );

      expect(res.status).toBe(WagerTransactionStatus.Processed);
      expect(res.balance).toEqual({ amount: '75.00', currency: 'BRL' });
      expect(res.idempotentReplay).toBe(false);

      // 1 opening + 1 bet
      expect(ledgerRepo.entries.length).toBe(2);
      expect(ledgerRepo.entries[1].direction).toBe(LedgerDirection.Debit);
      expect(ledgerRepo.entries[1].money.toString()).toBe('25.00');
    });

    it('rejects a BET when balance is insufficient (status REJECTED, no ledger mutation)', async () => {
      const res = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'bet-large',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '150.00', currency: 'BRL' },
        },
        { idempotencyKey: 'provider-a:bet-large' },
      );

      expect(res.status).toBe(WagerTransactionStatus.Rejected);
      expect(res.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
      expect(res.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      // No new ledger entry
      expect(ledgerRepo.entries.length).toBe(1);
    });

    it('processes a WIN: credits wallet and creates CREDIT ledger entry', async () => {
      const res = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'win-1',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Win,
          money: { amount: '50.00', currency: 'BRL' },
        },
        { idempotencyKey: 'provider-a:win-1' },
      );

      expect(res.status).toBe(WagerTransactionStatus.Processed);
      expect(res.balance).toEqual({ amount: '150.00', currency: 'BRL' });
      expect(ledgerRepo.entries.length).toBe(2);
      expect(ledgerRepo.entries[1].direction).toBe(LedgerDirection.Credit);
    });

    it('processes a LOSS: no balance effect, no ledger entry', async () => {
      const res = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'loss-1',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Loss,
          money: { amount: '25.00', currency: 'BRL' },
        },
        { idempotencyKey: 'provider-a:loss-1' },
      );

      expect(res.status).toBe(WagerTransactionStatus.Processed);
      expect(res.balance).toEqual({ amount: '100.00', currency: 'BRL' });
      // Only initial opening ledger entry
      expect(ledgerRepo.entries.length).toBe(1);
    });

    it('processes a REFUND: reverses processed BET exactly once', async () => {
      // 1. Process BET
      await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'bet-to-refund',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '30.00', currency: 'BRL' },
        },
        { idempotencyKey: 'key-bet-to-refund' },
      );

      // Balance is now 70.00
      // 2. Process REFUND
      const refundRes = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'refund-1',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Refund,
          money: { amount: '30.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-to-refund',
        },
        { idempotencyKey: 'key-refund-1' },
      );

      expect(refundRes.status).toBe(WagerTransactionStatus.Processed);
      expect(refundRes.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      // 3. Attempting second REFUND for same BET is rejected
      const secondRefund = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'refund-2',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Refund,
          money: { amount: '30.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-to-refund',
        },
        { idempotencyKey: 'key-refund-2' },
      );

      expect(secondRefund.status).toBe(WagerTransactionStatus.Rejected);
      expect(secondRefund.failureCode).toBe(FailureCode.REFERENCE_ALREADY_REVERSED);
    });

    it('processes ROLLBACK: reverses WIN by debiting wallet', async () => {
      // 1. Process WIN of 50.00 (Balance becomes 150.00)
      await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'win-to-rollback',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Win,
          money: { amount: '50.00', currency: 'BRL' },
        },
        { idempotencyKey: 'key-win-rb' },
      );

      // 2. Rollback WIN (Balance returns to 100.00)
      const rbRes = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'rb-win',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Rollback,
          money: { amount: '50.00', currency: 'BRL' },
          referenceExternalTransactionId: 'win-to-rollback',
        },
        { idempotencyKey: 'key-rb-win' },
      );

      expect(rbRes.status).toBe(WagerTransactionStatus.Processed);
      expect(rbRes.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    });

    it('rejects ROLLBACK with NEGATIVE_BALANCE_PREVENTED when rolling back WIN would cause negative balance', async () => {
      // Initial balance is 100.00
      // 1. Player gets WIN of 50.00 -> balance = 150.00
      await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'win-spent',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Win,
          money: { amount: '50.00', currency: 'BRL' },
        },
        { idempotencyKey: 'key-win-spent' },
      );

      // 2. Player bets 140.00 -> balance = 10.00
      await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'bet-spent',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '140.00', currency: 'BRL' },
        },
        { idempotencyKey: 'key-bet-spent' },
      );

      // 3. Provider attempts to rollback the 50.00 WIN, but balance is only 10.00!
      // Must be explicitly rejected with NEGATIVE_BALANCE_PREVENTED
      const rbRes = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'rb-attempt',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Rollback,
          money: { amount: '50.00', currency: 'BRL' },
          referenceExternalTransactionId: 'win-spent',
        },
        { idempotencyKey: 'key-rb-attempt' },
      );

      expect(rbRes.status).toBe(WagerTransactionStatus.Rejected);
      expect(rbRes.failureCode).toBe(FailureCode.NEGATIVE_BALANCE_PREVENTED);
      // Balance remains intact at 10.00
      expect(rbRes.balance).toEqual({ amount: '10.00', currency: 'BRL' });
    });

    it('marks transaction as PENDING_REFERENCE if reference has not arrived yet', async () => {
      const res = await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'rollback-early',
          playerId: 'player-1',
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Rollback,
          money: { amount: '20.00', currency: 'BRL' },
          referenceExternalTransactionId: 'future-bet',
        },
        { idempotencyKey: 'key-rb-early' },
      );

      expect(res.status).toBe(WagerTransactionStatus.PendingReference);
      expect(res.balance).toEqual({ amount: '100.00', currency: 'BRL' });

      // Outbox contains pending reference event
      const pendingOutbox = outboxRepo.messages.find(
        (m) => m.eventType === 'WagerTransactionPendingReference',
      );
      expect(pendingOutbox).toBeDefined();
    });

    it('returns original response with idempotentReplay: true on identical replay', async () => {
      const dto = {
        providerId: 'provider-a',
        externalTransactionId: 'bet-repeat',
        playerId: 'player-1',
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      };

      const first = await processWagerUseCase.execute(dto, {
        idempotencyKey: 'key-repeat',
      });
      expect(first.status).toBe(WagerTransactionStatus.Processed);
      expect(first.idempotentReplay).toBe(false);

      const second = await processWagerUseCase.execute(dto, {
        idempotencyKey: 'key-repeat',
      });
      expect(second.status).toBe(WagerTransactionStatus.Processed);
      expect(second.idempotentReplay).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
    });

    it('throws IdempotencyConflictError when reusing key with different payload', async () => {
      const dto1 = {
        providerId: 'provider-a',
        externalTransactionId: 'tx-conflict',
        playerId: 'player-1',
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      };

      await processWagerUseCase.execute(dto1, { idempotencyKey: 'key-conflict' });

      const dto2 = {
        ...dto1,
        money: { amount: '50.00', currency: 'BRL' }, // different amount!
      };

      expect(
        processWagerUseCase.execute(dto2, { idempotencyKey: 'key-conflict' }),
      ).rejects.toThrow(IdempotencyConflictError);
    });
  });

  describe('Section 8 Mandatory Concurrency Scenario', () => {
    it('executes two 80.00 BRL bets simultaneously on a 100.00 BRL balance', async () => {
      const wallet = await createWalletUseCase.execute({
        playerId: 'player-concurrency',
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });

      const bet1Promise = processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'concurrent-bet-1',
          playerId: 'player-concurrency',
          walletId: wallet.id,
          roundId: 'round-c',
          gameId: 'game-c',
          kind: WagerTransactionKind.Bet,
          money: { amount: '80.00', currency: 'BRL' },
        },
        { idempotencyKey: 'key-c1' },
      );

      const bet2Promise = processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'concurrent-bet-2',
          playerId: 'player-concurrency',
          walletId: wallet.id,
          roundId: 'round-c',
          gameId: 'game-c',
          kind: WagerTransactionKind.Bet,
          money: { amount: '80.00', currency: 'BRL' },
        },
        { idempotencyKey: 'key-c2' },
      );

      const [res1, res2] = await Promise.all([bet1Promise, bet2Promise]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([
        WagerTransactionStatus.Processed,
        WagerTransactionStatus.Rejected,
      ]);

      const rejected = res1.status === WagerTransactionStatus.Rejected ? res1 : res2;
      expect(rejected.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

      // Verify wallet final balance
      const updatedWallet = await walletRepo.findById(wallet.id);
      expect(updatedWallet?.balance.toString()).toBe('20.00');

      // Exactly ONE debit ledger entry added (total entries = 1 opening + 1 bet debit)
      const walletEntries = ledgerRepo.entries.filter((e) => e.walletId === wallet.id);
      expect(walletEntries.length).toBe(2);
      expect(walletEntries[1].direction).toBe(LedgerDirection.Debit);
      expect(walletEntries[1].money.toString()).toBe('80.00');

      // Reconcile verification: wallet.balance === sum(ledger)
      const recon = await reconcileWalletUseCase.execute(wallet.id);
      expect(recon.consistent).toBe(true);
      expect(recon.storedBalance).toEqual({ amount: '20.00', currency: 'BRL' });
      expect(recon.calculatedBalance).toEqual({ amount: '20.00', currency: 'BRL' });
    });
  });

  describe('Reconciliation', () => {
    it('verifies wallet balance matches ledger and detects zero difference', async () => {
      const wallet = await createWalletUseCase.execute({
        playerId: 'player-recon',
        initialBalance: { amount: '500.00', currency: 'BRL' },
      });

      await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'recon-bet',
          playerId: 'player-recon',
          walletId: wallet.id,
          roundId: 'r1',
          gameId: 'g1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '50.00', currency: 'BRL' },
        },
        { idempotencyKey: 'k-recon-bet' },
      );

      await processWagerUseCase.execute(
        {
          providerId: 'provider-a',
          externalTransactionId: 'recon-win',
          playerId: 'player-recon',
          walletId: wallet.id,
          roundId: 'r1',
          gameId: 'g1',
          kind: WagerTransactionKind.Win,
          money: { amount: '200.00', currency: 'BRL' },
        },
        { idempotencyKey: 'k-recon-win' },
      );

      const recon = await reconcileWalletUseCase.execute(wallet.id);
      expect(recon.consistent).toBe(true);
      expect(recon.storedBalance).toEqual({ amount: '650.00', currency: 'BRL' });
      expect(recon.calculatedBalance).toEqual({ amount: '650.00', currency: 'BRL' });
      expect(recon.difference).toEqual({ amount: '0.00', currency: 'BRL' });
      expect(recon.checkedEntries).toBe(3); // 1 opening + 1 bet + 1 win
    });
  });
});

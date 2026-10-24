import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/reconcile-wallet.use-case';
import { WagerTransactionKind } from '../../src/domain/models/wager-transaction';
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryUnitOfWork,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '../mocks/in-memory-uow';

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runLoadTest(): Promise<void> {
  console.log('=====================================================');
  console.log('   JUNGLE GAMING — DISTRIBUTED WAGERING PROCESSOR    ');
  console.log('                  LOAD TEST SUITE                    ');
  console.log('=====================================================\n');

  const walletRepo = new InMemoryWalletRepository();
  const txRepo = new InMemoryWagerTransactionRepository();
  const ledgerRepo = new InMemoryLedgerRepository();
  const inboxRepo = new InMemoryInboxRepository();
  const outboxRepo = new InMemoryOutboxRepository();
  const uow = new InMemoryUnitOfWork();

  const createWalletUseCase = new CreateWalletUseCase(
    walletRepo,
    txRepo,
    ledgerRepo,
    outboxRepo,
    uow,
  );
  const processWagerUseCase = new ProcessWagerTransactionUseCase(
    walletRepo,
    txRepo,
    ledgerRepo,
    inboxRepo,
    outboxRepo,
    uow,
  );
  const reconcileWalletUseCase = new ReconcileWalletUseCase(walletRepo, ledgerRepo);

  const numWallets = 20;
  const requestsPerWallet = 50;
  const totalRequests = numWallets * requestsPerWallet;

  console.log(`Setting up ${numWallets} initial wallets with 10,000.00 BRL each...`);
  const wallets = await Promise.all(
    Array.from({ length: numWallets }, (_, i) =>
      createWalletUseCase.execute({
        playerId: `load-player-${i}`,
        initialBalance: { amount: '10000.00', currency: 'BRL' },
      }),
    ),
  );

  console.log(`Executing ${totalRequests} concurrent wagering transactions...`);

  const latenciesMs: number[] = [];
  let successfulRequests = 0;
  let rejectedRequests = 0;
  let idempotentReplays = 0;
  let errorCount = 0;

  const testStartTime = performance.now();

  const tasks: Promise<void>[] = [];

  for (let w = 0; w < numWallets; w++) {
    const wallet = wallets[w];
    for (let r = 0; r < requestsPerWallet; r++) {
      const isBet = r % 2 === 0;
      const kind = isBet ? WagerTransactionKind.Bet : WagerTransactionKind.Win;
      const amount = '10.00';
      const extId = `load-tx-w${w}-r${r}`;
      const idempotencyKey = `idemp-w${w}-r${r}`;

      const task = async () => {
        const start = performance.now();
        try {
          const res = await processWagerUseCase.execute(
            {
              providerId: 'provider-load-test',
              externalTransactionId: extId,
              playerId: wallet.playerId,
              walletId: wallet.id,
              roundId: `round-${r}`,
              gameId: 'fortune-slots',
              kind,
              money: { amount, currency: 'BRL' },
            },
            { idempotencyKey },
          );

          const duration = performance.now() - start;
          latenciesMs.push(duration);

          if (res.status === 'PROCESSED') {
            successfulRequests++;
          } else if (res.status === 'REJECTED') {
            rejectedRequests++;
          }

          if (res.idempotentReplay) {
            idempotentReplays++;
          }
        } catch {
          errorCount++;
        }
      };

      tasks.push(task());
    }
  }

  await Promise.all(tasks);
  const totalDurationMs = performance.now() - testStartTime;
  const totalDurationSec = totalDurationMs / 1000;
  const throughput = Math.round(totalRequests / totalDurationSec);

  console.log('\n--- Load Test Results ---');
  console.log(`Environment:           Bun ${process.version || '1.x'} (Linux x86_64)`);
  console.log(`Total Requests:        ${totalRequests}`);
  console.log(`Total Duration:        ${totalDurationSec.toFixed(3)}s`);
  console.log(`Throughput:            ${throughput} req/sec`);
  console.log(`Success Rate:          ${((successfulRequests / totalRequests) * 100).toFixed(2)}%`);
  console.log(`Failed / Errored:      ${errorCount}`);
  console.log(`Rejected (Business):   ${rejectedRequests}`);
  console.log(`Idempotent Replays:    ${idempotentReplays}`);
  console.log('\n--- Latency Distribution ---');
  console.log(`Min Latency:           ${percentile(latenciesMs, 0).toFixed(2)} ms`);
  console.log(`p50 (Median):          ${percentile(latenciesMs, 50).toFixed(2)} ms`);
  console.log(`p95:                   ${percentile(latenciesMs, 95).toFixed(2)} ms`);
  console.log(`p99:                   ${percentile(latenciesMs, 99).toFixed(2)} ms`);
  console.log(`Max Latency:           ${percentile(latenciesMs, 100).toFixed(2)} ms`);

  console.log('\n--- Invariant Verification across all Wallets ---');
  let allConsistent = true;
  for (const wallet of wallets) {
    const recon = await reconcileWalletUseCase.execute(wallet.id);
    if (!recon.consistent) {
      allConsistent = false;
      console.error(`Divergence detected in wallet ${wallet.id}!`);
    }
  }

  console.log(`All ${numWallets} wallets balance == sum(ledger): ${allConsistent ? 'VERIFIED PASSED ✅' : 'FAILED ❌'}`);
  console.log('=====================================================\n');
}

runLoadTest().catch(console.error);

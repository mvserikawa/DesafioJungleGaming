import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export class MetricsService {
  private static instance: MetricsService;
  public readonly registry: Registry;

  public readonly wagerTransactionsTotal: Counter<string>;
  public readonly idempotentReplaysTotal: Counter<string>;
  public readonly retriesTotal: Counter<string>;
  public readonly dlqMessagesTotal: Counter<string>;
  public readonly lockConflictsTotal: Counter<string>;
  public readonly outboxLagSeconds: Gauge<string>;
  public readonly processingLatencySeconds: Histogram<string>;
  public readonly reconciliationDivergencesTotal: Counter<string>;

  private constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.wagerTransactionsTotal = new Counter({
      name: 'wager_transactions_total',
      help: 'Total number of wager transactions submitted',
      labelNames: ['status', 'provider', 'kind'],
      registers: [this.registry],
    });

    this.idempotentReplaysTotal = new Counter({
      name: 'idempotent_replays_total',
      help: 'Total number of idempotent replays detected',
      labelNames: ['provider'],
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: 'retries_total',
      help: 'Total number of message or operation retries',
      labelNames: ['component'],
      registers: [this.registry],
    });

    this.dlqMessagesTotal = new Counter({
      name: 'dlq_messages_total',
      help: 'Total number of messages routed to Dead Letter Queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.lockConflictsTotal = new Counter({
      name: 'lock_conflicts_total',
      help: 'Total number of lock conflicts or serialization failures',
      registers: [this.registry],
    });

    this.outboxLagSeconds = new Gauge({
      name: 'outbox_lag_seconds',
      help: 'Age in seconds of the oldest pending outbox message',
      registers: [this.registry],
    });

    this.processingLatencySeconds = new Histogram({
      name: 'processing_latency_seconds',
      help: 'Wagering transaction processing latency in seconds',
      labelNames: ['kind', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.reconciliationDivergencesTotal = new Counter({
      name: 'wallet_reconciliation_divergences_total',
      help: 'Total number of ledger/wallet balance reconciliation divergences detected',
      registers: [this.registry],
    });
  }

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  public async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}

export const metricsService = MetricsService.getInstance();

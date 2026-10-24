import { EventPublisherPort } from '../../../domain/ports/event-publisher.port';
import { OutboxRepositoryPort } from '../../../domain/ports/outbox.repository.port';
import { appLogger } from '../../observability/logger.service';
import { metricsService } from '../../observability/metrics.service';

export interface OutboxWorkerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
}

export class OutboxWorkerService {
  private isRunning = false;
  private timer: Timer | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly publisher: EventPublisherPort,
    private readonly options: OutboxWorkerOptions = {},
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    appLogger.info('OutboxWorkerService started');
    this.scheduleNextTick();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    appLogger.info('OutboxWorkerService stopped');
  }

  public async tick(): Promise<number> {
    const batchSize = this.options.batchSize ?? 25;
    const now = new Date();

    try {
      const messages = await this.outboxRepo.findDueMessagesWithLock(batchSize, now);
      if (messages.length === 0) {
        metricsService.outboxLagSeconds.set(0);
        return 0;
      }

      // Oldest message lag
      const oldestLagSeconds = Math.max(
        0,
        Math.floor((now.getTime() - messages[0].occurredAt.getTime()) / 1000),
      );
      metricsService.outboxLagSeconds.set(oldestLagSeconds);

      for (const msg of messages) {
        try {
          await this.publisher.publish(msg);
          msg.markPublished(new Date());
          await this.outboxRepo.update(msg);
        } catch (err) {
          appLogger.error('Failed to publish outbox event, scheduling retry', err, {
            eventId: msg.id,
            attempts: msg.attempts,
          });
          metricsService.retriesTotal.inc({ component: 'outbox' });
          msg.scheduleRetry(new Date());
          await this.outboxRepo.update(msg);
        }
      }

      return messages.length;
    } catch (err) {
      appLogger.error('Error during outbox worker tick', err);
      return 0;
    }
  }

  private scheduleNextTick(): void {
    if (!this.isRunning) return;
    const interval = this.options.pollIntervalMs ?? 500;
    this.timer = setTimeout(async () => {
      await this.tick();
      this.scheduleNextTick();
    }, interval);
  }
}

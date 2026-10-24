import { EntityManager, RequestContext} from '@mikro-orm/core';
import { ResolvePendingReferencesUseCase } from '../../../application/use-cases/resolve-pending-references.use-case';
import { appLogger } from '../../observability/logger.service';


export interface PendingReferenceWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  maxAgeMs?: number;
}

export class PendingReferenceWorkerService {
  private isRunning = false;
  private timer: Timer | null = null;

  constructor(
  private readonly resolveUseCase: ResolvePendingReferencesUseCase,
  em: EntityManager,
  private readonly options: PendingReferenceWorkerOptions = {},
) {
  this.em = em.fork();
}

  private readonly em: EntityManager;

  // constructor(
  //   private readonly resolveUseCase: ResolvePendingReferencesUseCase,
  //   private readonly em: EntityManager,
  //   private readonly options: PendingReferenceWorkerOptions = {},
  // ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    appLogger.info('PendingReferenceWorkerService started');
    this.scheduleNextTick();
  }

  public stop(): void {
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    appLogger.info('PendingReferenceWorkerService stopped');
  }

  public async tick(): Promise<number> {
    try {
      const resolved = await RequestContext.create(this.em, async () => {
        return this.resolveUseCase.execute({
          batchSize: this.options.batchSize ?? 50,
          maxAgeMs: this.options.maxAgeMs ?? 300000,
        });
      });

      if (resolved > 0) {
        appLogger.info('Pending references resolved', {
          resolvedCount: resolved,
        });
      }

      return resolved;
    } catch (err) {
      appLogger.error('Error during pending reference worker tick', err);
      return 0;
    }
  }

  private scheduleNextTick(): void {
    if (!this.isRunning) return;

    const interval = this.options.intervalMs ?? 5000;

    this.timer = setTimeout(async () => {
      await this.tick();
      this.scheduleNextTick();
    }, interval);
  }
}
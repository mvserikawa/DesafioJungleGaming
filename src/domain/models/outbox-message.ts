import { IntegrationEvent } from '../events/integration-event';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  public static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const payload = event.toJSON() as unknown as Record<string, unknown>;
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      Object.freeze(payload),
      event.occurredAt,
      0,
      new Date(), // immediately due
      undefined,
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    if (!this.isPending()) return false;
    if (!this._nextAttemptAt) return true;
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  /**
   * Increments attempts and calculates nextAttemptAt using exponential backoff with jitter
   */
  public scheduleRetry(now: Date = new Date(), maxBackoffSeconds: number = 300): void {
    this._attempts += 1;
    // Exponential backoff: base 2^attempts * 1000ms, capped
    const baseDelayMs = Math.min(Math.pow(2, this._attempts) * 1000, maxBackoffSeconds * 1000);
    // Add jitter +/- 20%
    const jitter = (Math.random() * 0.4 - 0.2) * baseDelayMs;
    const finalDelayMs = Math.max(1000, Math.floor(baseDelayMs + jitter));

    this._nextAttemptAt = new Date(now.getTime() + finalDelayMs);
  }
}

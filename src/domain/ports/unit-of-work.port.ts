export const UNIT_OF_WORK_PORT = Symbol('UNIT_OF_WORK_PORT');

export interface TransactionalContext {
  [key: string]: unknown;
}

export interface UnitOfWorkPort {
  runInTransaction<T>(work: (ctx?: TransactionalContext) => Promise<T>): Promise<T>;
  flush(): Promise<void>;
}

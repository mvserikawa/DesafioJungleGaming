import { EntityManager } from '@mikro-orm/core';
import { UnitOfWorkPort } from '../../domain/ports/unit-of-work.port';

export class MikroOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly em: EntityManager) {}

  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.em.transactional(async () => {
      return work();
    });
  }

  public async flush(): Promise<void> {
  await this.em.flush();
}
}

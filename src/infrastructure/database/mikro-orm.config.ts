import { Options } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { WalletLedgerEntryEntity } from './entities/ledger-entry.entity';
import { OutboxMessageEntity } from './entities/outbox-message.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WalletEntity } from './entities/wallet.entity';

const config: Options = {
  driver: PostgreSqlDriver,
  clientUrl:
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/wagering_db',
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  debug: true,//process.env.NODE_ENV === 'development',
  migrations: {
    path: './src/infrastructure/database/migrations',
    transactional: true,
  },
};

export default config;

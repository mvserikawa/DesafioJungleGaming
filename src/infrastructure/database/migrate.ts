import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

export async function runMigrations(direction: 'up' | 'down' = 'up'): Promise<void> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/wagering_db',
  });

  await client.connect();

  try {
    const filename =
      direction === 'up'
        ? '001_initial_schema.sql'
        : '001_initial_schema_down.sql';
    const filepath = join(__dirname, 'migrations', filename);
    const sql = readFileSync(filepath, 'utf8');

    console.log(`Running migration ${direction}: ${filename}...`);
    await client.query(sql);
    console.log(`Migration ${direction} completed successfully.`);
  } finally {
    await client.end();
  }
}

if (require.main === module || process.argv[1]?.includes('migrate')) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  runMigrations(direction)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Database = pg.Pool;

const schemaPath = fileURLToPath(new URL('../../../infra/local/schema.sql', import.meta.url));

export function createDatabase(connectionString: string): Database {
  if (!/^postgres(ql)?:\/\//.test(connectionString)) throw new Error('DATABASE_URL must be a postgres connection string');
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000 });
}

// The schema is idempotent, so applying it on every startup is safe and keeps M2 free of a migration tool.
export async function migrate(database: Database): Promise<void> {
  await database.query(readFileSync(schemaPath, 'utf8'));
}

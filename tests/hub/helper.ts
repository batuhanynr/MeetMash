import { createDatabase, migrate, type Database } from '../../apps/hub/src/db.ts';

// M2 hub tests require a real Postgres. DATABASE_URL must point at a disposable development database.
export async function freshDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for hub tests (see infra/local/docker-compose.yml)');
  const database = createDatabase(url);
  await migrate(database);
  await database.query('TRUNCATE agent_identities, agent_profiles, agent_capabilities, friendships, sessions, mailbox RESTART IDENTITY CASCADE');
  return database;
}

import type { Database } from './db.ts';
import type { RegistrarStore, SessionState, StoredSession } from './registrar.ts';

type SessionRow = { user_id: string; generation: number; token_hash: string; state: SessionState; last_seen: string; endpoint: string | null };

export class PgRegistrarStore implements RegistrarStore {
  private readonly database: Database;

  constructor(database: Database) { this.database = database; }

  async getIdentity(agentId: string): Promise<{ userId: string; secretHash: string } | undefined> {
    const result = await this.database.query<{ user_id: string; bootstrap_secret_hash: string }>(
      'SELECT user_id, bootstrap_secret_hash FROM agent_identities WHERE agent_id = $1', [agentId]);
    const row = result.rows[0];
    return row ? { userId: row.user_id, secretHash: row.bootstrap_secret_hash } : undefined;
  }

  async rotateSession(input: { agentId: string; userId: string; tokenHash: string; endpoint: string | null; now: number }): Promise<number> {
    const result = await this.database.query<{ generation: number }>(
      `INSERT INTO sessions (agent_id, user_id, generation, token_hash, state, endpoint, last_seen, created_at)
       VALUES ($1, $2, 1, $3, 'online', $4, to_timestamp($5 / 1000.0), now())
       ON CONFLICT (agent_id) DO UPDATE SET
         generation = sessions.generation + 1, user_id = EXCLUDED.user_id, token_hash = EXCLUDED.token_hash,
         state = 'online', endpoint = EXCLUDED.endpoint, last_seen = EXCLUDED.last_seen
       RETURNING generation`,
      [input.agentId, input.userId, input.tokenHash, input.endpoint, input.now]);
    return result.rows[0]!.generation;
  }

  async getSession(agentId: string): Promise<StoredSession | undefined> {
    const result = await this.database.query<SessionRow>(
      `SELECT user_id, generation, token_hash, state, endpoint,
              (extract(epoch FROM last_seen) * 1000)::bigint AS last_seen
       FROM sessions WHERE agent_id = $1`, [agentId]);
    const row = result.rows[0];
    return row ? { userId: row.user_id, generation: row.generation, tokenHash: row.token_hash, state: row.state, lastSeen: Number(row.last_seen), endpoint: row.endpoint } : undefined;
  }

  async touchSession(agentId: string, generation: number, now: number): Promise<boolean> {
    const result = await this.database.query(
      'UPDATE sessions SET last_seen = to_timestamp($3 / 1000.0) WHERE agent_id = $1 AND generation = $2', [agentId, generation, now]);
    return result.rowCount === 1;
  }

  async setSessionState(agentId: string, generation: number, state: SessionState, _now: number): Promise<boolean> {
    const result = await this.database.query(
      'UPDATE sessions SET state = $3 WHERE agent_id = $1 AND generation = $2', [agentId, generation, state]);
    return result.rowCount === 1;
  }
}

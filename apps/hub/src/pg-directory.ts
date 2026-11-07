import type { Database } from './db.ts';
import { normalize, type DirectoryStore, type Profile, type Visibility } from './directory.ts';

type ProfileRow = { agent_id: string; display_name: string; visibility: Visibility; capabilities: string[] | null };

const toProfile = (row: ProfileRow): Profile => ({
  agentId: row.agent_id, displayName: row.display_name, visibility: row.visibility,
  capabilities: (row.capabilities ?? []).filter((capability): capability is string => capability !== null).sort(),
});

const SELECT = `
  SELECT p.agent_id, p.display_name, p.visibility,
         array_remove(array_agg(c.capability), NULL) AS capabilities
  FROM agent_profiles p
  LEFT JOIN agent_capabilities c ON c.agent_id = p.agent_id`;

export class PgDirectoryStore implements DirectoryStore {
  private readonly database: Database;

  constructor(database: Database) { this.database = database; }

  async upsertProfile(profile: Profile): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO agent_profiles (agent_id, display_name, visibility, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (agent_id) DO UPDATE SET display_name = EXCLUDED.display_name, visibility = EXCLUDED.visibility, updated_at = now()`,
        [profile.agentId, profile.displayName, profile.visibility]);
      await client.query('DELETE FROM agent_capabilities WHERE agent_id = $1', [profile.agentId]);
      for (const capability of new Set(profile.capabilities.map(normalize))) {
        if (capability) await client.query('INSERT INTO agent_capabilities (agent_id, capability) VALUES ($1, $2)', [profile.agentId, capability]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setVisibility(agentId: string, visibility: Visibility): Promise<void> {
    await this.database.query('UPDATE agent_profiles SET visibility = $2, updated_at = now() WHERE agent_id = $1', [agentId, visibility]);
  }

  async addFriend(ownerAgentId: string, friendAgentId: string): Promise<void> {
    await this.database.query('INSERT INTO friendships (agent_id, friend_agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ownerAgentId, friendAgentId]);
  }

  async getProfile(agentId: string): Promise<Profile | undefined> {
    const result = await this.database.query<ProfileRow>(`${SELECT} WHERE p.agent_id = $1 GROUP BY p.agent_id`, [agentId]);
    return result.rows[0] ? toProfile(result.rows[0]) : undefined;
  }

  async findByName(normalizedName: string): Promise<Profile[]> {
    const result = await this.database.query<ProfileRow>(`${SELECT} WHERE lower(p.display_name) = $1 GROUP BY p.agent_id`, [normalizedName]);
    return result.rows.map(toProfile);
  }

  async findByCapability(normalizedCapability: string): Promise<Profile[]> {
    const result = await this.database.query<ProfileRow>(
      `${SELECT} WHERE p.agent_id IN (SELECT agent_id FROM agent_capabilities WHERE capability = $1) GROUP BY p.agent_id`,
      [normalizedCapability]);
    return result.rows.map(toProfile);
  }

  async isFriend(ownerAgentId: string, candidateAgentId: string): Promise<boolean> {
    const result = await this.database.query('SELECT 1 FROM friendships WHERE agent_id = $1 AND friend_agent_id = $2', [ownerAgentId, candidateAgentId]);
    return result.rowCount === 1;
  }
}

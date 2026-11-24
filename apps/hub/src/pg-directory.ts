import type { Database } from './db.ts';
import { type DirectoryStore, type Profile, type Visibility } from './directory.ts';

type ProfileRow = { agent_id: string; display_name: string; visibility: Visibility };

const toProfile = (row: ProfileRow): Profile => ({
  agentId: row.agent_id, displayName: row.display_name, visibility: row.visibility,
});

const SELECT = `
  SELECT p.agent_id, p.display_name, p.visibility
  FROM agent_profiles p`;

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

  async visibleProfiles(requester: string): Promise<Profile[]> {
    const result = await this.database.query<ProfileRow>(
      `${SELECT} WHERE p.agent_id = $1 OR p.visibility = 'public'
        OR (p.visibility = 'friends' AND EXISTS (
          SELECT 1 FROM friendships f WHERE f.agent_id = p.agent_id AND f.friend_agent_id = $1
        )) GROUP BY p.agent_id ORDER BY p.agent_id`, [requester]);
    return result.rows.map(toProfile);
  }

  async findByName(normalizedName: string): Promise<Profile[]> {
    const result = await this.database.query<ProfileRow>(`${SELECT} WHERE lower(p.display_name) = $1 GROUP BY p.agent_id`, [normalizedName]);
    return result.rows.map(toProfile);
  }

  async isFriend(ownerAgentId: string, candidateAgentId: string): Promise<boolean> {
    const result = await this.database.query('SELECT 1 FROM friendships WHERE agent_id = $1 AND friend_agent_id = $2', [ownerAgentId, candidateAgentId]);
    return result.rowCount === 1;
  }
}

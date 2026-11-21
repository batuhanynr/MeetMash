import type { Database } from './db.ts';
import type { Directory, Visibility } from './directory.ts';

// The socket supplies the actor. Clients can request access, but only the recipient can approve it.
export class MobileDirectoryControl {
  readonly db: Database;
  readonly directory: Directory;
  constructor(db: Database, directory: Directory) { this.db = db; this.directory = directory; }

  async handle(actor: string, frame: { kind: string; [key: string]: unknown }): Promise<Record<string, unknown> | undefined> {
    const response = (value: Record<string, unknown>) => ({ kind: frame.kind + '.result', requestId: frame.requestId, ...value });
    switch (frame.kind) {
      case 'profile.get': return response({ profile: await this.directory.lookup(actor, actor) });
      case 'profile.save': {
        const { displayName, visibility, capabilities } = frame;
        if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 100 ||
            !['private', 'friends', 'public'].includes(String(visibility)) || !Array.isArray(capabilities) ||
            capabilities.length > 32 || !capabilities.every(c => typeof c === 'string' && c.length <= 80)) return response({ error: 'INVALID_PROFILE' });
        await this.directory.putProfile({ agentId: actor, displayName: displayName.trim(), visibility: visibility as Visibility, capabilities });
        return response({ saved: true });
      }
      case 'friends.list': {
        const friends = await this.db.query('SELECT friend_agent_id AS id FROM friendships WHERE agent_id=$1 ORDER BY 1', [actor]);
        const incoming = await this.db.query('SELECT sender AS id FROM friend_requests WHERE recipient=$1 ORDER BY 1', [actor]);
        return response({ friends: friends.rows.map(r => r.id), incoming: incoming.rows.map(r => r.id) });
      }
      case 'friends.request': {
        if (typeof frame.target !== 'string' || actor === frame.target || !await this.directory.lookup(actor, frame.target)) return response({ error: 'UNAVAILABLE' });
        await this.db.query('INSERT INTO friend_requests (sender,recipient) SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM friendships WHERE agent_id=$1 AND friend_agent_id=$2) ON CONFLICT DO NOTHING', [actor, frame.target]);
        return response({ requested: true });
      }
      case 'friends.accept': {
        if (typeof frame.target !== 'string') return response({ error: 'INVALID_REQUEST' });
        const result = await this.db.query(`
          WITH approved AS (
            DELETE FROM friend_requests WHERE recipient=$1 AND sender=$2 RETURNING recipient,sender
          ), pairs AS (
            SELECT recipient,sender FROM approved UNION ALL SELECT sender,recipient FROM approved
          ), added AS (
            INSERT INTO friendships SELECT * FROM pairs ON CONFLICT DO NOTHING
          ) SELECT 1 FROM approved`, [actor, frame.target]);
        this.directory.invalidate();
        return response(result.rowCount ? { accepted: true } : { error: 'NO_REQUEST' });
      }
      default: return undefined;
    }
  }
}

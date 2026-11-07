import type { Database } from './db.ts';
import { hashSecret } from './secrets.ts';

// Provisioning happens out of band; the bootstrap secret is supplied by the operator, not generated in the repo.
export async function provisionIdentity(database: Database, identity: { agentId: string; userId: string; secret: string }): Promise<void> {
  await database.query(
    `INSERT INTO agent_identities (agent_id, user_id, bootstrap_secret_hash) VALUES ($1, $2, $3)
     ON CONFLICT (agent_id) DO UPDATE SET user_id = EXCLUDED.user_id, bootstrap_secret_hash = EXCLUDED.bootstrap_secret_hash`,
    [identity.agentId, identity.userId, hashSecret(identity.secret)],
  );
}

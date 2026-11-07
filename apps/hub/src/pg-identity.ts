import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from './db.ts';

// Bootstrap secrets are stored as scrypt hashes, never in clear text. Format: salt:derived (both hex).
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(secret, salt, 32).toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [saltHex, expectedHex] = stored.split(':');
  if (!saltHex || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Provisioning happens out of band; the bootstrap secret is supplied by the operator, not generated in the repo.
export async function provisionIdentity(database: Database, identity: { agentId: string; userId: string; secret: string }): Promise<void> {
  await database.query(
    `INSERT INTO agent_identities (agent_id, user_id, bootstrap_secret_hash) VALUES ($1, $2, $3)
     ON CONFLICT (agent_id) DO UPDATE SET user_id = EXCLUDED.user_id, bootstrap_secret_hash = EXCLUDED.bootstrap_secret_hash`,
    [identity.agentId, identity.userId, hashSecret(identity.secret)],
  );
}

export async function getIdentitySecretHash(database: Database, agentId: string): Promise<string | undefined> {
  const result = await database.query<{ bootstrap_secret_hash: string }>(
    'SELECT bootstrap_secret_hash FROM agent_identities WHERE agent_id = $1', [agentId]);
  return result.rows[0]?.bootstrap_secret_hash;
}

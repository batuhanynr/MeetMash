// Start a persistent demo hub for two Flutter clients. Each device gets only its own credentials.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDatabase, migrate } from '../apps/hub/src/db.ts';
import { startM2Hub } from '../apps/hub/src/m2-server.ts';
import { hashSecret, verifySecret } from '../apps/hub/src/secrets.ts';
import { loadSecrets, pairId } from '../apps/agent-node/src/m2-security.ts';
import { jsonLogger } from '../packages/runtime/src/log.ts';

const url = process.env.M5_DEVICE_DATABASE_URL;
if (!url) throw new Error('Set M5_DEVICE_DATABASE_URL to a dedicated demo database');
const certs = resolve(process.env.CERT_DIR ?? '.state/certs');
const secrets = loadSecrets(resolve(process.env.SECRETS_FILE ?? '.state/secrets.json'));
const directory = resolve('.state/m5-devices');
const attendees = [
  { id: 'agent-a', name: 'Ada', email: process.env.M5_GOOGLE_A },
  { id: 'agent-b', name: 'Ece', email: process.env.M5_GOOGLE_B },
];
const google = attendees.some((a) => a.email);
if (
  google &&
  (attendees.some((a) => !a.email) || attendees[0]!.email!.toLowerCase() === attendees[1]!.email!.toLowerCase())
) {
  throw new Error('Specify two distinct Google test accounts to use live calendars.');
}
const host = process.env.MEETMESH_DATA_HOST ?? '127.0.0.1';
const port = Number(process.env.HUB_PORT ?? 8787);
const database = createDatabase(url);
try {
  await migrate(database);
  const caPem = readFileSync(join(certs, 'ca.crt'), 'utf8');
  const key = pairId('agent-a', 'agent-b');
  if (!secrets.pairKeys[key]) throw new Error('Missing A/B pair key');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const { id, name, email } of attendees) {
    const secret = secrets.bootstrap[id];
    if (!secret) throw new Error('Missing bootstrap credential for ' + id);
    await database.query(
      'INSERT INTO agent_identities(agent_id,user_id,bootstrap_secret_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, 'demo-' + id, hashSecret(secret)],
    );
    const { rows } = await database.query(
      'SELECT user_id,bootstrap_secret_hash FROM agent_identities WHERE agent_id=$1',
      [id],
    );
    if (rows[0]?.user_id !== 'demo-' + id || !verifySecret(secret, rows[0].bootstrap_secret_hash))
      throw new Error('Use a dedicated device database with matching demo identities');
    await database.query(
      "INSERT INTO agent_profiles(agent_id,display_name,visibility) VALUES($1,$2,'public') ON CONFLICT DO NOTHING",
      [id, name],
    );
    const file = join(directory, id + '.json');
    writeFileSync(
      file,
      JSON.stringify({
        agentId: id,
        hub: 'wss://' + host + ':' + port,
        caPem,
        secret,
        pairKeys: { [key]: secrets.pairKeys[key] },
        calendar: google ? 'google' : 'fixture',
        ...(email ? { googleEmail: email } : {}),
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    chmodSync(file, 0o600);
  }
  const hub = await startM2Hub(
    database,
    { host, port, tls: { cert: readFileSync(join(certs, 'hub.crt')), key: readFileSync(join(certs, 'hub.key')) } },
    jsonLogger(randomUUID(), 'hub'),
  );
  console.log(
    'WSS hub listening on ' +
      host +
      ':' +
      hub.port +
      '. Device configs in ' +
      directory +
      '. Provider: ' +
      (google ? 'Google Calendar' : 'synthetic fixture'),
  );
  const closed = () => {
    void hub.close().finally(() => database.end());
  };
  process.once('SIGTERM', closed);
  process.once('SIGINT', closed);
} catch (error) {
  await database.end();
  throw error;
}

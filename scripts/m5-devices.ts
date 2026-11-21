// Start a persistent demo hub for two devices or a phone and two Mac agents.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDatabase, migrate } from '../apps/hub/src/db.ts';
import { startM2Hub } from '../apps/hub/src/m2-server.ts';
import { hashSecret, verifySecret } from '../apps/hub/src/secrets.ts';
import { loadSecrets, pairId } from '../apps/agent-node/src/m2-security.ts';
import { jsonLogger } from '../packages/runtime/src/log.ts';
import { phoneAgents, phonePanel } from './lib/phone-panel.ts';

const singlePhone = process.argv.includes('--single-phone');
const databaseVariable = singlePhone ? 'M5_PHONE_DATABASE_URL' : 'M5_DEVICE_DATABASE_URL';
const url = process.env[databaseVariable];
if (!url) throw new Error(`Set ${databaseVariable} to a dedicated demo database`);
if (singlePhone && new URL(url).pathname !== '/meetmesh_phone_lab') {
  throw new Error('Use a dedicated PostgreSQL database named meetmesh_phone_lab');
}
const certs = resolve(process.env.CERT_DIR ?? '.state/certs');
const secretsFile = resolve(process.env.SECRETS_FILE ?? '.state/secrets.json');
const secrets = loadSecrets(secretsFile);
const directory = resolve(singlePhone ? '.state/m5-phone' : '.state/m5-devices');
const attendees = singlePhone ? phoneAgents.map(({ id, name }) => ({ id, name, email: undefined })) : [
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
const port = singlePhone ? 8789 : Number(process.env.HUB_PORT ?? 8787);
const hubUrl = new URL(`wss://${host}:${port}`).origin;
const panel = singlePhone ? phonePanel({ directory, certs, secrets: secretsFile }) : undefined;
const database = createDatabase(url);
let hub: Awaited<ReturnType<typeof startM2Hub>> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await panel?.close(); }
  finally {
    try { await hub?.close(); }
    finally { await database.end(); }
  }
}
try {
  await migrate(database);
  const caPem = readFileSync(join(certs, 'ca.crt'), 'utf8');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const { id, name, email } of attendees) {
    const secret = secrets.bootstrap[id];
    if (!secret) throw new Error('Missing bootstrap credential for ' + id);
    const pairKeys = Object.fromEntries(attendees.filter(other => id !== other.id).map(other => {
      const key = pairId(id, other.id);
      if (!secrets.pairKeys[key]) throw new Error('Missing pair key: ' + key);
      return [key, secrets.pairKeys[key]];
    }));
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
    if (singlePhone && id !== 'agent-a') continue;
    const file = join(directory, singlePhone ? 'meetmesh-phone-account.json' : id + '.json');
    writeFileSync(
      file,
      JSON.stringify({
        agentId: id,
        hub: hubUrl,
        caPem,
        secret,
        pairKeys,
        calendar: google ? 'google' : 'fixture',
        ...(email ? { googleEmail: email } : {}),
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    chmodSync(file, 0o600);
  }
  const logger = jsonLogger(randomUUID(), 'hub');
  hub = await startM2Hub(
    database,
    { host, port, tls: { cert: readFileSync(join(certs, 'hub.crt')), key: readFileSync(join(certs, 'hub.key')) }, traceDelivery: singlePhone },
    (event, fields) => {
      logger(event, fields);
      if (fields) panel?.observe(event, fields);
    },
  );
  await panel?.start(hubUrl);
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
  const closed = () => { void close(); };
  process.once('SIGTERM', closed);
  process.once('SIGINT', closed);
} catch (error) {
  await close();
  throw error;
}

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabase, migrate } from '../../apps/hub/src/db.ts';
import { startM2Hub } from '../../apps/hub/src/m2-server.ts';
import { PgDirectoryStore } from '../../apps/hub/src/pg-directory.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import { M2Transport, type ControlFrame } from '../../apps/agent-node/src/m2-transport.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL for the disposable smoke schema');
const admin = createDatabase(url);
const schema = 'model_smoke_' + randomBytes(12).toString('hex');
const scoped = new URL(url);
scoped.searchParams.set('options', '-c search_path=' + schema);
const database = createDatabase(scoped.toString());
let hub: Awaited<ReturnType<typeof startM2Hub>> | undefined;
let socket: M2Transport | undefined;
let created = false;
try {
  await admin.query('CREATE SCHEMA ' + schema);
  created = true;
  await migrate(database);
  const store = new PgDirectoryStore(database);
  const secret = randomBytes(24).toString('hex');
  for (const [id, name, visibility] of [
    ['host','Ev Sahibi','public'], ['target','Ada','public'], ['hidden','Bora','private'],
    ['deniz','Deniz','public'], ['ali','Ali','public'], ['ayse','Ayşe','public'],
  ] as const) {
    await provisionIdentity(database, { agentId: id, userId: id, secret });
    await store.upsertProfile({ agentId: id, displayName: name, visibility });
  }
  const certificates = process.env.CERT_DIR ?? '.state/certs';
  hub = await startM2Hub(database, { host:'127.0.0.1',port:0,tls: {
    cert: readFileSync(join(certificates,'hub.crt')), key: readFileSync(join(certificates,'hub.key')),
  } }, () => {});
  socket = new M2Transport(new URL(`wss://127.0.0.1:${hub.port}`), 'host', secret, readFileSync(join(certificates,'ca.crt')), () => {});
  const handlers = new Map<string,(f: ControlFrame) => void>();
  await socket.connect(() => {}, frame => { handlers.get(String(frame.requestId))?.(frame); }, () => {});
  async function request(input: Record<string, unknown> & {kind: string}): Promise<ControlFrame> {
    const requestId = randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<ControlFrame>((resolve,reject) => {
        handlers.set(requestId,resolve); timer = setTimeout(() => reject(new Error('Timed out')),65_000);
        socket!.sendControl({ ...input,requestId });
      });
    } finally { clearTimeout(timer); handlers.delete(requestId); }
  }
  const preview = await request({kind:'meeting.preview',timeZone:'Europe/Istanbul',text:'Yarın 14:00 ile 16:00 arasında Ada ile 30 dakika görüşelim.'});
  assert.equal(preview.status,'ready');
  assert.deepEqual(preview.participantAgentIds,['host','target']);
  assert.equal(preview.durationMinutes,30);
  const suffix = await request({kind:'meeting.preview',timeZone:'Europe/Istanbul',text:'yarın denizle yarım saat görüşmem gerek'});
  assert.equal(suffix.status,'ready');
  assert.deepEqual(suffix.participantAgentIds,['host','deniz']);
  assert.equal(suffix.durationMinutes,30);
  assert.ok(suffix.window);
  const swimming = await request({kind:'meeting.preview',timeZone:'Europe/Istanbul',text:'ali ve ayse ile yarın denize yüzmeye gideceğiz'});
  assert.deepEqual((swimming.participantAgentIds as string[]).toSorted(),['ali','ayse','host']);
  assert.equal(swimming.status,'clarify');
  assert.equal(swimming.durationMinutes,null);
  assert.deepEqual(swimming.questions,['Toplantı süresini gir.']);
  assert.ok(swimming.window);
  const mailboxRows = Number((await database.query('SELECT count(*) AS n FROM mailbox')).rows[0].n);
  assert.equal(mailboxRows,0);
  const evidenceDir = process.env.M5_AI_EVIDENCE_DIR ?? '.state/evidence/m5-ai';
  mkdirSync(evidenceDir,{recursive:true});
  writeFileSync(join(evidenceDir,'wss-smoke.json'), JSON.stringify({ timestamp:new Date().toISOString(),preview,suffix,swimming,mailboxRows },null,2) + '\n');
  console.log('Passed WSS preview with real models. Database mailbox rows after preview: 0');
} finally {
  socket?.close();
  await hub?.close();
  await database.end();
  if (created) await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
  await admin.end();
}

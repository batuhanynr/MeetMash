import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { M2Cluster } from './lib/m2-cluster.ts';
import { waitFor } from './lib/processes.ts';
import fixture from '../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };
import { loadSecrets } from '../apps/agent-node/src/m2-security.ts';

const usePreview = process.argv.includes('--preview');
const executable = process.env.MOBILE_AGENT_EXE;
if (executable && !existsSync(executable)) throw new Error('MOBILE_AGENT_EXE does not exist');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Use a disposable DATABASE_URL ending in _test; fixtures reset this database');
const root = mkdtempSync(join(tmpdir(), 'meetmesh-mobile-'));
const certDir = resolve(process.env.CERT_DIR ?? '.state/certs'),
  secretsFile = resolve(process.env.SECRETS_FILE ?? '.state/secrets.json');
const ids = ['agent-a', 'agent-b', 'agent-c'],
  runId = randomUUID();
const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', dateStyle: 'short' }).format(
  new Date(Date.now() + 86400_000),
);
const fixturePath = join(root, 'calendar.json');
const synthetic = usePreview ? JSON.parse(JSON.stringify(fixture).replaceAll('2026-11-10', tomorrow)) : fixture;
writeFileSync(fixturePath, JSON.stringify(synthetic));
const agentArgs = Object.fromEntries(
  ids.map((id) => {
    const path = join(root, id + '-profile.json');
    writeFileSync(path, JSON.stringify(synthetic.agents[id]));
    return [id, ['--calendar-file', path]];
  }),
);
const cluster = new M2Cluster({
  runId,
  stateRoot: root,
  databaseUrl,
  certDir,
  secretsFile,
  agentIds: ids,
  agentArgs,
});
type View = { status: string; title: string; eventCount: number; selected: { start: string; end: string; score?: number } };
const finalTitle = 'Tasarım değerlendirmesi - son hâl';
const secrets = loadSecrets(secretsFile);
async function startMobile() {
  const account = join(root, 'account.json'),
    dartId = 'agent-c';
  writeFileSync(
    account,
    JSON.stringify({
      agentId: dartId,
      secret: secrets.bootstrap[dartId],
      pairKeys: Object.fromEntries(
        Object.entries(secrets.pairKeys).filter(([key]) => key.split(':').includes(dartId)),
      ),
      hub: 'wss://127.0.0.1:' + cluster.port,
      caPem: readFileSync(join(certDir, 'ca.crt'), 'utf8'),
    }),
    { mode: 0o600 },
  );
  const args = [
    account,
    join(root, 'state.json'),
    resolve('packages/protocol/schemas/message.schema.json'),
    fixturePath,
  ];
  const proc = spawn(executable ?? 'dart', executable ? args : ['--packages=.dart_tool/package_config.json', 'bin/agent.dart', ...args], {
    cwd: resolve('apps/mobile'),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let ready = false;
  let failure: Error | undefined;
  proc.on('error', (error) => {
    failure = error;
  });
  const responses = new Map<string, (v: Record<string, unknown>) => void>();
  createInterface({ input: proc.stdout }).on('line', (line) => {
    if (!line.startsWith('{')) return;
    const msg = JSON.parse(line);
    if (msg.kind === 'ready') ready = true;
    if (msg.requestId) responses.get(msg.requestId)?.(msg);
  });
  try {
    await waitFor(
      () => {
        if (failure) throw failure;
        if (proc.exitCode !== null) throw Error('Dart exited ' + proc.exitCode);
        return ready;
      },
      (v) => v,
      'Dart handshake',
      30000,
    );
  } catch (e) {
    proc.kill();
    throw e;
  }
  return {
    async command(command: Record<string, unknown>) {
      const requestId = randomUUID();
      return await new Promise<Record<string, unknown>>((ok, fail) => {
        const timer = setTimeout(() => {
          responses.delete(requestId);
          fail(Error('Dart reply timeout'));
        }, 65000);
        responses.set(requestId, (v) => {
          clearTimeout(timer);
          responses.delete(requestId);
          v.error ? fail(Error(String(v.error))) : ok(v);
        });
        proc.stdin.write(JSON.stringify({ ...command, requestId }) + '\n');
      });
    },
    async view(meetingId: string): Promise<View | null> {
      return (await this.command({ command: 'meeting', meetingId })).meeting as View | null;
    },
    async close() {
      if (proc.exitCode === null && proc.signalCode === null) {
        const exited = new Promise<void>((ok) => proc.once('exit', () => ok()));
        proc.stdin.end();
        await exited;
      }
    },
  };
}
let mobile: Awaited<ReturnType<typeof startMobile>> | undefined;
try {
  await cluster.start();
  await cluster.stopAgent('agent-c');
  mobile = await startMobile();
  const meetingId = randomUUID(),
    coordinator = cluster.agent('agent-a');
  let approval: object | undefined;
  if (usePreview) {
    const text = 'Yarın 10:00 ile 16:00 arasında Alpha ve Bravo ile 60 dakika görüşelim. Konu: Tasarım değerlendirmesi.';
    const preview = (await mobile.command({ command: 'preview', text })).preview as {
      status: string;
      title: string;
      participantAgentIds: string[];
      durationMinutes: number;
      window: { start: string; end: string };
    };
    assert.equal(preview.status, 'ready', 'Model could not prepare a meeting preview');
    assert.ok(preview.title && 'tasarım değerlendirmesi'.includes(preview.title.toLocaleLowerCase('tr')));
    assert.deepEqual([...preview.participantAgentIds].sort(), ids);
    assert.equal(preview.durationMinutes, 60);
    assert.equal(Date.parse(preview.window.start), Date.parse(synthetic.window.start));
    assert.equal(Date.parse(preview.window.end), Date.parse(synthetic.window.end));
    assert.equal(await mobile.view(meetingId), null);
    approval = { input: text, preview, approval: 'automated fixture confirmation' };
    await mobile.command({
      command: 'schedule',
      meetingId,
      participantAgentIds: preview.participantAgentIds,
      window: preview.window,
      durationMinutes: preview.durationMinutes,
      title: finalTitle,
    });
  } else
    await coordinator.command({
      command: 'schedule',
      meetingId,
      participantAgentIds: ids,
      window: fixture.window,
      durationMinutes: fixture.durationMinutes,
      title: finalTitle,
    });
  const readNode = async (id: string) =>
    (await cluster.agent(id).command({ command: 'meeting', meetingId })).meeting as View;
  const owner = await waitFor(
    () => (usePreview ? mobile!.view(meetingId) : readNode('agent-a')),
    (m) => m?.status === 'CONFIRMED',
    'three calendar receipts',
    30000,
  );
  assert.ok(owner);
  const a = await readNode('agent-a'),
    b = await readNode('agent-b'),
    c = await mobile.view(meetingId);
  assert(c);
  for (const m of [a, b, c]) {
    assert.equal(m.title, finalTitle);
    assert.equal(m.eventCount, 1);
    assert.equal(
      Date.parse(m.selected.start),
      Date.parse((usePreview ? tomorrow : '2026-11-10') + 'T14:00:00+03:00'),
    );
  }
  for (const id of ['agent-a', 'agent-b']) {
    const db = new DatabaseSync(join(root, id, 'meetings.sqlite'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT title FROM calendar_events WHERE meeting=?').get(meetingId)?.title, finalTitle);
    } finally { db.close(); }
  }
  assert.equal(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).events[meetingId].title, finalTitle);
  const ranked = owner as View & { ranked?: Array<{ score: number }> };
  const score = owner.selected.score ?? ranked.ranked?.[0]?.score;
  assert.equal(score, 220);
  await mobile.close();
  mobile = await startMobile();
  const recovered = await mobile.view(meetingId);
  assert.equal(recovered?.eventCount, 1);
  assert.equal(recovered?.status, c.status);
  assert.equal(recovered?.title, finalTitle);
  const report = {
    runId,
    meetingId,
    title: finalTitle,
    transport: 'WSS',
    coordinator: usePreview ? 'Dart' : 'Node',
    participants: ['Node', 'Node', 'Dart foreground core'],
    provider: 'synthetic',
    selected: { ...owner.selected, score },
    approval,
    localEventCounts: [a.eventCount, b.eventCount, c.eventCount],
    dartAfterReopen: recovered?.eventCount,
    status: 'passed',
  };
  const evidence = resolve(process.env.M5_EVIDENCE_DIR ?? '.state/evidence/m5');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    join(evidence, usePreview ? 'preview-meeting.json' : 'mixed.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} finally {
  await mobile?.close();
  await cluster.close();
  rmSync(root, { recursive: true, force: true });
}

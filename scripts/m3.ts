// The M2 cluster provisions (and empties) its database. Require a dedicated M3 test URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fixture from '../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };
import type { MeetingPlanner } from '../apps/agent-node/src/meetings/planner.ts';
import { createDatabase } from '../apps/hub/src/db.ts';
import { M2Cluster } from './lib/m2-cluster.ts';
import { waitFor } from './lib/processes.ts';

const databaseUrl = process.env.M3_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'Set M3_TEST_DATABASE_URL to a disposable PostgreSQL database. Its hub tables are reset between scenarios.',
  );
const ids = Object.keys(fixture.agents);
const reports: Record<string, unknown>[] = [];
const directory = resolve(process.env.M3_EVIDENCE_DIR ?? '.state/evidence/m3');
mkdirSync(directory, { recursive: true });
type View = NonNullable<ReturnType<MeetingPlanner['view']>>;
const view = async (c: M2Cluster, id: string, m: string) =>
  (await c.agent(id).command({ command: 'meeting', meetingId: m })).meeting as View | null;
const until = (c: M2Cluster, id: string, m: string, status: string) =>
  waitFor(
    () => view(c, id, m),
    (s) => s?.status === status,
    status,
  );
const schedule = (c: M2Cluster, m: string, extra = {}) =>
  c
    .agent('agent-a')
    .command({
      command: 'schedule',
      meetingId: m,
      participantAgentIds: ids,
      durationMinutes: fixture.durationMinutes,
      window: fixture.window,
      ...extra,
    });
const fault = (c: M2Cluster, id: string, f: string, enabled = true) =>
  c.agent(id).command({ command: 'fixture-fault', fault: f, enabled });
async function counts(c: M2Cluster, m: string) {
  return Promise.all(ids.map(async (id) => (await view(c, id, m))?.eventCount ?? 0));
}

async function scenario(name: string, run: (c: M2Cluster, m: string) => Promise<object>) {
  const root = mkdtempSync(join(tmpdir(), 'meetmesh-m3-'));
  const runId = randomUUID(),
    meetingId = randomUUID();
  const c = new M2Cluster({
    runId,
    stateRoot: root,
    agentIds: ids,
    databaseUrl: databaseUrl!,
    certDir: resolve(process.env.CERT_DIR ?? '.state/certs'),
    secretsFile: resolve(process.env.SECRETS_FILE ?? '.state/secrets.json'),
  });
  const db = createDatabase(databaseUrl!);
  try {
    await c.start();
    const result = await run(c, meetingId);
    const wire = await db.query('SELECT content FROM mailbox WHERE meeting_id=$1', [meetingId]);
    assert.ok(wire.rowCount);
    assert.doesNotMatch(JSON.stringify([wire.rows, c.records()]), /PRIVATE-TITLE-301|PRIVATE-NOTES-301/);
    const trace = c
      .records()
      .filter(
        (r) =>
          r.meetingId === meetingId && (String(r.event).startsWith('meeting.') || r.event === 'calendar.applied'),
      );
    reports.push({
      name,
      runId,
      meetingId,
      passed: true,
      ...result,
      canaryFree: true,
      wireMessages: wire.rowCount,
      trace,
    });
    console.log('PASS', name);
  } catch (error) {
    reports.push({ name, runId, meetingId, passed: false, error: String(error) });
    process.exitCode = 1;
    console.error('FAIL', name, error);
  } finally {
    await db.end();
    await c.close();
    rmSync(root, { recursive: true, force: true });
  }
}
for (let i = 1; i <= 20; i++)
  await scenario('normal-' + i, async (c, m) => {
    await schedule(c, m);
    const meeting = (await until(c, 'agent-a', m, 'CONFIRMED'))!;
    assert.deepEqual(
      meeting.ranking.map((s) => [s.start, s.score]),
      [
        ['2026-11-10T11:00:00.000Z', 220],
        ['2026-11-10T08:00:00.000Z', 180],
      ],
    );
    const events = await counts(c, m);
    assert.deepEqual(events, [1, 1, 1]);
    return { ranking: meeting.ranking, events };
  });
for (const [name, reason] of [
  ['no-common-slot', 'NO_COMMON_SLOT'],
  ['decline', 'DECLINED'],
  ['timeout', 'TIMEOUT'],
] as const)
  await scenario(name, async (c, m) => {
    if (name !== 'no-common-slot') await fault(c, 'agent-c', name === 'timeout' ? 'holdVote' : 'decline');
    const extra =
      name === 'no-common-slot'
        ? { window: { start: '2026-11-11T00:00:00Z', end: '2026-11-11T01:00:00Z' } }
        : { timeoutMs: name === 'timeout' ? 1800 : 120000 };
    await schedule(c, m, extra);
    const result = (await until(c, 'agent-a', m, 'ABORTED'))!;
    assert.equal(result.decision?.reason, reason);
    for (const id of ids) await until(c, id, m, 'ABORTED');
    const events = await counts(c, m);
    assert.deepEqual(events, [0, 0, 0]);
    return { reason, events };
  });
await scenario('concurrent', async (c, m) => {
  const other = randomUUID(),
    window = { start: '2026-11-10T14:00:00+03:00', end: '2026-11-10T15:00:00+03:00' };
  await Promise.all([schedule(c, m, { window }), schedule(c, other, { window })]);
  const ended = await waitFor(
    () => Promise.all([view(c, 'agent-a', m), view(c, 'agent-a', other)]),
    (rs) => rs.every((r) => ['ABORTED', 'CONFIRMED'].includes(r?.status ?? '')),
    'two decisions',
  );
  assert.deepEqual(ended.map((r) => r?.status).sort(), ['ABORTED', 'CONFIRMED']);
  const events = await Promise.all([counts(c, m), counts(c, other)]);
  assert.deepEqual(
    events[0]!.map((v, i) => v + events[1]![i]!),
    [1, 1, 1],
  );
  return { events };
});
await scenario('reconcile-write', async (c, m) => {
  await fault(c, 'agent-b', 'failWrite');
  await schedule(c, m);
  const before = await waitFor(
    () => view(c, 'agent-a', m),
    (r) => r?.status === 'COMMIT_PENDING' && r.pending.join() === 'agent-b',
    'B pending',
  );
  await waitFor(
    () => view(c, 'agent-b', m),
    (r) => r?.error === 'PROVIDER_UNAVAILABLE',
    'provider unavailable',
  );
  await fault(c, 'agent-b', 'loseWriteReply');
  await fault(c, 'agent-b', 'failWrite', false);
  const uncertain = await waitFor(
    () => view(c, 'agent-b', m),
    (r) => r?.error === 'WRITE_RESULT_UNKNOWN',
    'lost write reply',
  );
  assert.equal(uncertain?.eventCount, 1);
  await c.stopAgent('agent-b', 'SIGKILL');
  await c.startAgent('agent-b');
  await until(c, 'agent-a', m, 'CONFIRMED');
  const events = await counts(c, m);
  assert.deepEqual(events, [1, 1, 1]);
  return { pending: before!.pending, events };
});
await scenario('decision-recovery', async (c, m) => {
  await fault(c, 'agent-a', 'pauseDecision');
  await schedule(c, m, { timeoutMs: 2200 });
  const before = (await until(c, 'agent-a', m, 'COMMIT_PENDING'))!;
  await c.stopAgent('agent-a', 'SIGKILL');
  await until(c, 'agent-b', m, 'PENDING_RECOVERY');
  await c.startAgent('agent-a');
  const after = (await until(c, 'agent-a', m, 'CONFIRMED'))!;
  assert.equal(after.decision?.id, before.decision?.id);
  const db = createDatabase(databaseUrl!);
  try {
    const { rows } = await db.query(
      `SELECT content FROM mailbox WHERE meeting_id=$1 AND content->'payload'->>'phase'='COMMIT' AND recipient_agent_id='agent-b' LIMIT 1`,
      [m],
    );
    for (let i = 0; i < 10; i++)
      await c.agent('agent-a').command({ command: 'raw', raw: JSON.stringify(rows[0].content) });
  } finally {
    await db.end();
  }
  const events = await counts(c, m);
  assert.deepEqual(events, [1, 1, 1]);
  return { decision: after.decision?.id, events };
});
writeFileSync(
  join(directory, 'runs.json'),
  JSON.stringify(
    {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      fixtureVersion: fixture.version,
      results: reports,
    },
    null,
    2,
  ) + '\n',
);

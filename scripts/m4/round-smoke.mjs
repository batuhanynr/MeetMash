import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Lab, build, ids } from './lab.mjs';
import fixture from '../../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };
const image = process.env.M4_IMAGE ?? 'meetmesh-m4:local';
build(image);
const lab = new Lab(image);
const id = randomUUID();
try {
  await lab.open();
  await lab.start(id, { 'agent-c': 'old-round' });
  await lab.cmd('agent-a', {
    command: 'schedule',
    meetingId: id,
    participantAgentIds: ids,
    durationMinutes: 60,
    window: fixture.window,
  });
  const until = async (read, ok) => {
    const limit = Date.now() + 10000;
    do {
      const value = await read();
      if (ok(value)) return value;
      await delay(25);
    } while (Date.now() < limit);
    throw new Error('Timed out waiting for old-round smoke');
  };
  await until(
    () => lab.records,
    (records) => records.some((m) => m.event === 'fault.old_round'),
  );
  await delay(250);
  const state = async () => (await lab.cmd('agent-a', { command: 'meeting', meetingId: id })).meeting;
  const before = await state();
  assert.equal(before.decision, null);
  assert(!before.votes.includes('agent-c'));
  const after = await until(state, (m) => m.status === 'CONFIRMED');
  assert(after.votes.includes('agent-c'));
  console.log(
    JSON.stringify({
      runId: id,
      environment: 'local Docker Linux',
      oldRoundVoteCounted: false,
      before: before.status,
      after: after.status,
    }),
  );
} finally {
  await lab.close();
}

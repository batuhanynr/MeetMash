import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessage, type Message } from '../../packages/protocol/src/index.ts';
import { MeetingPlanner, type Send } from '../../apps/agent-node/src/meetings/planner.ts';
import fixture from '../../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };

test('stale votes and decisions have no effect; fresh sync after transport expiry replays the durable decision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planner-'));
  const frames: Message[] = [];
  const open = (id: 'agent-a' | 'agent-b') => {
    const send: Send = (to, meetingId, type, payload, round) => {
      const msg = createMessage({
        fromAgentId: id,
        toAgentId: to,
        meetingId,
        type,
        payload,
        sequence: 1,
        ...round,
      });
      frames.push(msg);
      return msg;
    };
    return new MeetingPlanner(join(dir, id), id, fixture.agents[id], send, () => {});
  };
  let a = open('agent-a'),
    b = open('agent-b');
  try {
    const id = 'sync-test';
    a.schedule(id, { participantAgentIds: ['agent-a', 'agent-b'], durationMinutes: 60, window: fixture.window });
    a.tick();
    b.accept(frames.pop()!);
    b.tick();
    a.accept(frames.pop()!);
    a.tick();
    b.accept(frames.pop()!);
    b.tick();
    const vote = frames.pop()!;
    a.accept({ ...vote, roundId: 'old' });
    a.accept({ ...vote, decisionVersion: 99 });
    a.tick();
    assert.equal(a.view(id)?.decision, null);
    a.accept(vote);
    a.tick();
    const lost = frames.pop()!;
    assert.equal(lost.type, 'CONFIRM');
    b.accept({ ...lost, roundId: 'old' });
    assert.equal(b.view(id)?.eventCount, 0);
    a.close();
    a = open('agent-a');
    const later = Date.parse(lost.expiresAt) + 1000;
    b.tick(later);
    assert.equal(b.view(id)?.status, 'PENDING_RECOVERY');
    assert.equal(b.calendar.reserve('conflict', b.view(id)!.selected!), false);
    const sync = frames.pop()!;
    a.accept(sync);
    // Advance the message clock past the original envelope lifetime for the fresh decision.
    const clock = Date.now;
    try {
      Date.now = () => later;
      a.tick(later);
    } finally {
      Date.now = clock;
    }
    const fresh = frames.pop()!;
    assert.notEqual(lost.messageId, fresh.messageId);
    assert.ok(Date.parse(fresh.createdAt) > Date.parse(lost.expiresAt));
    assert.deepEqual(lost.payload, fresh.payload);
    for (let i = 0; i < 10; i++) {
      b.accept(fresh);
      b.tick(later);
    }
    b.close();
    b = open('agent-b');
    b.accept(fresh);
    b.tick(later);
    assert.equal(b.view(id)?.eventCount, 1);
    a.accept(frames.pop()!);
    a.tick(later);
    assert.equal(a.view(id)?.status, 'CONFIRMED');
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

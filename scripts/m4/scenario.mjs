import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import fixture from '../../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };
import { ids } from './lab.mjs';

const [a, , c] = ids;
const faultMap = {
  'N4-request': { [a]: 'first-request' },
  'N4-ack': { [c]: 'first-ack' },
  N5: { hub: 'duplicate-confirm' },
  'N7-coordinator': { [a]: 'pause-commit' },
  N8: { [a]: 'pause-commit' },
};
async function until(read, predicate, timeout, description) {
  const begin = performance.now();
  do {
    const value = await read();
    if (predicate(value)) return value;
    await delay(75);
  } while (performance.now() - begin < timeout);
  throw new Error('Timeout waiting for ' + description);
}
export async function run(lab, config, meta, index) {
  const profileId = config.id,
    runId = randomUUID(),
    meetingId = 'lab-' + runId;
  const row = {
    ...meta,
    profileId,
    runId,
    index,
    meetingId,
    dataset: 'calendar-v1',
    config,
    pass: false,
    critical: false,
    timedOut: false,
  };
  const offline = ['N3', 'N6', 'N7-hub'].includes(profileId);
  const state = (id) => lab.cmd(id, { command: 'meeting', meetingId }).then((r) => r.meeting);
  const mail = () => lab.call('hub', 'mail', { meetingId });
  const wake = async () => {
    await lab.call(a, 'restored');
    await lab.startAgent(c);
  };
  const assertSafety = (condition, detail) => {
    if (!condition) {
      row.critical = true;
      throw new Error(detail);
    }
  };
  try {
    await lab.start(runId, faultMap[profileId], offline ? [c] : []);
    row.qdisc = await lab.profile(config.netem ? profileId : 'N0');
    await lab.cmd(a, {
      command: 'schedule',
      meetingId,
      participantAgentIds: ids,
      durationMinutes: fixture.durationMinutes,
      window: fixture.window,
      timeoutMs: config.deadlineMs ?? 120000,
    });
    if (offline) {
      await until(
        mail,
        (rows) => rows.some((m) => m.recipient === c && m.type === 'REQUEST' && m.status === 'QUEUED'),
        5000,
        'offline mailbox',
      );
      row.queuedOffline = true;
      if (profileId === 'N3') {
        const { elapsedMs } = await lab.call(a, 'clock');
        await delay(Math.max(0, config.offlineMs - elapsedMs));
        row.offlineWaitMs = (await lab.call(a, 'clock')).elapsedMs;
        await wake();
      } else if (profileId === 'N7-hub') {
        await lab.call('hub', 'stop');
        await Promise.all(ids.filter((id) => id !== c).map((id) => lab.call(id, 'stop')));
        await lab.call('hub', 'start', { runId });
        assert((await mail()).some((m) => m.recipient === c && m.status === 'QUEUED'));
        await lab.call(a, 'restored');
        await Promise.all(ids.map((id) => lab.startAgent(id)));
      }
    }
    if (profileId === 'N7-coordinator' || profileId === 'N8') {
      await until(
        () => lab.records,
        (records) => records.some((m) => m.event === 'fault.pause'),
        8000,
        'durable decision before send',
      );
      row.beforeRestartDecision = lab.records.find(
        (m) => m.meetingId === meetingId && m.event === 'meeting.decided',
      )?.decisionId;
      if (profileId === 'N8') {
        const unresolved = await until(
          () => state(c),
          (m) => m?.status === 'PENDING_RECOVERY',
          10000,
          'participant recovery',
        );
        assertSafety(unresolved.eventCount === 0, 'calendar written before learning decision');
        row.isolatedParticipant = unresolved;
        row.heldReservation = await lab.call(c, 'reservation', { meetingId });
        assertSafety(!!row.heldReservation, 'accepted participant lost its reservation');
        await lab.call(a, 'restored');
        await lab.call(a, 'signal', { signal: 'SIGCONT' });
      } else {
        await lab.call(a, 'stop');
        await lab.call(a, 'restored');
        await lab.startAgent(a);
      }
    }
    const decision = await until(
      () => state(a),
      (m) => ['CONFIRMED', 'ABORTED'].includes(m?.status),
      config.budgetMs + 1000,
      'meeting decision',
    );
    Object.assign(row, await lab.call(a, 'clock'));
    if (row.beforeRestartDecision)
      assertSafety(decision.decision?.id === row.beforeRestartDecision, 'decision changed across recovery');
    row.status = decision.status;
    row.selected = decision.selected;
    if (profileId === 'N6') {
      assertSafety(decision.status === 'ABORTED', 'false success without C');
      await lab.startAgent(c);
      await until(
        () => state(c),
        (m) => m?.status === 'ABORTED',
        12000,
        'offline agent to resolve abort',
      );
    }
    const participants = await Promise.all(ids.map((id) => state(id)));
    row.eventCounts = participants.map((m) => m?.eventCount ?? null);
    const expected = config.expected ?? 'CONFIRMED';
    assertSafety(!row.eventCounts.some((n) => n > 1), 'duplicate calendar effect');
    if (decision.status === 'CONFIRMED') {
      assertSafety(
        row.eventCounts.every((n) => n === 1),
        'false confirmation with missing calendars',
      );
      assertSafety(
        Date.parse(decision.selected.start) === Date.parse('2026-11-10T14:00:00+03:00') &&
          decision.selected.score === 220,
        'wrong selected slot or score',
      );
    } else
      assertSafety(
        row.eventCounts.every((n) => n === 0),
        'event on aborted meeting',
      );
    assert.equal(decision.status, expected);
    if (profileId.startsWith('N4')) {
      const drop = lab.records.find((m) => m.event === 'fault.drop');
      assert(drop, 'specified message was dropped');
      if (profileId === 'N4-request') {
        await until(
          () => lab.records,
          (records) => records.some((m) => m.event === 'message.retried' && m.messageId === drop.messageId),
          5000,
          'retry',
        );
      } else {
        await until(
          mail,
          (rows) => rows.some((m) => m.id === drop.ackFor && m.attempts >= 2 && m.status === 'DELIVERED'),
          15000,
          'mailbox retry and recipient ACK',
        );
        // Dart's CLI reports its own drop. The durable mailbox attempt count and receipt
        // verify the same retransmission even when that client does not emit a duplicate log.
        if (!lab.dartAgent)
          assert(lab.records.some((m) => m.event === 'message.duplicate' && m.messageId === drop.ackFor));
      }
    }
    if (profileId === 'N5')
      assert(
        lab.records.some((m) => m.event === 'fault.triple') &&
          lab.records.some((m) => m.event === 'message.duplicate'),
      );
    const measured = config.fromRecovery ? row.recoveryMs : row.elapsedMs;
    assert(measured !== null && measured <= config.budgetMs, 'Elapsed time exceeded budget: ' + measured + ' ms');
    row.pass = true;
  } catch (error) {
    row.error = error.message;
    row.timedOut = /timeout|timed out|exceeded budget/i.test(row.error);
    if (row.elapsedMs === undefined) Object.assign(row, await lab.call(a, 'clock').catch(() => ({})));
  } finally {
    const messages = lab.records.filter((m) => m.meetingId === meetingId);
    row.messageCount = messages.filter((m) => m.event === 'message.sent' || m.event === 'message.retried').length;
    row.retries = messages.filter((m) => m.event === 'message.retried').length;
    row.duplicates = messages.filter((m) => m.event === 'message.duplicate').length;
    row.faults = messages.filter((m) => m.event.startsWith('fault.'));
    row.receipts = await mail().catch(() => []);
    row.mailboxRetries = row.receipts.reduce((n, m) => n + Math.max(0, m.attempts - 1), 0);
    row.qdiscEnd = await lab.profile('show').catch(() => null);
    row.qdiscReset = await lab.profile('reset').catch(() => null);
    if (!row.qdiscReset || !Object.values(row.qdiscReset).every((s) => s.includes('noqueue'))) {
      row.pass = false;
      row.error = 'Data qdisc did not reset';
    }
    await lab.stopAll();
  }
  return row;
}

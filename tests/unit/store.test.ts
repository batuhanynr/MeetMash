import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createMessage, type Message } from '../../packages/protocol/src/index.ts';
import { SqliteAgentStore } from '../../apps/agent-node/src/sqlite-store.ts';

const request = () => createMessage({
  fromAgentId: 'agent-a', toAgentId: 'agent-b', meetingId: 'meeting-store', type: 'REJECT',
  sequence: 1, payload: { reasonCode: 'DECLINED' },
});

test('ten deliveries commit one effect and changed content is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-store-'));
  const store = new SqliteAgentStore(directory, 'agent-b');
  try {
    const message = request();
    for (let index = 0; index < 10; index++) {
      assert.equal(store.persist(message), index === 0);
      store.completePending();
    }
    assert.equal(store.snapshot().effectCount, 1);
    assert.equal(store.snapshot().pendingWork, 0);
    assert.throws(() => store.persist({ ...message, nonce: 'changed' }), { code: 'MESSAGE_ID_CONFLICT' });
    assert.equal(store.snapshot().effectCount, 1);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('pending work, outbox attempts, and scoped sequences survive reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-reopen-'));
  let store = new SqliteAgentStore(directory, 'agent-b');
  try {
    const message = request();
    store.persist(message);
    store.enqueue(message);
    store.attempted(message.messageId, 42);
    assert.equal(store.nextSequence('agent-a', 'meeting-1'), 1);
    assert.equal(store.nextSequence('agent-c', 'meeting-1'), 1);
    assert.equal(store.nextSequence('agent-a', 'meeting-2'), 1);
    store.close();
    store = new SqliteAgentStore(directory, 'agent-b');
    assert.equal(store.snapshot().pendingWork, 1);
    assert.equal(store.snapshot().effectCount, 0);
    assert.equal(store.due(42)[0]!.attempts, 1);
    assert.equal(store.nextSequence('agent-a', 'meeting-1'), 2);
    store.completePending();
    assert.equal(store.snapshot().effectCount, 1);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('state ownership and exclusive process lock prevent accidental sharing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-lock-'));
  const store = new SqliteAgentStore(directory, 'agent-a');
  try {
    assert.throws(() => new SqliteAgentStore(directory, 'agent-a'), { code: 'STATE_IN_USE' });
    store.close();
    assert.throws(() => new SqliteAgentStore(directory, 'agent-b'), { code: 'STATE_OWNER_MISMATCH' });
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('ACK must bind recipient, meeting, and recipient persistence scope', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-ack-'));
  const store = new SqliteAgentStore(directory, 'agent-a');
  try {
    const message = request();
    store.enqueue(message);
    const ack = createMessage({
      fromAgentId: 'agent-b', toAgentId: 'agent-a', meetingId: message.meetingId, sequence: 1,
      type: 'ACK', payload: { ackForMessageId: message.messageId, scope: 'recipient.persisted' },
    }) as Extract<Message, { type: 'ACK' }>;
    for (const invalid of [
      { ...ack, fromAgentId: 'agent-c' }, { ...ack, meetingId: 'another-meeting' },
      { ...ack, payload: { ...ack.payload, scope: 'relay.persisted' as const } },
    ]) assert.throws(() => store.acknowledge(invalid), { code: 'INVALID_ACK' });
    assert.equal(store.snapshot().outbox[0]!.status, 'PENDING');
    store.acknowledge(ack);
    assert.equal(store.snapshot().outbox[0]!.status, 'ACKED');
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('expired new delivery creates neither inbox nor work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-expired-'));
  const store = new SqliteAgentStore(directory, 'agent-b');
  try {
    const message = { ...request(), createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T00:03:00Z' };
    assert.throws(() => store.persist(message), { code: 'MESSAGE_EXPIRED' });
    assert.equal(store.snapshot().inbox.length, 0);
    assert.equal(store.snapshot().pendingWork, 0);
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('local reset clears only synthetic state and keeps the identity owner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-reset-'));
  const store = new SqliteAgentStore(directory, 'agent-a');
  try {
    const message = request();
    store.persist(message);
    store.completePending();
    store.enqueue(message);
    store.nextSequence('agent-b', 'meeting-store');
    store.reset();
    assert.deepEqual(store.snapshot(), { inbox: [], outbox: [], effectCount: 0, pendingWork: 0 });
    assert.equal(store.nextSequence('agent-b', 'meeting-store'), 1);
    store.close();
    assert.throws(() => new SqliteAgentStore(directory, 'agent-b'), { code: 'STATE_OWNER_MISMATCH' });
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

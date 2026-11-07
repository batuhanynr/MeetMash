import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createMessage, type Message } from '../../packages/protocol/src/index.ts';
import type { Database } from '../../apps/hub/src/db.ts';
import { Mailbox } from '../../apps/hub/src/mailbox.ts';
import { PgMailboxStore } from '../../apps/hub/src/pg-mailbox.ts';
import { freshDatabase } from './helper.ts';

let database: Database;
let store: PgMailboxStore;

before(async () => { database = await freshDatabase(); store = new PgMailboxStore(database); });
after(async () => { await database.end(); });
beforeEach(async () => { await database.query('TRUNCATE mailbox RESTART IDENTITY'); });

function request(from: string, to: string): Message {
  return createMessage({
    fromAgentId: from, toAgentId: to, meetingId: 'meeting-1', type: 'REQUEST', sequence: 1,
    payload: { participantAgentIds: [to], durationMinutes: 60, window: { start: '2026-11-10T09:00:00Z', end: '2026-11-10T17:00:00Z' } },
  });
}
const at = (message: Message): number => Date.parse(message.createdAt);

test('a message for an offline recipient stays QUEUED and is not yet delivered', async () => {
  const message = request('agent-a', 'agent-c');
  const mailbox = new Mailbox(store, () => at(message));
  assert.deepEqual(await mailbox.accept(message), { queued: true });
  const [item] = await mailbox.snapshot('agent-c');
  assert.equal(item?.status, 'QUEUED');
});

test('the same message sent ten times produces a single queue row', async () => {
  const message = request('agent-a', 'agent-c');
  const mailbox = new Mailbox(store, () => at(message));
  const results = [];
  for (let i = 0; i < 10; i++) results.push((await mailbox.accept(message)).queued);
  assert.deepEqual(results, [true, false, false, false, false, false, false, false, false, false]);
  assert.equal((await mailbox.snapshot('agent-c')).length, 1);
});

test('the queue and message id survive a hub restart', async () => {
  const message = request('agent-a', 'agent-c');
  await new Mailbox(store, () => at(message)).accept(message);
  // A new store instance stands in for a restarted hub reading the same durable Postgres state.
  const [item] = await new PgMailboxStore(database).list('agent-c');
  assert.equal(item?.messageId, message.messageId);
  assert.equal(item?.status, 'QUEUED');
});

test('delivery becomes DELIVERED only after the recipient acknowledges', async () => {
  const message = request('agent-a', 'agent-c');
  const mailbox = new Mailbox(store, () => at(message), 10_000);
  await mailbox.accept(message);
  const delivered: string[] = [];
  const count = await mailbox.drain('agent-c', async m => { delivered.push(m.messageId); });
  assert.equal(count, 1);
  assert.equal((await mailbox.snapshot('agent-c'))[0]?.status, 'SENT');
  assert.equal(await mailbox.confirm(message.messageId), true);
  assert.equal((await mailbox.snapshot('agent-c'))[0]?.status, 'DELIVERED');
});

test('a locked item is not re-delivered until its lock expires', async () => {
  const message = request('agent-a', 'agent-c');
  let clock = at(message);
  const mailbox = new Mailbox(store, () => clock, 10_000);
  await mailbox.accept(message);
  assert.equal(await mailbox.drain('agent-c', async () => {}), 1);
  assert.equal(await mailbox.drain('agent-c', async () => {}), 0); // still locked
  clock += 10_001;
  assert.equal(await mailbox.drain('agent-c', async () => {}), 1); // reclaimed after the lock expired
});

test('an expired, unaccepted message starts no work and is reported to the sender', async () => {
  const message = request('agent-a', 'agent-c');
  let clock = at(message);
  const mailbox = new Mailbox(store, () => clock, 10_000);
  await mailbox.accept(message);
  clock = Date.parse(message.expiresAt) + 1;
  const expired = await mailbox.sweepExpired();
  assert.deepEqual(expired, [{ messageKey: message.messageId, senderAgentId: 'agent-a' }]);
  assert.equal(await mailbox.drain('agent-c', async () => {}), 0);
  assert.equal((await mailbox.snapshot('agent-c'))[0]?.status, 'EXPIRED');
});

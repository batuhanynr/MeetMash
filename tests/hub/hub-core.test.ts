import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createMessage, ProtocolError, type Message, type MessageType, type Payloads } from '../../packages/protocol/src/index.ts';
import type { Database } from '../../apps/hub/src/db.ts';
import { Directory } from '../../apps/hub/src/directory.ts';
import { Mailbox } from '../../apps/hub/src/mailbox.ts';
import { Registrar } from '../../apps/hub/src/registrar.ts';
import { PgDirectoryStore } from '../../apps/hub/src/pg-directory.ts';
import { PgMailboxStore } from '../../apps/hub/src/pg-mailbox.ts';
import { PgRegistrarStore } from '../../apps/hub/src/pg-sessions.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import { HubCore, type AgentConnection } from '../../apps/hub/src/hub-core.ts';
import { freshDatabase } from './helper.ts';

let database: Database;

before(async () => { database = await freshDatabase(); });
after(async () => { await database.end(); });

class Fake implements AgentConnection {
  readonly frames: string[] = [];
  send(frame: string): void { this.frames.push(frame); }
  parsed(): Record<string, unknown>[] { return this.frames.map(frame => JSON.parse(frame) as Record<string, unknown>); }
  ofKind(kind: string): Record<string, unknown> | undefined { return this.parsed().find(frame => frame.kind === kind); }
  domain(): Message[] { return this.parsed().filter(frame => frame.kind === undefined) as unknown as Message[]; }
}

function newHub(): HubCore {
  const directory = new Directory(new PgDirectoryStore(database));
  const registrar = new Registrar(new PgRegistrarStore(database));
  const mailbox = new Mailbox(new PgMailboxStore(database));
  return new HubCore(registrar, directory, mailbox, () => {});
}

const message = <T extends MessageType>(from: string, to: string, type: T, payload: Payloads[T]): Message =>
  createMessage({ fromAgentId: from, toAgentId: to, meetingId: 'meeting-1', type, payload, sequence: 1 });
const request = (from: string, to: string): Message =>
  message(from, to, 'REQUEST', { participantAgentIds: [to], durationMinutes: 60, window: { start: '2026-11-10T09:00:00Z', end: '2026-11-10T17:00:00Z' } });

beforeEach(async () => {
  await database.query('TRUNCATE agent_identities, agent_profiles, agent_capabilities, friendships, sessions, mailbox RESTART IDENTITY CASCADE');
  const directory = new Directory(new PgDirectoryStore(database));
  for (const [id, name, secret] of [['agent-a', 'Alice', 'secret-a'], ['agent-b', 'Bravo', 'secret-b']] as const) {
    await provisionIdentity(database, { agentId: id, userId: `user-${id}`, secret });
    await directory.putProfile({ agentId: id, displayName: name, visibility: 'public', capabilities: ['scheduling'] });
  }
});

test('a connection with a wrong bootstrap secret is refused', async () => {
  await assert.rejects(newHub().connect('agent-a', 'wrong', null, new Fake()), (error: ProtocolError) => error.code === 'AUTH_FAILED');
});

test('an agent discovers another through a directory lookup', async () => {
  const hub = newHub();
  const connection = new Fake();
  const generation = await hub.connect('agent-a', 'secret-a', null, connection);
  await hub.handle('agent-a', generation, JSON.stringify({ kind: 'directory.lookup', by: 'name', term: 'Bravo', requestId: 'r1' }));
  const result = connection.ofKind('directory.result');
  assert.deepEqual(result?.agents, [{ agentId: 'agent-b', displayName: 'Bravo' }]);
});

test('a message to an offline agent is queued, relay-acked, and redelivered on reconnect then confirmed', async () => {
  const hub = newHub();
  const connA = new Fake();
  const generationA = await hub.connect('agent-a', 'secret-a', null, connA);

  const sent = request('agent-a', 'agent-b');
  await hub.handle('agent-a', generationA, JSON.stringify(sent));
  assert.equal(connA.ofKind('relay.ack')?.messageId, sent.messageId); // hub took durable responsibility
  const mailbox = new Mailbox(new PgMailboxStore(database));
  assert.equal((await mailbox.snapshot('agent-b'))[0]?.status, 'QUEUED'); // still waiting, not delivered

  const connB = new Fake();
  const generationB = await hub.connect('agent-b', 'secret-b', null, connB);
  assert.equal(connB.domain()[0]?.messageId, sent.messageId); // redelivered on reconnect
  assert.equal((await mailbox.snapshot('agent-b'))[0]?.status, 'SENT');

  const ack = message('agent-b', 'agent-a', 'ACK', { ackForMessageId: sent.messageId, scope: 'recipient.persisted' });
  await hub.handle('agent-b', generationB, JSON.stringify(ack));
  assert.equal((await mailbox.snapshot('agent-b'))[0]?.status, 'DELIVERED');
  assert.ok(connA.domain().some(frame => frame.type === 'ACK')); // receipt forwarded to the original sender
});

test('a second connection displaces the first for the same agent', async () => {
  const hub = newHub();
  const first = new Fake();
  await hub.connect('agent-a', 'secret-a', null, first);
  await hub.connect('agent-a', 'secret-a', null, new Fake());
  assert.ok(first.ofKind('displaced'));
});

test('an envelope whose sender does not match the connection is rejected', async () => {
  const hub = newHub();
  const connection = new Fake();
  const generation = await hub.connect('agent-a', 'secret-a', null, connection);
  await hub.handle('agent-a', generation, JSON.stringify(request('agent-b', 'agent-a')));
  assert.equal(connection.ofKind('error')?.code, 'SENDER_MISMATCH');
});

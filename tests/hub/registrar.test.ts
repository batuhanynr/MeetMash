import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { ProtocolError } from '../../packages/protocol/src/index.ts';
import type { Database } from '../../apps/hub/src/db.ts';
import { Registrar } from '../../apps/hub/src/registrar.ts';
import { PgRegistrarStore } from '../../apps/hub/src/pg-sessions.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import { freshDatabase } from './helper.ts';

let database: Database;
let store: PgRegistrarStore;

before(async () => { database = await freshDatabase(); store = new PgRegistrarStore(database); });
after(async () => { await database.end(); });

beforeEach(async () => {
  await database.query('TRUNCATE agent_identities, sessions RESTART IDENTITY CASCADE');
  await provisionIdentity(database, { agentId: 'agent-a', userId: 'user-a', secret: 'secret-a' });
  await provisionIdentity(database, { agentId: 'agent-b', userId: 'user-b', secret: 'secret-b' });
});

test('a wrong bootstrap secret or unknown agent is rejected', async () => {
  const registrar = new Registrar(store);
  await assert.rejects(registrar.register('agent-a', 'wrong'), (error: ProtocolError) => error.code === 'AUTH_FAILED');
  await assert.rejects(registrar.register('ghost', 'secret-a'), (error: ProtocolError) => error.code === 'AUTH_FAILED');
});

test('an agent is online on register and offline 15s after its last heartbeat', async () => {
  let clock = 1_000_000;
  const registrar = new Registrar(store, () => clock, 15_000);
  await registrar.register('agent-a', 'secret-a');
  assert.equal(await registrar.isOnline('agent-a'), true);
  clock += 15_001;
  assert.equal(await registrar.isOnline('agent-a'), false);
});

test('a heartbeat with the current token keeps the agent online', async () => {
  let clock = 2_000_000;
  const registrar = new Registrar(store, () => clock, 15_000);
  const { token } = await registrar.register('agent-a', 'secret-a');
  clock += 10_000;
  await registrar.heartbeat('agent-a', token);
  clock += 10_000;
  assert.equal(await registrar.isOnline('agent-a'), true);
});

test("one agent's token cannot authenticate or heartbeat as another agent", async () => {
  const registrar = new Registrar(store);
  const { token } = await registrar.register('agent-a', 'secret-a');
  assert.equal((await registrar.authenticate('agent-a', token)).userId, 'user-a');
  await assert.rejects(registrar.authenticate('agent-b', token), (error: ProtocolError) => error.code === 'SESSION_INVALID');
  await assert.rejects(registrar.heartbeat('agent-b', token), (error: ProtocolError) => error.code === 'SESSION_INVALID');
});

test('reconnecting rotates the session and invalidates the previous token', async () => {
  const registrar = new Registrar(store);
  const first = await registrar.register('agent-a', 'secret-a');
  const second = await registrar.register('agent-a', 'secret-a');
  assert.equal(second.generation, first.generation + 1);
  await assert.rejects(registrar.authenticate('agent-a', first.token), (error: ProtocolError) => error.code === 'SESSION_INVALID');
  assert.equal((await registrar.authenticate('agent-a', second.token)).generation, second.generation);
});

test('a late close from a replaced session does not take the new session offline', async () => {
  const registrar = new Registrar(store);
  const first = await registrar.register('agent-a', 'secret-a');
  const second = await registrar.register('agent-a', 'secret-a');
  await registrar.disconnect('agent-a', first.generation); // stale close arriving after the new session registered
  assert.equal(await registrar.isOnline('agent-a'), true);
  await registrar.disconnect('agent-a', second.generation);
  assert.equal(await registrar.isOnline('agent-a'), false);
});

test('the endpoint can change while the agent id stays stable', async () => {
  const registrar = new Registrar(store);
  await registrar.register('agent-a', 'secret-a', 'wss://127.0.0.1:1111');
  await registrar.register('agent-a', 'secret-a', 'wss://127.0.0.1:2222');
  const session = await store.getSession('agent-a');
  assert.equal(session?.endpoint, 'wss://127.0.0.1:2222');
  const count = await database.query('SELECT count(*)::int AS n FROM sessions WHERE agent_id = $1', ['agent-a']);
  assert.equal(count.rows[0].n, 1);
});

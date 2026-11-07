import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Directory, type DirectoryStore, type Profile } from '../../apps/hub/src/directory.ts';
import { PgDirectoryStore } from '../../apps/hub/src/pg-directory.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import type { Database } from '../../apps/hub/src/db.ts';
import { freshDatabase } from './helper.ts';

let database: Database;
let store: PgDirectoryStore;

before(async () => { database = await freshDatabase(); store = new PgDirectoryStore(database); });
after(async () => { await database.end(); });

async function seed(profiles: (Profile & { friends?: string[] })[]): Promise<void> {
  await database.query('TRUNCATE agent_identities, agent_profiles, agent_capabilities, friendships RESTART IDENTITY CASCADE');
  for (const profile of profiles) {
    await provisionIdentity(database, { agentId: profile.agentId, userId: `user-${profile.agentId}`, secret: 'seed-secret' });
    await store.upsertProfile(profile);
  }
  for (const profile of profiles) for (const friend of profile.friends ?? []) await store.addFriend(profile.agentId, friend);
}

beforeEach(async () => {
  // agent-b is friends-only and has added agent-a as a friend; agent-c is private; two agents share a display name.
  await seed([
    { agentId: 'agent-a', displayName: 'Alice', visibility: 'public', capabilities: ['Mobile', 'scheduling'] },
    { agentId: 'agent-b', displayName: 'Scheduler', visibility: 'friends', capabilities: ['calendar'], friends: ['agent-a'] },
    { agentId: 'agent-c', displayName: 'Carol', visibility: 'private', capabilities: ['calendar'] },
    { agentId: 'agent-d', displayName: 'Scheduler', visibility: 'public', capabilities: ['calendar'] },
  ]);
});

test('distinct agent IDs with the same display name are not merged', async () => {
  const directory = new Directory(store);
  const matches = await directory.searchByName('agent-a', 'scheduler');
  assert.deepEqual(matches.map(p => p.agentId).sort(), ['agent-b', 'agent-d']);
});

test('a private agent is not revealed by search or by direct id lookup', async () => {
  const directory = new Directory(store);
  assert.equal(await directory.lookup('agent-a', 'agent-c'), undefined);
  assert.deepEqual(await directory.searchByName('agent-a', 'carol'), []);
});

test('owner sees their own private profile', async () => {
  const directory = new Directory(store);
  const self = await directory.lookup('agent-c', 'agent-c');
  assert.equal(self?.agentId, 'agent-c');
});

test('friends-only profile is visible to a friend and hidden from a stranger', async () => {
  const directory = new Directory(store);
  assert.equal((await directory.lookup('agent-a', 'agent-b'))?.agentId, 'agent-b');
  assert.equal(await directory.lookup('agent-d', 'agent-b'), undefined);
});

test('capability search returns only visible agents', async () => {
  const directory = new Directory(store);
  // agent-a is a friend of agent-b, so both calendar agents visible to it exclude the private agent-c.
  const forA = await directory.searchByCapability('agent-a', 'calendar');
  assert.deepEqual(forA.map(p => p.agentId).sort(), ['agent-b', 'agent-d']);
  const forD = await directory.searchByCapability('agent-d', 'calendar');
  assert.deepEqual(forD.map(p => p.agentId).sort(), ['agent-d']);
});

test('making a profile private invalidates cached results without waiting for the TTL', async () => {
  const clock = 1_000_000;
  const directory = new Directory(store, () => clock, 30_000);
  // agent-c is a stranger to agent-d, so it only sees the public agent-d among the two "Scheduler" profiles.
  assert.deepEqual((await directory.searchByName('agent-c', 'scheduler')).map(p => p.agentId), ['agent-d']);
  await directory.setVisibility('agent-d', 'private');
  // The clock has not advanced, so only invalidation (not TTL expiry) can hide agent-d from the stranger.
  assert.deepEqual(await directory.searchByName('agent-c', 'scheduler'), []);
});

test('the 30s cache avoids repeat store reads within the TTL', async () => {
  let reads = 0;
  const counting: DirectoryStore = {
    findByName: (name) => { reads++; return store.findByName(name); },
    isFriend: (owner, candidate) => store.isFriend(owner, candidate),
    getProfile: (id) => store.getProfile(id),
    findByCapability: (cap) => store.findByCapability(cap),
    upsertProfile: (p) => store.upsertProfile(p),
    setVisibility: (id, v) => store.setVisibility(id, v),
    addFriend: (o, f) => store.addFriend(o, f),
  };
  let clock = 5_000;
  const directory = new Directory(counting, () => clock, 30_000);
  await directory.searchByName('agent-a', 'alice');
  await directory.searchByName('agent-a', 'alice');
  assert.equal(reads, 1);
  clock += 30_001;
  await directory.searchByName('agent-a', 'alice');
  assert.equal(reads, 2);
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProtocolError } from '../../packages/protocol/src/index.ts';
import { SqliteAgentStore } from '../../apps/agent-node/src/sqlite-store.ts';

const isReplay = (error: unknown): boolean => error instanceof ProtocolError && error.code === 'REPLAY_DETECTED';

test('a new nonce is accepted, an identical retransmit is a duplicate, changed content is a replay', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-replay-'));
  const store = new SqliteAgentStore(directory, 'agent-a');
  try {
    const expires = Date.now() + 60_000;
    assert.equal(store.rememberNonce('nonce-1', 'content-hash-a', expires), true);
    assert.equal(store.rememberNonce('nonce-1', 'content-hash-a', expires), false);
    assert.throws(() => store.rememberNonce('nonce-1', 'content-hash-b', expires), isReplay);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an accepted nonce survives a reopen so a restart cannot replay it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meetmesh-replay-'));
  try {
    const first = new SqliteAgentStore(directory, 'agent-a');
    first.rememberNonce('nonce-1', 'content-hash-a', Date.now() + 60_000);
    first.close();
    const second = new SqliteAgentStore(directory, 'agent-a');
    assert.equal(second.rememberNonce('nonce-1', 'content-hash-a', Date.now() + 60_000), false);
    assert.throws(() => second.rememberNonce('nonce-1', 'content-hash-b', Date.now() + 60_000), isReplay);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

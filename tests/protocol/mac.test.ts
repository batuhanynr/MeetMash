import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Message } from '../../packages/protocol/src/index.ts';
import { messageHash, signMessage, signingString, verifyMessage } from '../../packages/protocol/src/mac.ts';

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/protocol/fixtures/mac-vectors.json', import.meta.url)), 'utf8')) as {
  key: string; keyId: string; message: Message; signingString: string; mac: string; messageHash: string;
};

test('signing and verifying round-trips with the pair key', () => {
  const signed = signMessage(vectors.message, vectors.key, vectors.keyId);
  assert.equal(signed.auth.keyId, vectors.keyId);
  assert.equal(verifyMessage(signed, vectors.key), true);
});

test('the stored vectors stay stable so Node and Dart agree', () => {
  assert.equal(signingString(vectors.message), vectors.signingString);
  assert.equal(signMessage(vectors.message, vectors.key, vectors.keyId).auth.mac, vectors.mac);
  assert.equal(messageHash(vectors.message), vectors.messageHash);
});

test('a tampered recipient or payload fails verification', () => {
  const signed = signMessage(vectors.message, vectors.key, vectors.keyId);
  assert.equal(verifyMessage({ ...signed, toAgentId: 'agent-c' }, vectors.key), false);
  const tamperedPayload = { ...signed, payload: { ...signed.payload, durationMinutes: 30 } } as Message;
  assert.equal(verifyMessage(tamperedPayload, vectors.key), false);
});

test('a wrong key and a missing mac both fail verification', () => {
  const signed = signMessage(vectors.message, vectors.key, vectors.keyId);
  assert.equal(verifyMessage(signed, 'wrong-key'), false);
  assert.equal(verifyMessage(vectors.message, vectors.key), false);
});

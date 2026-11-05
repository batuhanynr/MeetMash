import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '../../packages/protocol/fixtures/messages.json' with { type: 'json' };
import { canonicalJson, parseMessage, ProtocolError, validateMessage } from '../../packages/protocol/src/index.ts';

for (const fixture of fixtures) {
  test(fixture.name, () => {
    if (fixture.valid) assert.equal(validateMessage(fixture.message).type, fixture.message.type);
    else assert.throws(() => validateMessage(fixture.message), (error: unknown) =>
      error instanceof ProtocolError && error.code === fixture.code);
  });
}

test('malformed JSON produces an explicit error', () => {
  assert.throws(() => parseMessage('{'), { code: 'INVALID_JSON' });
});

test('timestamps require a real calendar date and explicit offset', () => {
  const message = fixtures[0]!.message;
  for (const createdAt of ['2026-02-30T06:00:00Z', '2026-11-05T06:00:00', '2026-11-05T25:00:00Z']) {
    assert.throws(() => validateMessage({ ...message, createdAt }), { code: 'INVALID_MESSAGE' });
  }
});

test('logical message comparison ignores object key order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 3, c: 2 } }), canonicalJson({ a: { c: 2, d: 3 }, b: 1 }));
});

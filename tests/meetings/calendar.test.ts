import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fixture from '../../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };
import { LocalCalendar } from '../../apps/agent-node/src/meetings/calendar.ts';
import { candidates, rankSlots } from '../../apps/agent-node/src/meetings/slots.ts';

test('private calendars produce both common slots, ranked independently of response order', () => {
  const offers = Object.fromEntries(
    Object.entries(fixture.agents).map(([id, p]) => {
      const db = new DatabaseSync(':memory:');
      try {
        return [id, new LocalCalendar(db, p).offers(fixture.window, 60)];
      } finally {
        db.close();
      }
    }),
  );
  const ids = Object.keys(offers);
  assert.doesNotMatch(JSON.stringify(offers), /PRIVATE|description|title/);
  assert.deepEqual(
    rankSlots(ids, offers).map((s) => [s.start, s.score]),
    [
      ['2026-11-10T11:00:00.000Z', 220],
      ['2026-11-10T08:00:00.000Z', 180],
    ],
  );
  for (const slots of Object.values(offers)) for (const s of slots) s.score = 50;
  assert.equal(rankSlots(ids.reverse(), offers)[0]?.start, '2026-11-10T08:00:00.000Z');
  assert.deepEqual(rankSlots([...ids, 'missing'], offers), []);
  assert.deepEqual(rankSlots(ids, { ...offers, 'agent-b': [] }), []);
});

test('same instant, midnight and touching boundaries preserve availability; conflicting holds exclude each other', () => {
  const window = { start: '2026-11-10T23:30:00+03:00', end: '2026-11-11T01:00:00+03:00' };
  const p = { working: [window], busy: [], preferences: [] };
  const db = new DatabaseSync(':memory:');
  try {
    const calendar = new LocalCalendar(db, p);
    const [slot] = candidates(p, [{ start: '2026-11-10T20:00:00Z', end: '2026-11-10T20:30:00Z' }], window, 60);
    assert.equal(slot?.start, '2026-11-10T20:30:00.000Z');
    assert.ok(calendar.reserve('m', slot!));
    assert.equal(calendar.reserve('other', slot!), false);
    calendar.ensureEvent('m', slot!, '  Tasarım   değerlendirmesi  ');
    calendar.release('m');
    calendar.ensureEvent('m', slot!);
    assert.equal(db.prepare('SELECT title FROM calendar_events WHERE meeting=?').get('m')?.title, 'Tasarım değerlendirmesi');
    assert.equal(calendar.reserve('other', slot!), false);
  } finally {
    db.close();
  }
});

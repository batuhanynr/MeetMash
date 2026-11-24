import assert from 'node:assert/strict';
import test from 'node:test';
import { previewMeeting } from '../../apps/hub/src/intelligence/intent.ts';
import type { Profile } from '../../apps/hub/src/directory.ts';

const ada: Profile = { agentId: 'a', displayName: 'Ada', visibility: 'public' };
const request = 'Ada ile yarın 12:00-14:00 arası 30 dakika görüşelim.';
const draft = { names: ['Ada'], startLocal: '2026-11-10T12:00', endLocal: '2026-11-10T14:00', durationMinutes: 30, preferences: [], questions: [] };
const preview = (value: unknown, profiles = [ada], zone = 'Europe/Istanbul') =>
  previewMeeting({ extract: async () => value }, async () => profiles, 'host', request, zone, new Date('2026-11-09T06:00Z'));

test('model draft resolves visible unique names and local times into a preview', async () => {
  const result = await preview(draft);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.participantAgentIds, ['host','a']);
  assert.deepEqual(result.window, { start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T11:00:00.000Z' });
  assert.equal(result.title, 'MeetMesh');
});
test('preview uses a topic from the request and falls back when the model invents one', async () => {
  const named = await previewMeeting({ extract: async () => ({ ...draft, title: '  Tasarım   değerlendirmesi  ' }) },
    async () => [ada], 'host', request + ' Tasarım değerlendirmesi.', 'Europe/Istanbul', new Date('2026-11-09T06:00Z'));
  assert.equal(named.title, 'Tasarım değerlendirmesi');
  assert.equal((await preview({ ...draft, title: 'Bütçe çalışması' })).title, 'MeetMesh');
});
test('only uniquely matched visible names resolve and the model cannot inject agent IDs', async () => {
  const injected = await preview({ ...draft, names: ['a'], participantAgentIds: ['someone'] });
  assert.equal(injected.status, 'clarify');
  assert.deepEqual(injected.participantAgentIds, ['host']);
  assert.equal((await preview(draft, [])).status, 'clarify');
  assert.equal((await preview(draft, [ada, { ...ada, agentId: 'a2' }])).status, 'clarify');
});
test('preview accepts contextual names and usable dates that differ from text hints', async () => {
  const deniz = { ...ada, agentId: 'deniz', displayName: 'Deniz' };
  const result = await previewMeeting(
    { extract: async () => ({ ...draft, names: ['Deniz'], startLocal: '2026-11-10T00:00', endLocal: '2026-11-10T23:59',
      questions: ['Belirli bir saat aralığı var mı?'] }) },
    async () => [deniz], 'host', 'yarın denizle yarım saat görüşmem gerek', 'Europe/Istanbul', new Date('2026-11-09T20:26Z'),
  );
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.participantAgentIds, ['host', 'deniz']);
  assert.equal(result.durationMinutes, 30);
  assert.deepEqual(result.window, { start: '2026-11-09T21:00:00.000Z', end: '2026-11-10T20:59:00.000Z' });
  assert.deepEqual(result.questions, []);
});
test('partial preview retains usable fields when others are missing or malformed', async () => {
  const result = await preview({ ...draft, startLocal: 'unknown', endLocal: null });
  assert.equal(result.status, 'clarify');
  assert.deepEqual(result.participantAgentIds, ['host', 'a']);
  assert.equal(result.durationMinutes, 30);
  assert.equal(result.window, null);
  const withoutDuration = await preview({ ...draft, durationMinutes: -1 });
  assert.equal(withoutDuration.status, 'clarify');
  assert.equal(withoutDuration.durationMinutes, null);
  assert.deepEqual(withoutDuration.window, (await preview(draft)).window);
});
test('an editable date suggestion can exceed the scheduling window limit', async () => {
  const result = await preview({ ...draft, endLocal: '2026-11-14T14:00' });
  assert.equal(result.status, 'ready');
  assert.equal(result.window?.end, '2026-11-14T11:00:00.000Z');
});
test('a nonexistent local clock time at spring-forward cannot become a valid proposal', async () => {
  const result = await preview({ ...draft, startLocal: '2027-03-28T02:30', endLocal: '2027-03-28T04:30' }, [ada], 'Europe/Berlin');
  assert.equal(result.status, 'clarify');
  assert.equal(result.window, null);
  assert.deepEqual(result.participantAgentIds, ['host', 'a']);
});

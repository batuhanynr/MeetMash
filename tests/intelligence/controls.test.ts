import assert from 'node:assert/strict';
import test from 'node:test';
import { previewMeeting } from '../../apps/hub/src/intelligence/intent.ts';
import { SemanticDirectory } from '../../apps/hub/src/intelligence/discovery.ts';
import type { Profile } from '../../apps/hub/src/directory.ts';

const ada: Profile = { agentId: 'a', displayName: 'Ada', visibility: 'public', capabilities: ['scheduling'] };
const request = 'Ada ile yarın 12:00-14:00 arası 30 dakika görüşelim.';
const draft = { names: ['Ada'], startLocal: '2026-11-10T12:00', endLocal: '2026-11-10T14:00', durationMinutes: 30, preferences: [], questions: [] };
const preview = (value: unknown, profiles = [ada], zone = 'Europe/Istanbul') =>
  previewMeeting({ extract: async () => value }, async () => profiles, 'host', request, zone, new Date('2026-11-09T06:00Z'));

test('model draft resolves visible unique names and local times into a preview', async () => {
  const result = await preview(draft);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.participantAgentIds, ['host','a']);
  assert.deepEqual(result.window, { start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T11:00:00.000Z' });
});
test('unknown names, ambiguous profiles, invalid windows and model-supplied IDs require clarification', async () => {
  for (const value of [{ ...draft, names: ['a'] }, { ...draft, participantAgentIds: ['someone'] },
    { ...draft, endLocal: draft.startLocal }, { ...draft, durationMinutes: -1 }]) {
    assert.equal((await preview(value)).status, 'clarify');
  }
  assert.equal((await preview(draft, [])).status, 'clarify');
  assert.equal((await preview(draft, [ada, { ...ada, agentId: 'a2' }])).status, 'clarify');
});
test('a nonexistent local clock time at spring-forward cannot become a valid proposal', async () => {
  assert.equal((await preview({ ...draft, startLocal: '2027-03-28T02:30', endLocal: '2027-03-28T04:30' }, [ada], 'Europe/Berlin')).status, 'clarify');
});
test('only authorized capabilities reach the model and a visibility change during inference removes the result', async () => {
  const inputs: string[] = [];
  let profiles = [ada];
  const service = new SemanticDirectory({ embed: async strings => { inputs.push(...strings); if (strings.includes('query')) profiles = []; return strings.map(() => [1,0]); } }, async () => profiles);
  assert.deepEqual(await service.search('viewer','query'), []);
  assert.deepEqual(inputs, ['scheduling','query']);
  assert.deepEqual(await service.search('viewer','query'), []);
  assert.deepEqual(inputs, ['scheduling','query']);
});
test('capability changes recompute embeddings and cached vectors do not bypass new permissions', async () => {
  let profiles = [ada]; const sent: string[] = [];
  const service = new SemanticDirectory({ embed: async values => { sent.push(...values); return values.map(() => [1]); } }, async () => profiles);
  assert.equal((await service.search('viewer','first')).length,1);
  profiles = [{ ...ada, capabilities: ['translation'] }];
  assert.equal((await service.search('viewer','second'))[0]?.capabilities[0], 'translation');
  profiles = [];
  assert.deepEqual(await service.search('viewer','third'), []);
  assert.deepEqual(sent, ['scheduling','first','translation','second']);
});

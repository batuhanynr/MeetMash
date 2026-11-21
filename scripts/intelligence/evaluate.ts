import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { previewMeeting, PROMPT_VERSION } from '../../apps/hub/src/intelligence/intent.ts';
import { SemanticDirectory } from '../../apps/hub/src/intelligence/discovery.ts';
import { Ollama } from '../../apps/hub/src/intelligence/ollama.ts';
import type { Profile } from '../../apps/hub/src/directory.ts';
import type { Slot } from '../../packages/protocol/src/index.ts';

type IntentFixture = { version: string; reference: string; timeZone: string; profiles: [string, string][];
  cases: ([string, string] | [string, string, string[], number, string, string])[] };
type RetrievalFixture = { version: string; profiles: [string, string][]; queries: [string, string][] };
const mode = process.argv[2];
if (!['intent', 'retrieval'].includes(mode ?? '')) throw new Error('Choose intent or retrieval');
const dir = resolve(process.env.M5_AI_EVIDENCE_DIR ?? '.state/evidence/m5-ai');
mkdirSync(dir, { recursive: true });
const model = new Ollama();
const file = readFileSync(`packages/intelligence/fixtures/${mode}.json`);
const models = await fetch(new URL('/api/tags', model.origin), { signal: AbortSignal.timeout(5000) }).then(r => r.json()) as { models: { name: string; digest: string }[] };
const name = mode === 'intent' ? model.chatModel : model.embeddingModel;
const provider = models.models.find(m => m.name === name || m.name === name + ':latest');
if (!provider) throw new Error(`Pull the local model ${name} before running the evaluation`);
const meta = { provider: 'ollama', model: provider, timestamp: new Date().toISOString(), fixtureSha256: createHash('sha256').update(file).digest('hex'),
  sourceCommit: execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain', '--', 'apps/hub/src/intelligence', 'scripts/intelligence', 'packages/intelligence'], { encoding:'utf8' }).trim() };
const profile = (id: string, name: string, capabilities: string[] = []): Profile => ({ agentId: id, displayName: name, capabilities, visibility: 'public' });
let passed: boolean;
let report: object;
if (mode === 'intent') {
  const fixture = JSON.parse(file.toString()) as IntentFixture;
  const profiles = fixture.profiles.map(([id, name]) => profile(id, name));
  const cases: { group: string; input: string; actual: Awaited<ReturnType<typeof previewMeeting>>; expected: unknown; pass: boolean }[] = [];
  for (const item of fixture.cases) {
    const [group, text] = item;
    const actual = await previewMeeting(model, async name => profiles.filter(p => p.displayName.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')),
      'host', text, fixture.timeZone, new Date(fixture.reference));
    let expected: { participants: string[]; durationMinutes: number; window: Slot } | undefined;
    let pass = actual.status === 'clarify' && actual.questions.length > 0;
    if (item.length === 6) {
      const [, , participants, durationMinutes, begin, finish] = item;
      const utc = (v: string) => new Date('2026-11-' + v.replace(' ', 'T') + ':00+03:00').toISOString();
      expected = { participants: ['host', ...participants].sort(), durationMinutes, window: { start: utc(begin), end: utc(finish) } };
      pass = actual.status === 'ready' && actual.durationMinutes === durationMinutes && actual.window?.start === expected.window.start
        && actual.window?.end === expected.window.end && JSON.stringify(actual.participantAgentIds.toSorted()) === JSON.stringify(expected.participants);
    }
    cases.push({ group, input: text, expected, actual, pass });
    console.log(`${cases.length}/20 ${group} ${pass ? 'PASS' : 'FAIL'}`);
  }
  const score = Object.fromEntries(['clear','ambiguous','restricted'].map(group => [group, cases.filter(c => c.group === group && c.pass).length]));
  passed = score.clear! >= 11 && score.ambiguous === 4 && score.restricted === 4;
  report = { ...meta, promptVersion: PROMPT_VERSION, reference: fixture.reference, timeZone: fixture.timeZone, score, passed, cases };
} else {
  const fixture = JSON.parse(file.toString()) as RetrievalFixture;
  const profiles = fixture.profiles.map(([id, description]) => profile(id, 'Agent ' + id, [description]));
  assert.ok(profiles.length >= 30 && fixture.queries.length === 15);
  const directory = new SemanticDirectory(model, async () => profiles);
  const cases = [];
  for (const [query, target] of fixture.queries) {
    const results = (await directory.search('viewer', query)).map(p => p.agentId);
    cases.push({ query, target, results, hit: results.includes(target) });
  }
  const hits = cases.filter(c => c.hit).length;
  passed = hits >= 12;
  report = { ...meta, fixtureVersion: fixture.version, profileCount: profiles.length, queryCount: cases.length, hits, hitAt3: hits / cases.length, passed, cases };
}
writeFileSync(join(dir, mode + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${mode}: ${passed ? 'PASS' : 'FAIL'}, ${dir}`);
if (!passed) process.exitCode = 1;

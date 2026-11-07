import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runM1Scenarios } from '../../scripts/lib/m1-scenarios.ts';

test('M1 real-network gate: independent processes, routing, durability, and faults', { timeout: 90_000 }, async context => {
  const report = await runM1Scenarios(result => context.diagnostic(`${result.id}: ${result.status}${result.error ? ` - ${result.error}` : ''}`), process.env.M1_EVIDENCE_DIR);
  assert.equal(report.status, 'passed', JSON.stringify(report.results.filter(result => result.status !== 'passed')));
});

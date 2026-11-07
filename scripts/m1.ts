import { resolve } from 'node:path';
import { options } from '../packages/runtime/src/config.ts';
import { runM1Scenarios } from './lib/m1-scenarios.ts';

const args = options(['evidence-dir']);
console.log('M1 scripted protocol demo: real WebSocket processes, synthetic messages; no meeting algorithm, calendar, or AI.');
const directory = resolve(args['evidence-dir'] ?? '.state/evidence/demo-m1');
const report = await runM1Scenarios(result => {
  console.log(`[${result.status === 'passed' ? 'PASS' : 'FAIL'}] ${result.id}: ${result.description}${result.error ? ` (${result.error})` : ''}`);
}, directory);
console.log(`Evidence: ${directory}`);
if (report.status !== 'passed') process.exitCode = 1;

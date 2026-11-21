import { resolve } from 'node:path';
import { options } from '../packages/runtime/src/config.ts';
import { runM2Scenarios } from './lib/m2-scenarios.ts';

const args = options(['evidence-dir']);
console.log('M2 demo: real wss hub + authenticated agents. Directory discovery, durable offline queue across a hub restart, signed messages.');
const directory = resolve(args['evidence-dir'] ?? '.state/evidence/demo-m2');
const report = await runM2Scenarios(result => {
  console.log(`[${result.status === 'passed' ? 'PASS' : 'FAIL'}] ${result.id}: ${result.description}${result.error ? ` (${result.error})` : ''}`);
}, directory);
console.log(`Evidence: ${directory}`);
if (report.status !== 'passed') process.exitCode = 1;

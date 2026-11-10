import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runM2Scenarios } from './lib/m2-scenarios.ts';

const directory = resolve(process.env.M2_EVIDENCE_DIR ?? '.state/evidence/m2');
mkdirSync(directory, { recursive: true });
const checks: Record<string, unknown>[] = [];
let ok = true;
for (const script of ['check', 'build', 'test', 'test:hub']) {
  const started = Date.now();
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', env: process.env });
  checks.push({ command: `npm run ${script}`, exitCode: result.status, signal: result.signal, durationMs: Date.now() - started });
  if (result.status !== 0) { ok = false; break; }
}
let scenarios = 'skipped';
if (ok) {
  const report = await runM2Scenarios(result => console.log(`[${result.status === 'passed' ? 'PASS' : 'FAIL'}] ${result.id}: ${result.description}${result.error ? ` (${result.error})` : ''}`), directory);
  scenarios = report.status;
  if (report.status !== 'passed') ok = false;
}
writeFileSync(join(directory, 'checks.json'), JSON.stringify({
  codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), status: ok ? 'passed' : 'failed', checks, scenarios,
}, null, 2) + '\n');
console.log(`M2 gate evidence: ${directory}`);
if (!ok) process.exitCode = 1;

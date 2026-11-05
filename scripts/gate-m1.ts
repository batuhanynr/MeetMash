import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.M1_EVIDENCE_DIR ?? '.state/evidence/m1');
mkdirSync(directory, { recursive: true });
for (const filename of ['summary.json', 'events.jsonl', 'checks.json']) rmSync(join(directory, filename), { force: true });
const checks = [];
for (const script of ['check', 'build', 'test']) {
  const started = Date.now();
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit', env: { ...process.env, M1_EVIDENCE_DIR: directory },
  });
  checks.push({ command: `npm run ${script}`, exitCode: result.status, signal: result.signal, error: result.error?.message, durationMs: Date.now() - started });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
writeFileSync(join(directory, 'checks.json'), JSON.stringify({
  codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), status: process.exitCode ? 'failed' : 'passed', checks,
}, null, 2) + '\n');
console.log(`M1 gate evidence: ${directory}`);

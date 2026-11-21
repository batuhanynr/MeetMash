import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import profiles from './profiles.json' with { type: 'json' };
import { Lab, build } from './lab.mjs';
import { run } from './scenario.mjs';
import { report } from './report.mjs';

const { values } = parseArgs({
  options: {
    profiles: { type: 'string' },
    count: { type: 'string' },
    jobs: { type: 'string', default: '1' },
    out: { type: 'string' },
    demo: { type: 'boolean', default: false },
    'reuse-image': { type: 'string' },
  },
});
const demo = values.demo;
const requested = values.profiles?.split(',') ?? (demo ? ['N0', 'N3', 'N4-ack', 'N5'] : profiles.map((p) => p.id));
const configs = requested.map((id) => {
  const p = profiles.find((c) => c.id === id);
  if (!p) throw new Error('Unknown profile ' + id);
  const count = Number(values.count ?? (demo ? 1 : p.count));
  if (!Number.isInteger(count) || count < 1 || count > p.count) throw new Error('Invalid repeat count');
  return { ...p, count, required: Math.ceil((p.required / p.count) * count) };
});
const jobs = Number(values.jobs);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8) throw new Error('jobs must be 1..8');
const directory = resolve(values.out ?? join('.state/evidence/m4', randomUUID()));
mkdirSync(directory, { recursive: true });
const raw = join(directory, 'runs.jsonl');
writeFileSync(raw, '', { flag: 'wx' }); // never overwrite previous measurements
const image = values['reuse-image'] ?? 'meetmesh-m4:local';
if (!values['reuse-image']) build(image);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const meta = {
  environment: 'Docker Linux',
  commit: git('rev-parse', 'HEAD'),
  worktreeDirty: !!git('status', '--porcelain'),
  imageId: execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim(),
  jobs,
};
writeFileSync(join(directory, 'config.json'), JSON.stringify({ ...meta, configs }, null, 2) + '\n');
const work = configs.flatMap((config) =>
  Array.from({ length: config.count }, (_, i) => ({ config, index: i + 1 })),
);
async function worker() {
  const lab = new Lab(image);
  try {
    const environment = await lab.open();
    while (work.length) {
      const { config, index } = work.shift();
      const row = await run(lab, config, { ...meta, ...environment }, index);
      appendFileSync(raw, JSON.stringify(row) + '\n');
      console.log(
        row.pass ? 'PASS' : 'FAIL',
        config.id,
        index,
        row.status ?? '',
        row.elapsedMs?.toFixed(0) ?? '',
        row.eventCounts ?? '',
        row.error ?? '',
      );
    }
  } finally {
    await lab.close();
  }
}
const results = await Promise.allSettled(Array.from({ length: Math.min(work.length, jobs) }, worker));
const summary = report(directory, configs);
console.table(summary);
console.log(directory);
for (const result of results) if (result.status === 'rejected') console.error(result.reason);
if (summary.some((s) => s.status !== 'PASS') || results.some((r) => r.status === 'rejected')) process.exitCode = 1;

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import profiles from './profiles.json' with { type: 'json' };

export function summarize(rows, expected = profiles) {
  return expected.map((config) => {
    const runs = rows.filter((r) => r.profileId === config.id);
    const ok = runs.filter((r) => r.pass);
    const times = ok.map((r) => r.elapsedMs).sort((a, b) => a - b);
    const mid = Math.floor(times.length / 2);
    return {
      profileId: config.id,
      planned: config.count,
      runs: runs.length,
      pass: ok.length,
      successRate: runs.length ? ok.length / runs.length : null,
      timeouts: runs.filter((r) => r.timedOut).length,
      medianMs: times.length ? (times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2) : null,
      p95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
      status:
        runs.length !== config.count
          ? 'INCOMPLETE'
          : ok.length >= config.required && !runs.some((r) => r.critical)
            ? 'PASS'
            : 'FAIL',
    };
  });
}
export function report(directory, expected) {
  const rows = readFileSync(join(directory, 'runs.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const summary = summarize(rows, expected);
  const columns = [
    'profileId',
    'runId',
    'commit',
    'status',
    'pass',
    'critical',
    'timedOut',
    'elapsedMs',
    'recoveryMs',
    'messageCount',
    'retries',
    'duplicates',
    'eventCounts',
    'error',
  ];
  const cell = (v) =>
    '"' + String(typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '')).replaceAll('"', '""') + '"';
  writeFileSync(
    join(directory, 'results.csv'),
    [columns.join(','), ...rows.map((row) => columns.map((key) => cell(row[key])).join(','))].join('\n') + '\n',
  );
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.table(report(process.argv[2] ?? '.state/evidence/m4'));

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { waitFor } from '../../scripts/lib/processes.ts';

test('local launcher stops all processes cleanly and refuses live data reset', { timeout: 20_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'meetmesh-local-'));
  const env = { ...process.env, HUB_PORT: '0', STATE_ROOT: root };
  const child = spawn(process.execPath, ['scripts/local.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { errors += data.toString(); });
  try {
    await waitFor(() => output, value => value.includes('Local hub + A/B/C ready'), `local launcher (${errors})`);
    const pids = output.split('\n').flatMap(line => {
      try {
        const record = JSON.parse(line) as { event?: string; pid?: number };
        return record.event?.endsWith('.ready') && record.pid ? [record.pid] : [];
      } catch { return []; }
    });
    assert.equal(new Set(pids).size, 4);
    const blocked = spawnSync(process.execPath, ['scripts/reset-local.ts'], { env, encoding: 'utf8' });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Another process owns/);
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code] = await exited;
    assert.equal(code, 0, errors);
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const reset = spawnSync(process.execPath, ['scripts/reset-local.ts'], { env, encoding: 'utf8' });
    assert.equal(reset.status, 0, reset.stderr);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

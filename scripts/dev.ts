import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const host = process.env.MEETMESH_DATA_HOST;
const port = process.env.HUB_PORT ?? '8792';
if (!host || !process.env.DATABASE_URL || !process.env.MEETMESH_ACCOUNTS_FILE) {
  throw new Error('.env içinde MEETMESH_DATA_HOST, DATABASE_URL ve MEETMESH_ACCOUNTS_FILE gerekli.');
}
const root = process.env.MEETMESH_MOCK_STATE ?? '.state/m5-calendars/mock-agents';
const logPath = process.env.MEETMESH_PANEL_LOG ?? '.state/m5-calendars/service.log';
mkdirSync('.state/m5-calendars', { recursive: true });
const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
const children: ChildProcess[] = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  log.end();
  process.exitCode = code;
}
function start(name: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout!.on('data', chunk => { process.stdout.write(chunk); if (name === 'hub') log.write(chunk); });
  child.stderr!.pipe(process.stderr);
  child.on('error', error => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${name} durdu (${code ?? 'sinyal'}).`); stop(1); } });
  return child;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const hub = start('hub', ['apps/hub/src/m2-main.ts']);
let pending = '';
hub.stdout!.on('data', chunk => {
  pending += chunk.toString();
  const lines = pending.split('\n');
  pending = lines.pop()!;
  for (const line of lines) {
    let event: { event?: string };
    try { event = JSON.parse(line); } catch { continue; }
    if (event.event !== 'hub.ready') continue;
    start('panel', ['scripts/calendar-panel.ts'], { MEETMESH_PANEL_HUB: `https://${host}:${port}`, MEETMESH_PANEL_LOG: logPath });
    for (const id of ['ferhat', 'elif']) {
      start(id, ['apps/agent-node/src/m2-main.ts', '--id', id, '--hub', `wss://${host}:${port}`,
        '--state-root', root, '--secrets', join(root, id, 'secrets.json'), '--calendar-file', join(root, id, 'calendar.json')]);
    }
  }
});

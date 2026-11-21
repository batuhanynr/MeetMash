import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const ids = ['agent-a', 'agent-b', 'agent-c'];
const nodes = ['hub', ...ids];
const composeFile = 'infra/network/compose.yaml';
const token = () => randomBytes(24).toString('hex');
const ownedLabs = new Set();
let stopping = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    const results = await Promise.allSettled([...ownedLabs].map((lab) => lab.close()));
    for (const result of results) if (result.status === 'rejected') console.error(result.reason);
    process.exit(code);
  });
}
export function build(image) {
  execFileSync('docker', ['build', '-f', 'infra/network/Dockerfile', '-t', image, '.'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}
class Control {
  constructor(id, container, env, record) {
    this.pending = new Map();
    this.seq = 0;
    this.process = spawn(
      'docker',
      [
        'exec',
        '-i',
        ...(id === 'hub' ? ['--env', 'DATABASE_URL'] : []),
        container,
        'node',
        'infra/network/driver.mjs',
        id,
      ],
      { env, stdio: ['pipe', 'pipe', 'inherit'] },
    );
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      if ('record' in msg) record(id, msg.record);
      else this.pending.get(msg.seq)?.(msg);
    });
    this.process.once('exit', () => {
      for (const finish of this.pending.values()) finish({ error: 'control process exited' });
    });
  }
  call(action, fields = {}) {
    if (this.process.exitCode !== null || this.process.signalCode !== null) throw new Error('driver stopped');
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(action + ' timed out'));
      }, 25000);
      this.pending.set(seq, (msg) => {
        clearTimeout(timer);
        this.pending.delete(seq);
        msg.error ? reject(new Error(msg.error)) : resolve(msg.value);
      });
      this.process.stdin.write(JSON.stringify({ seq, action, ...fields }) + '\n');
    });
  }
}
export class Lab {
  constructor(image, dartAgent) {
    this.dartAgent = dartAgent;
    this.project = 'meetmesh-m4-' + randomUUID();
    this.records = [];
    this.temp = mkdtempSync(join(tmpdir(), 'meetmesh-m4-'));
    this.env = { ...process.env, M4_DB_PASSWORD: token(), M4_IMAGE: image };
    this.controls = {};
    this.containers = {};
    ownedLabs.add(this);
  }
  compose(args) {
    return execFileSync('docker', ['compose', '-f', composeFile, '-p', this.project, ...args], {
      encoding: 'utf8',
      env: this.env,
    });
  }
  async open() {
    if (stopping || this.closing) throw new Error('Network experiment interrupted');
    this.startup = spawn('docker', ['compose', '-f', composeFile, '-p', this.project, 'up', '-d', '--wait'], {
      env: this.env, stdio: ['ignore', 'inherit', 'inherit'],
    });
    this.started = new Promise((resolve, reject) => {
      this.startup.once('error', reject);
      this.startup.once('close', (code) => code === 0 ? resolve() : reject(new Error('Compose startup failed')));
    });
    await this.started;
    if (stopping || this.closing) throw new Error('Network experiment interrupted');
    const certDir = join(this.temp, 'certs');
    execFileSync(process.execPath, ['scripts/dev-certs.ts'], {
      env: { ...this.env, CERT_DIR: certDir },
      stdio: 'ignore',
    });
    const keys = {},
      bootstrap = {};
    for (const id of ids) {
      bootstrap[id] = token();
      for (const peer of ids.slice(ids.indexOf(id) + 1)) keys[[id, peer].join(':')] = token();
    }
    for (const id of nodes) {
      const cid = this.compose(['ps', '-q', id]).trim();
      this.containers[id] = cid;
      const folder = join(this.temp, id);
      mkdirSync(join(folder, 'certs'), { recursive: true });
      const cp = (src, dst) => execFileSync('cp', [src, dst]);
      for (const file of id === 'hub' ? ['hub.key', 'hub.crt'] : ['ca.crt'])
        cp(join(certDir, file), join(folder, 'certs', file));
      if (id !== 'hub')
        writeFileSync(
          join(folder, 'secrets.json'),
          JSON.stringify({
            bootstrap: { [id]: bootstrap[id] },
            pairKeys: Object.fromEntries(Object.entries(keys).filter(([pair]) => pair.split(':').includes(id))),
          }),
          { mode: 0o600 },
        );
      execFileSync('docker', ['cp', folder + '/.', cid + ':/state/']);
      if (this.dartAgent && id === 'agent-c')
        execFileSync('docker', ['cp', this.dartAgent, cid + ':/state/dart-agent']);
      this.controls[id] = new Control(
        id,
        cid,
        { ...this.env, DATABASE_URL: 'postgresql://lab:' + this.env.M4_DB_PASSWORD + '@database/lab' },
        (node, row) => this.records.push({ node, ...row }),
      );
    }
    await this.call('hub', 'provision', { bootstrap });
    return this.call('hub', 'info');
  }
  call(id, action, fields) {
    return this.controls[id].call(action, fields);
  }
  cmd(id, command) {
    return this.call(id, 'command', { command });
  }
  async profile(profile) {
    const results = await Promise.all(nodes.map(async (id) => [id, await this.call(id, 'profile', { profile })]));
    return Object.fromEntries(results);
  }
  async start(runId, faults = {}, offline = []) {
    this.records.length = 0;
    this.runId = runId;
    await this.call('hub', 'clear');
    await this.call('hub', 'start', { runId, fault: faults.hub });
    await Promise.all(ids.filter((id) => !offline.includes(id)).map((id) => this.startAgent(id, faults[id])));
  }
  startAgent(id, fault) {
    return this.call(id, 'start', { runId: this.runId, fault });
  }
  stopAll() {
    return Promise.allSettled(Object.keys(this.controls).map((id) => this.call(id, 'stop')));
  }
  close() {
    return this.closing ??= this.removeProject();
  }
  async removeProject() {
    if (this.startup && this.startup.exitCode === null && this.startup.signalCode === null) this.startup.kill('SIGTERM');
    await this.started?.catch(() => {});
    for (const controller of Object.values(this.controls)) controller.process.stdin.end();
    try {
      // Removing this project's containers also releases their network namespaces and qdiscs.
      this.compose(['down', '--timeout', '1', '-v']);
      ownedLabs.delete(this);
    } catch (cause) {
      throw new Error('Could not remove lab project ' + this.project, { cause });
    } finally {
      rmSync(this.temp, { recursive: true, force: true });
    }
  }
}

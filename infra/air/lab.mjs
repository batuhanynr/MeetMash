import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as wait } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import fixture from '../../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };

const agents = ['agent-a', 'agent-b', 'agent-c'];
const roles = ['hub', ...agents];
const { positionals: [action], values } = parseArgs({
  allowPositionals: true,
  options: { inventory: { type: 'string' }, archive: { type: 'string' }, apply: { type: 'boolean' } },
});
if (!['inspect', 'deploy', 'verify'].includes(action) || !values.inventory) {
  throw new Error('Usage: node infra/air/lab.mjs inspect|deploy|verify --inventory PATH [--archive TAR] [--apply]');
}
const config = JSON.parse(readFileSync(values.inventory, 'utf8'));
assert.match(config.lab, /^[a-z0-9][a-z0-9-]{0,31}$/);
assert.match(config.revision, /^[0-9a-f]{40}$/);
assert.match(config.appImage, /^[a-zA-Z0-9][a-zA-Z0-9/._:-]{0,199}$/);
for (const role of roles) assert.match(config.targets[role], /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
assert.equal(new Set(roles.map((role) => config.targets[role])).size, roles.length, 'Use four distinct OOB aliases');
if (!values.apply) {
  console.log(JSON.stringify({ action, revision: config.revision, lab: config.lab, roles, transferArchive: !!values.archive }));
  process.exit(0);
}
assert.equal(
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  config.revision,
  'Use the checkout that was built for the lab',
);
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }), '', 'Use a clean checkout');

process.umask(0o077);
const name = 'meetmesh-air-' + config.lab;
const database = name + '-pg';
const state = resolve('.state/air', config.lab);
const prepare = readFileSync(new URL('./prepare-node.sh', import.meta.url));
const quote = (arg) => "'" + arg.replaceAll("'", "'\"'\"'") + "'";
const sshArgs = (role, args) => [
  '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
  '--', config.targets[role], args.map(quote).join(' '),
];
const ssh = (role, args, input) => execFileSync('ssh', sshArgs(role, args), {
  encoding: 'utf8', input, timeout: 45000,
});
const docker = (role, args, input) => ssh(role, ['sudo', '-n', 'docker', ...args], input);
const verifyRoute = (role, phase) => ssh(role, [
  'sh', '-c', 'exec sudo -n sh -s -- "$@" "${SSH_CONNECTION%% *}"', 'sh',
  phase, role, config.lab, config.appImage, config.revision,
], prepare);
const writeSecret = (role, path, bytes) => docker(role, [
  'exec', '-i', name, 'sh', '-c',
  'umask 077; mkdir -p "$(dirname "$1")"; cat > "$1.tmp" && mv "$1.tmp" "$1"',
  'sh', path,
], bytes);
const randomSecret = () => randomBytes(24).toString('hex');

let cancelled;
process.once('SIGINT', () => { cancelled = 'SIGINT'; });
process.once('SIGTERM', () => { cancelled = 'SIGTERM'; });
async function until(read, accept, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    if (cancelled) throw new Error(cancelled);
    const value = await read();
    if (accept(value)) return value;
    await wait(125);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + description);
}

if (action === 'inspect') {
  for (const role of roles) console.log(role + '\n' + verifyRoute(role, 'inspect'));
} else if (action === 'deploy') {
  for (const role of roles) verifyRoute(role, 'inspect');
  if (values.archive) {
    for (const role of roles) {
      if (cancelled) throw new Error(cancelled);
      const fd = openSync(values.archive, 'r');
      try {
        execFileSync('ssh', sshArgs(role, ['sudo', '-n', 'docker', 'load']), {
          stdio: [fd, 'ignore', 'inherit'], timeout: 600000,
        });
      } finally { closeSync(fd); }
    }
  }
  mkdirSync(state, { recursive: true });
  const credsFile = join(state, 'credentials.json');
  if (!existsSync(credsFile)) {
    const bootstrap = Object.fromEntries(agents.map((id) => [id, randomSecret()]));
    const keys = {};
    for (const [i, id] of agents.entries()) for (const peer of agents.slice(i + 1)) keys[id + ':' + peer] = randomSecret();
    writeFileSync(credsFile, JSON.stringify({ bootstrap, keys, password: randomSecret() }), { flag: 'wx', mode: 0o600 });
  }
  const { bootstrap, keys, password } = JSON.parse(readFileSync(credsFile, 'utf8'));
  const certs = join(state, 'certs');
  execFileSync(process.execPath, ['scripts/dev-certs.ts'], {
    env: { ...process.env, CERT_DIR: certs, CERT_FORCE: '', CERT_EXTRA_HOST: '' },
    stdio: 'ignore',
  });
  for (const role of roles) {
    if (cancelled) throw new Error(cancelled);
    verifyRoute(role, 'deploy');
    const files = role === 'hub' ? ['hub.key', 'hub.crt', 'ca.crt'] : ['ca.crt'];
    for (const file of files) writeSecret(role, '/state/certs/' + file, readFileSync(join(certs, file)));
    if (role !== 'hub') writeSecret(role, '/state/secrets.json', JSON.stringify({
      bootstrap: { [role]: bootstrap[role] },
      pairKeys: Object.fromEntries(Object.entries(keys).filter(([pair]) => pair.split(':').includes(role))),
    }));
  }

  const port = '55436';
  const owner = docker('hub', ['ps', '-a', '--filter', 'name=^/' + database + '$', '--format', '{{.Names}}']).trim();
  if (!owner) {
    docker('hub', ['run', '--rm', '-i', '--network', 'none', '--volume', database + '-secret:/config',
      config.appImage, 'sh', '-c', 'umask 077; cat > /config/password'], password);
    docker('hub', ['create', '--name', database, '--network', 'host', '--label', 'org.meetmesh.air.database=' + config.lab,
      '--env', 'POSTGRES_USER=meetmesh_air', '--env', 'POSTGRES_DB=meetmesh_air',
      '--env', 'POSTGRES_PASSWORD_FILE=/config/password', '--volume', database + '-secret:/config:ro',
      '--volume', database + '-data:/var/lib/postgresql/data', 'postgres:16-alpine',
      '-p', port, '-c', 'listen_addresses=127.0.0.1']);
  } else {
    assert.equal(
      docker('hub', ['inspect', '--format', '{{index .Config.Labels "org.meetmesh.air.database"}}', database]).trim(),
      config.lab,
      'Existing database container belongs to another deployment',
    );
  }
  const url = 'postgresql://meetmesh_air:' + password + '@127.0.0.1:' + port + '/meetmesh_air';
  writeSecret('hub', '/state/database-url', url);
  docker('hub', ['start', database]);
  await until(() => {
    try { return docker('hub', ['exec', database, 'pg_isready', '-p', port]); }
    catch { return ''; }
  }, (result) => result.includes('accepting connections'), 'the loopback database', 30000);
  const driver = 'DATABASE_URL=$(cat /state/database-url); export DATABASE_URL; exec node infra/network/driver.mjs hub';
  const response = docker('hub', ['exec', '-i', name, 'sh', '-c', driver], JSON.stringify({
    seq: 1, action: 'provision', bootstrap,
  }) + '\n');
  const provisioned = response.trim().split('\n').filter(Boolean).map(JSON.parse).find((row) => row.seq === 1);
  if (!provisioned || provisioned.error) {
    throw new Error('Hub bootstrap provisioning failed');
  }
  console.log('Prepared', config.lab, config.revision);
} else {
  await verify();
}

function connect(role, record) {
  const driver = role === 'hub'
    ? ['sh', '-c', 'DATABASE_URL=$(cat /state/database-url); export DATABASE_URL; exec node infra/network/driver.mjs hub']
    : ['node', 'infra/network/driver.mjs', role];
  const child = spawn('ssh', sshArgs(role, ['sudo', '-n', 'docker', 'exec', '-i', name, ...driver]), {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let seq = 0;
  let dead = false;
  const done = new Promise((resolveDone) => {
    const close = () => {
      dead = true;
      for (const finish of pending.values()) finish({ error: 'SSH driver closed on ' + role });
      resolveDone();
    };
    child.once('error', close);
    child.once('close', close);
    child.stdin.on('error', close);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let row;
    try { row = JSON.parse(line); } catch { return; }
    if (row.record) record(role, row.record);
    else pending.get(row.seq)?.(row);
  });
  return {
    call(action, fields = {}) {
      if (dead) return Promise.reject(new Error(role + ' driver closed'));
      const id = ++seq;
      return new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCall(new Error(role + ' ' + action + ' timed out'));
        }, 22000);
        pending.set(id, (row) => {
          clearTimeout(timer);
          pending.delete(id);
          row.error ? rejectCall(new Error(row.error)) : resolveCall(row.value);
        });
        child.stdin.write(JSON.stringify({ seq: id, action, ...fields }) + '\n');
      });
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGTERM'), 5000);
      try { await done; } finally { clearTimeout(timer); }
    },
  };
}

async function verify() {
  const path = resolve('.state/evidence/air', config.lab, randomUUID());
  mkdirSync(path, { recursive: true });
  const log = join(path, 'events.jsonl');
  const evidence = { lab: config.lab, environment: 'NVIDIA Air (operator-provisioned)', revision: config.revision,
    timestamp: new Date().toISOString(), nodes: {}, runs: [] };
  const controls = {};
  const call = (role, action, fields) => controls[role].call(action, fields);
  const cmd = (role, command) => call(role, 'command', { command });
  const stop = () => Promise.allSettled(Object.keys(controls).map((role) => call(role, 'stop')));
  let cut;
  const restore = () => cut === 'netem' ? call('agent-c', 'profile', { profile: 'reset' }) : verifyRoute('agent-c', 'restore-data');
  try {
    for (const role of roles) {
      const host = verifyRoute(role, 'inspect');
      const imageId = docker(role, ['inspect', '--format', '{{.Image}}', name]).trim();
      const revision = docker(role, ['image', 'inspect', '--format',
        '{{index .Config.Labels "org.opencontainers.image.revision"}}', imageId]).trim();
      assert.equal(revision, config.revision, role + ' image revision');
      controls[role] = connect(role, (node, record) => {
        appendFileSync(log, JSON.stringify({ node, ...record }) + '\n');
      });
      const runtime = await call(role, 'info');
      const route = await call(role, 'profile', { profile: 'show' });
      assert.match(route, /\bdev eth1\b/, role + ' WSS route');
      evidence.nodes[role] = { host, imageId, runtime, route, netemReady: /\bnoqueue 0:/.test(route) };
    }
    assert.equal(new Set(roles.map((role) => evidence.nodes[role].imageId)).size, 1, 'Use the same image on all nodes');
    for (const profile of ['normal', 'data-cut']) {
      const runId = randomUUID();
      const meetingId = 'air-' + runId;
      const run = { runId, meetingId, profile, outcome: 'incomplete' };
      evidence.runs.push(run);
      for (const role of roles) await call(role, 'start', { runId });
      try {
        assert.equal(await call('agent-c', 'health'), true);
        if (profile === 'data-cut') {
          cut = evidence.nodes['agent-c'].netemReady ? 'netem' : 'link-down';
          run.cutMethod = cut;
          run.applied = cut === 'netem'
            ? await call('agent-c', 'profile', { profile: 'cut' })
            : verifyRoute('agent-c', 'cut-data');
          await assert.rejects(call('agent-c', 'health'), /data path timed out|ENETUNREACH|EHOSTUNREACH/);
          run.managementResponded = Boolean(await call('agent-c', 'info'));
          assert(run.managementResponded);
          if (cut === 'netem') {
            run.counters = await call('agent-c', 'profile', { profile: 'show' });
            assert.match(run.counters, /netem 4d4d:.*loss 100%/);
          }
        }
        await cmd('agent-a', {
          command: 'schedule',
          meetingId,
          participantAgentIds: agents,
          window: fixture.window,
          durationMinutes: fixture.durationMinutes,
        });
        const view = (role) => cmd(role, { command: 'meeting', meetingId }).then((result) => result.meeting);
        if (cut) {
          run.cutMail = await until(
            () => call('hub', 'mail', { meetingId }),
            (rows) => rows.some((row) => row.recipient === 'agent-c' && row.type === 'REQUEST' &&
              ['QUEUED', 'SENT'].includes(row.status)),
            'a pending offer request to isolated C',
          );
          run.beforeRestore = (await view('agent-a')).status;
          assert.notEqual(run.beforeRestore, 'CONFIRMED', 'Meeting confirmed during an isolated participant');
          run.reset = await restore();
          if (cut === 'netem') assert.match(run.reset, /\bnoqueue 0:/);
          cut = undefined;
          await until(() => call('agent-c', 'health').catch(() => false), (ok) => ok, 'restored WSS route');
        }
        const final = await until(() => view('agent-a'), (row) => row?.status === 'CONFIRMED', 'three calendar receipts', 30000);
        const peers = await Promise.all(agents.map(view));
        run.calendarCounts = peers.map((row) => row?.eventCount);
        run.selected = final.selected;
        assert.deepEqual(run.calendarCounts, [1, 1, 1]);
        assert.equal(final.selected.score, 220);
        assert.equal(Date.parse(final.selected.start), Date.parse('2026-11-10T14:00:00+03:00'));
        run.outcome = 'passed';
      } finally { await stop(); }
    }
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed';
    evidence.reason = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Air verification failed';
    throw error;
  } finally {
    try {
      if (cut) await restore();
    } finally {
      await stop();
      await Promise.allSettled(Object.values(controls).map((control) => control.close()));
      writeFileSync(join(path, 'summary.json'), JSON.stringify(evidence, null, 2) + '\n');
      console.log('Air evidence:', path);
    }
  }
}

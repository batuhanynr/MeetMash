import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const phases = ['software', 'm4-link', 'm4-round', 'm4-network', 'dart-linux', 'm5-network', 'intent', 'retrieval', 'preview'];
const { values } = parseArgs({
  options: {
    session: { type: 'string' },
    phase: { type: 'string', multiple: true },
    resume: { type: 'boolean' },
    status: { type: 'boolean' },
    list: { type: 'boolean' },
  },
});
if (values.list) {
  console.log(phases.join('\n'));
  process.exit(0);
}
if ((values.resume || values.status) && !values.session) throw new Error('Choose --session=<name>');
const name = values.session ?? 'run-' + randomUUID();
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('Use a simple session name with letters, digits, _ or -');
const selected = phases.filter((phase) => !values.phase || values.phase.includes(phase));
if (values.phase?.some((phase) => !phases.includes(phase))) throw new Error('Unknown phase. Use --list.');

const root = resolve('.state/evidence/verification');
const directory = join(root, name);
const manifestPath = join(directory, 'session.json');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function save(path, value) {
  const temporary = path + '.next';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}
function previous() {
  return readdirSync(directory)
    .filter((entry) => /^\d{6}-/.test(entry))
    .sort()
    .map((entry) => {
      const path = join(directory, entry, 'attempt.json');
      return [entry, existsSync(path) ? read(path) : { phase: entry.slice(7), status: 'running' }];
    });
}
function latest(phase) {
  return previous().findLast(([, attempt]) => attempt.phase === phase);
}
function verified(entry) {
  if (!entry) return false;
  const [folder, attempt] = entry;
  return attempt.status === 'passed' && Object.keys(attempt.artifacts).length > 0 &&
    Object.entries(attempt.artifacts).every(([file, sha256]) => {
      const path = join(directory, folder, file);
      return existsSync(path) && digest(path) === sha256;
    });
}
function show() {
  const rows = phases.map((phase) => {
    const entry = latest(phase);
    const recorded = entry?.[1].status ?? 'pending';
    const status = recorded === 'passed' && !verified(entry) ? 'evidence missing or changed'
      : recorded === 'running' ? 'unfinished' : recorded;
    return { phase, status, attempt: entry?.[0] ?? null };
  });
  console.log('Session %s on %s', name, read(manifestPath).commit);
  console.table(rows);
  console.log('Manual evidence pending outside this runner: Air, installed Android and iOS apps, two live Google test calendars.');
  return rows;
}
if ((values.status || values.resume) && !existsSync(manifestPath)) {
  throw new Error('No saved verification session named ' + name);
}
if (values.status) {
  show();
  process.exit(0);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
function requireCleanCheckout() {
  if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain')) {
    throw new Error('Use a clean checkout and keep its commit unchanged throughout the session.');
  }
}
requireCleanCheckout();

function requireTestDatabase(variable) {
  let url;
  try { url = new URL(process.env[variable]); }
  catch { throw new Error('Set ' + variable + ' to a dedicated disposable PostgreSQL database ending in _test'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.pathname.endsWith('_test') ||
      url.searchParams.has('database') || url.searchParams.has('dbname')) {
    throw new Error('Set ' + variable + ' to a dedicated disposable PostgreSQL database ending in _test');
  }
}
if (selected.includes('software')) requireTestDatabase('M3_TEST_DATABASE_URL');
if (selected.some((phase) => phase === 'software' || phase === 'preview')) requireTestDatabase('DATABASE_URL');

function step(phase, out) {
  const node = process.execPath;
  const env = {
    ...process.env,
    M1_EVIDENCE_DIR: join(out, 'm1'),
    M2_EVIDENCE_DIR: join(out, 'm2'),
    M3_EVIDENCE_DIR: join(out, 'm3'),
    M5_EVIDENCE_DIR: out,
    M5_AI_EVIDENCE_DIR: out,
  };
  // The host passes must exercise the Dart code in this checkout.
  delete env.MOBILE_AGENT_EXE;
  switch (phase) {
    case 'software':
      return { command: ['npm', 'run', 'test:gate:m5'], env, artifacts: ['m2/checks.json', 'm3/runs.json', 'mixed.json'] };
    case 'm4-link':
    case 'm4-round':
      return { command: [node, 'scripts/m4/' + (phase === 'm4-link' ? 'smoke.mjs' : 'round-smoke.mjs')], env,
        artifacts: ['smoke.log'], stdout: 'smoke.log' };
    case 'm4-network':
    case 'm5-network': {
      const command = [node, 'scripts/m4/bench.mjs', '--jobs=1', '--out', out];
      if (phase === 'm5-network') {
        const build = latest('dart-linux');
        if (!verified(build)) throw new Error('Pass the dart-linux phase in this session before the mixed network matrix.');
        command.push('--dart-agent', join(directory, build[0], 'dart-agent'));
      }
      return { command, env, artifacts: ['config.json', 'runs.jsonl', 'summary.json', 'results.csv'] };
    }
    case 'dart-linux': {
      const dockerArch = execFileSync('docker', ['info', '--format', '{{.Architecture}}'], { encoding: 'utf8', timeout: 10000 }).trim();
      const arch = { aarch64: 'arm64', arm64: 'arm64', x86_64: 'x64', amd64: 'x64' }[dockerArch];
      if (!arch) throw new Error('Unsupported Docker architecture: ' + dockerArch);
      return { command: ['sh', 'scripts/mobile-build-agent.sh', 'linux', arch, join(out, 'dart-agent')], env, artifacts: ['dart-agent'] };
    }
    case 'intent':
    case 'retrieval':
      return { command: [node, 'scripts/intelligence/evaluate.ts', phase], env, artifacts: [phase + '.json'] };
    case 'preview':
      return { command: ['npm', 'run', 'demo:m5', '--', '--preview'], env, artifacts: ['preview-meeting.json'] };
  }
}

let child;
let interrupted;
const signalCode = { SIGINT: 130, SIGTERM: 143 };
for (const signal of Object.keys(signalCode)) {
  process.on(signal, () => {
    interrupted ??= signal;
    if (child?.pid) {
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
    }
  });
}
async function run({ command: [file, ...args], env, stdout }, out) {
  const fd = stdout ? openSync(join(out, stdout), 'w') : undefined;
  try {
    return await new Promise((done) => {
      child = spawn(file, args, { env, detached: true, stdio: ['ignore', fd ?? 'inherit', 'inherit'] });
      child.once('error', (error) => done({ exitCode: null, signal: null, error: error.code ?? 'spawn failed' }));
      child.once('close', (exitCode, signal) => done({ exitCode, signal }));
    });
  } finally {
    child = undefined;
    if (fd !== undefined) closeSync(fd);
  }
}

mkdirSync(root, { recursive: true });
const lock = join(root, '.active');
try {
  writeFileSync(lock, process.pid + '\n', { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('Another verification run owns ' + lock + '. See the runbook before removing the lock.');
  throw error;
}
try {
  if (values.resume) {
    if (read(manifestPath).commit !== commit) throw new Error('Resume on the session commit or start a new session.');
  } else {
    mkdirSync(directory);
    save(manifestPath, { commit, started: new Date().toISOString() });
  }
  console.log('Session %s. Evidence: %s', name, directory);
  for (const phase of selected) {
    if (interrupted) break;
    if (verified(latest(phase))) {
      console.log('Using previous verified evidence for ' + phase);
      continue;
    }
    const folder = String(previous().length + 1).padStart(6, '0') + '-' + phase;
    const out = join(directory, folder);
    const path = join(out, 'attempt.json');
    const attempt = { phase, status: 'running', started: new Date().toISOString(), artifacts: {} };
    mkdirSync(out);
    save(path, attempt);
    try {
      const options = step(phase, out);
      attempt.command = options.command;
      console.log('\nRunning ' + phase);
      Object.assign(attempt, await run(options, out));
      if (!interrupted && attempt.exitCode === 0) {
        requireCleanCheckout();
        attempt.artifacts = Object.fromEntries(options.artifacts.map((file) => [file, digest(join(out, file))]));
        attempt.status = 'passed';
      }
    } catch (error) {
      attempt.error = error.message;
      console.error(phase + ': ' + error.message);
    } finally {
      if (interrupted) attempt.status = 'interrupted';
      else if (attempt.status === 'running') attempt.status = 'failed';
      save(path, { ...attempt, finished: new Date().toISOString() });
    }
    if (attempt.status !== 'passed') break;
  }
  // A successful filtered run cannot hide an earlier failed or unfinished phase.
  const rows = show();
  if (interrupted) process.exitCode = signalCode[interrupted];
  else if (rows.some(({ phase, status }) => status !== 'passed' && (status !== 'pending' || selected.includes(phase)))) {
    process.exitCode = 1;
  }
} finally {
  unlinkSync(lock);
}

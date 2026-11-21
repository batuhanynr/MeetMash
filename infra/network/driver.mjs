import { fork, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDatabase, migrate } from '../../apps/hub/src/db.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';

const node = process.argv[2];
const isHub = node === 'hub';
const emit = (data) => process.stdout.write(JSON.stringify(data) + '\n');
const db = isHub ? createDatabase(process.env.DATABASE_URL) : undefined;
let child, started, restored, stateRoot;
const pending = new Map();
const live = () => child && child.exitCode === null && child.signalCode === null;
async function stop() {
  if (!live()) return;
  const closed = once(child, 'exit');
  child.kill('SIGKILL');
  await closed;
}
async function start({ runId, fault, args: extra = [] }) {
  if (live()) throw new Error('Already running');
  stateRoot = '/state/' + runId;
  const app = isHub ? 'hub' : 'agent-node';
  const args = isHub
    ? ['--host', 'hub-data', '--tick-ms', '200']
    : [
        '--id',
        node,
        '--hub',
        'wss://hub-data:8787',
        '--state-root',
        '/state/' + runId,
        '--heartbeat-ms',
        '500',
        ...extra,
      ];
  child = fork('apps/' + app + '/src/m2-main.ts', [...args, '--run-id', runId], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: fault ? ['--import', './infra/network/faults.mjs'] : [],
    env: {
      ...process.env,
      CERT_DIR: '/state/certs',
      SECRETS_FILE: '/state/secrets.json',
      M4_FAULT: fault ?? '',
      M4_NODE: node,
    },
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      emit({ record: JSON.parse(line) });
    } catch {
      /* ignore non-JSON diagnostics */
    }
  });
  child.stderr.on('data', (s) => process.stderr.write(s));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(node + ' startup timeout')), 18000);
    child.on('message', (msg) => {
      if (msg.kind === 'ready') {
        clearTimeout(timer);
        resolve(msg);
      }
      if (msg.kind === 'response') pending.get(msg.requestId)?.(msg);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(node + ' exited: ' + (signal ?? code)));
      for (const finish of pending.values()) finish({ error: 'child exited' });
    });
  });
}
async function execute(input) {
  switch (input.action) {
    case 'start':
      return start(input);
    case 'stop':
      await stop();
      return;
    case 'signal':
      if (!live() || input.signal !== 'SIGCONT') throw new Error('Expected a stopped live process');
      child.kill(input.signal);
      return;
    case 'clock':
      return {
        elapsedMs: performance.now() - started,
        recoveryMs: restored === undefined ? null : performance.now() - restored,
      };
    case 'restored':
      restored = performance.now();
      return;
    case 'profile':
      return execFileSync('sh', ['infra/network/profile.sh', isHub ? 'agent-a' : 'hub-data', input.profile], {
        encoding: 'utf8',
      });
    case 'reservation': {
      const storage = new DatabaseSync(stateRoot + '/' + node + '/meetings.sqlite', { readOnly: true });
      try {
        return storage.prepare('SELECT start,end FROM reservations WHERE meeting=?').get(input.meetingId) ?? null;
      } finally {
        storage.close();
      }
    }
    case 'health':
      return new Promise((resolve, reject) => {
        const req = https.get(
          'https://hub-data:8787/health',
          { ca: readFileSync('/state/certs/ca.crt') },
          (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          },
        );
        const deadline = setTimeout(() => req.destroy(new Error('data path timed out')), 1500);
        req.once('close', () => clearTimeout(deadline));
        req.once('error', reject);
      });
    case 'info':
      return {
        node: process.version,
        kernel: execFileSync('uname', ['-r'], { encoding: 'utf8' }).trim(),
        tc: execFileSync('tc', ['-V'], { encoding: 'utf8' }).trim(),
      };
    case 'provision': {
      if (!db) throw new Error('hub only');
      await migrate(db);
      for (const [id, secret] of Object.entries(input.bootstrap))
        await provisionIdentity(db, { agentId: id, userId: id, secret });
      return;
    }
    case 'clear':
      await db.query('TRUNCATE mailbox,sessions');
      return;
    case 'mail':
      return (
        await db.query(
          `SELECT recipient_agent_id AS recipient, sender_agent_id AS sender, message_id AS id,
      content->>'type' AS type, status, attempts, EXTRACT(EPOCH FROM (delivered_at-created_at))*1000 AS "deliveryMs"
      FROM mailbox WHERE meeting_id=$1`,
          [input.meetingId],
        )
      ).rows;
    case 'command': {
      if (!live()) throw new Error(node + ' is offline');
      const requestId = randomUUID();
      if (input.command.command === 'schedule') {
        started = performance.now();
        restored = undefined;
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('command timed out'));
        }, 5000);
        pending.set(requestId, (reply) => {
          clearTimeout(timeout);
          pending.delete(requestId);
          reply.error ? reject(new Error(reply.error)) : resolve(reply);
        });
        child.send({ ...input.command, requestId });
      });
    }
    default:
      throw new Error('Unknown driver action');
  }
}
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const { seq, ...input } = JSON.parse(line);
  try {
    emit({ seq, value: await execute(input) });
  } catch (error) {
    emit({ seq, error: String(error.message) });
  }
}
await stop();
await db?.end();

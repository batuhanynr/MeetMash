import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createMessage, type Message, type MessageType, type Payloads } from '../../packages/protocol/src/index.ts';
import { signMessage } from '../../packages/protocol/src/mac.ts';
import { pairId, loadSecrets } from '../../apps/agent-node/src/m2-security.ts';
import { createDatabase } from '../../apps/hub/src/db.ts';
import { M2Cluster } from './m2-cluster.ts';
import { waitFor, type LogRecord } from './processes.ts';

const fast = ['--ack-timeout-ms', '150', '--max-backoff-ms', '200'];
const window = { start: '2026-11-10T08:00:00Z', end: '2026-11-10T09:00:00Z' };
const requestPayload = { participantAgentIds: ['agent-a', 'agent-b', 'agent-c'], durationMinutes: 30, window };
const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://meetmesh:meetmesh@127.0.0.1:5433/meetmesh',
  secretsFile: process.env.SECRETS_FILE ?? '.state/secrets.json',
  certDir: process.env.CERT_DIR ?? '.state/certs',
};

async function send<T extends MessageType>(cluster: M2Cluster, from: string, to: string, type: T, payload: Payloads[T], meetingId = 'meeting-demo'): Promise<Message> {
  return (await cluster.agent(from).command({ command: 'send', toAgentId: to, meetingId, type, payload })).message as Message;
}

async function delivered(cluster: M2Cluster, message: Message): Promise<void> {
  await waitFor(() => cluster.agent(message.toAgentId).status(), status =>
    status.inbox.some(row => row.messageId === message.messageId && row.status === 'PROCESSED'), 'domain effect');
}

async function mailboxStatus(messageId: string): Promise<string | undefined> {
  const database = createDatabase(env.databaseUrl);
  try {
    const result = await database.query<{ status: string }>('SELECT status FROM mailbox WHERE message_id = $1', [messageId]);
    return result.rows[0]?.status;
  } finally { await database.end(); }
}

type Scenario = { id: string; description: string; agentArgs?: Partial<Record<string, string[]>>; run(cluster: M2Cluster): Promise<LogRecord> };

export const scenarios: Scenario[] = [
  {
    id: 'M2-T1', description: 'agents are reached through the directory, not a hard-coded address',
    async run(cluster) {
      const byName = (await cluster.agent('agent-a').command({ command: 'lookup', by: 'name', term: 'Carol' })).agents as { agentId: string }[];
      assert.deepEqual(byName.map(a => a.agentId), ['agent-c']);
      const byCapability = (await cluster.agent('agent-a').command({ command: 'lookup', by: 'capability', term: 'scheduling' })).agents as { agentId: string }[];
      assert.deepEqual(byCapability.map(a => a.agentId).sort(), ['agent-a', 'agent-b', 'agent-c']);
      return { discoveredByName: byName[0]!.agentId, discoveredByCapability: byCapability.length };
    },
  },
  {
    id: 'M2-T2', description: 'an offline recipient queues durably across a hub restart, then receives on return',
    async run(cluster) {
      await cluster.stopAgent('agent-c');
      const toB = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload, 'meeting-online');
      const toC = await send(cluster, 'agent-a', 'agent-c', 'REQUEST', requestPayload, 'meeting-offline');
      await delivered(cluster, toB); // the online recipient receives
      await waitFor(() => mailboxStatus(toC.messageId), status => status === 'QUEUED', 'queued for offline C');
      assert.equal((await cluster.agent('agent-b').status()).inbox.some(r => r.messageId === toC.messageId), false); // not delivered to the whole group

      await cluster.stopAgent('agent-a');
      await cluster.stopAgent('agent-b');
      await cluster.restartHub();
      assert.equal(await mailboxStatus(toC.messageId), 'QUEUED'); // survives the hub restart in Postgres

      await cluster.startAgent('agent-c', fast);
      await delivered(cluster, toC);
      await waitFor(() => mailboxStatus(toC.messageId), status => status === 'DELIVERED', 'delivered after C returns');
      const c = await cluster.agent('agent-c').status();
      assert.equal(c.effectCount, 1);
      return { onlineDelivered: true, survivedHubRestart: true, redelivered: true, effects: c.effectCount };
    },
  },
  {
    id: 'M2-SECURITY', description: 'a forged session and a tampered MAC are rejected',
    async run(cluster) {
      const ca = readFileSync(join(env.certDir, 'ca.crt'));
      const rejected = await new Promise<string>(resolve => {
        const socket = new WebSocket(`wss://127.0.0.1:${cluster.port}`, { ca, headers: { 'x-meetmesh-agent': 'agent-a', 'x-meetmesh-secret': 'wrong-secret' } });
        socket.on('message', data => { const frame = JSON.parse(data.toString()) as { kind?: string; code?: string }; if (frame.kind === 'error') { resolve(frame.code ?? 'error'); socket.close(); } });
        socket.on('close', () => resolve('closed'));
        socket.on('error', () => resolve('error'));
      });
      assert.ok(['AUTH_FAILED', 'closed', 'error'].includes(rejected), `forged session not accepted (${rejected})`);

      const keys = loadSecrets(env.secretsFile).pairKeys;
      const genuine = createMessage({ fromAgentId: 'agent-a', toAgentId: 'agent-b', meetingId: 'meeting-tamper', type: 'REQUEST', payload: requestPayload, sequence: 999 });
      const signed = signMessage(genuine, keys[pairId('agent-a', 'agent-b')]!, pairId('agent-a', 'agent-b'));
      const tampered = { ...signed, payload: { ...requestPayload, durationMinutes: 45 } }; // content changed after signing
      const before = (await cluster.agent('agent-b').status()).effectCount;
      await cluster.agent('agent-a').command({ command: 'raw', raw: JSON.stringify(tampered) });
      await waitFor(() => cluster.agent('agent-b').records, records => records.some(r => r.event === 'message.rejected' && r.outcome === 'MAC_INVALID'), 'MAC rejection');
      assert.equal((await cluster.agent('agent-b').status()).effectCount, before); // no work from a tampered message
      return { forgedSession: rejected, tamperedMacRejected: true };
    },
  },
  {
    id: 'M2-RELAY', description: 'the M1 REQUEST/PROPOSE/ACCEPT/CONFIRM flow still works over wss with signing',
    async run(cluster) {
      const request = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload);
      await delivered(cluster, request);
      const proposal = await send(cluster, 'agent-b', 'agent-a', 'PROPOSE', { phase: 'AVAILABILITY', slots: [window] });
      await delivered(cluster, proposal);
      const acceptance = await send(cluster, 'agent-a', 'agent-b', 'ACCEPT', { proposalMessageId: proposal.messageId });
      await delivered(cluster, acceptance);
      const confirm = await send(cluster, 'agent-b', 'agent-a', 'CONFIRM', { phase: 'APPLIED', decisionId: 'scripted-decision' });
      await delivered(cluster, confirm);
      const a = await cluster.agent('agent-a').status();
      const b = await cluster.agent('agent-b').status();
      assert.equal(a.effectCount + b.effectCount, 4);
      return { flow: 'REQUEST/PROPOSE/ACCEPT/CONFIRM', domainEffects: a.effectCount + b.effectCount };
    },
  },
];

export async function runM2Scenarios(onResult: (result: LogRecord) => void = () => {}, evidenceDirectory?: string) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const codeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const worktreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const root = mkdtempSync(join(tmpdir(), 'meetmesh-m2-'));
  const results: LogRecord[] = [];
  try {
    for (const scenario of scenarios) {
      const cluster = new M2Cluster({
        runId, stateRoot: join(root, scenario.id), databaseUrl: env.databaseUrl, secretsFile: env.secretsFile, certDir: env.certDir,
        agentIds: ['agent-a', 'agent-b', 'agent-c'],
        agentArgs: { 'agent-a': fast, 'agent-b': fast, 'agent-c': fast, ...scenario.agentArgs },
      });
      const started = Date.now();
      let result: LogRecord;
      try {
        await cluster.start();
        result = { id: scenario.id, description: scenario.description, status: 'passed', durationMs: Date.now() - started, ...await scenario.run(cluster) };
      } catch (error) {
        result = { id: scenario.id, description: scenario.description, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      } finally { await cluster.close(); }
      results.push(result);
      onResult(result);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  const summary = {
    milestone: 'M2', runId, codeCommit, worktreeDirty, startedAt, finishedAt: new Date().toISOString(),
    status: results.every(result => result.status === 'passed') ? 'passed' : 'failed',
    transport: 'Real loopback wss (TLS) with a dev CA; one Postgres-backed hub and three authenticated agent processes',
    security: 'Bootstrap-secret sessions, per-pair HMAC signing, persistent nonce replay guard',
    testData: 'Synthetic protocol messages only; no scheduler, calendar, or LLM',
    results,
  };
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  return summary;
}

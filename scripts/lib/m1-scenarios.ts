import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessage, type Message, type MessageType, type Payloads } from '../../packages/protocol/src/index.ts';
import { LocalCluster, ManagedProcess, waitFor, type LogRecord } from './processes.ts';

const fast = ['--ack-timeout-ms', '100', '--max-backoff-ms', '150'];
const window = { start: '2026-11-10T08:00:00Z', end: '2026-11-10T09:00:00Z' };
const requestPayload = { participantAgentIds: ['agent-a', 'agent-b', 'agent-c'], durationMinutes: 30, window };

async function send<T extends MessageType>(cluster: LocalCluster, from: string, to: string, type: T, payload: Payloads[T], meetingId = 'meeting-demo'): Promise<Message> {
  const response = await cluster.agent(from).command({ command: 'send', toAgentId: to, meetingId, type, payload });
  return response.message as Message;
}

async function delivered(cluster: LocalCluster, message: Message): Promise<void> {
  await waitFor(() => cluster.agent(message.fromAgentId).status(), status =>
    status.outbox.some(row => row.messageId === message.messageId && row.status === 'ACKED'), 'recipient ACK');
  await waitFor(() => cluster.agent(message.toAgentId).status(), status =>
    status.inbox.some(row => row.messageId === message.messageId && row.status === 'PROCESSED'), 'domain effect');
}

async function event(cluster: LocalCluster, name: string, outcome?: string): Promise<void> {
  await waitFor(() => cluster.records(), records => records.some(record => record.event === name && (!outcome || record.outcome === outcome)), `${name} ${outcome ?? ''}`);
}

type Scenario = {
  id: string; description: string; agentArgs?: Partial<Record<string, string[]>>;
  run(cluster: LocalCluster): Promise<LogRecord>;
};

export const scenarios: Scenario[] = [
  {
    id: 'M1-T1', description: 'scripted REQUEST / PROPOSE / ACCEPT / CONFIRM over three agent processes',
    async run(cluster) {
      const pids = cluster.processes.map(process => process.child.pid);
      assert.equal(new Set(pids).size, 4);
      for (const recipient of ['agent-b', 'agent-c']) {
        const request = await send(cluster, 'agent-a', recipient, 'REQUEST', requestPayload);
        await delivered(cluster, request);
        const proposal = await send(cluster, recipient, 'agent-a', 'PROPOSE', { phase: 'AVAILABILITY', slots: [window] });
        await delivered(cluster, proposal);
        const acceptance = await send(cluster, 'agent-a', recipient, 'ACCEPT', { proposalMessageId: proposal.messageId });
        await delivered(cluster, acceptance);
        await delivered(cluster, await send(cluster, recipient, 'agent-a', 'CONFIRM', { phase: 'APPLIED', decisionId: 'scripted-decision' }));
      }
      const b = await cluster.agent('agent-b').status();
      const c = await cluster.agent('agent-c').status();
      assert.equal(b.inbox.length, 2);
      assert.equal(c.inbox.length, 2);
      assert.ok(b.inbox.every(row => !c.inbox.some(other => other.messageId === row.messageId)));
      assert.equal((await cluster.health()).agentIds.length, 3);
      return { independentProcesses: pids.length, domainEffects: 8, scripted: true };
    },
  },
  {
    id: 'M1-T2', description: 'REJECT is delivered as a rejection',
    async run(cluster) {
      const message = await send(cluster, 'agent-b', 'agent-a', 'REJECT', { reasonCode: 'NO_AVAILABILITY' }, 'meeting-rejected');
      await delivered(cluster, message);
      const status = await cluster.agent('agent-a').status();
      assert.equal(status.inbox[0]!.type, 'REJECT');
      assert.ok(!status.inbox.some(row => row.type === 'CONFIRM'));
      return { rejected: true, domainEffects: status.effectCount };
    },
  },
  {
    id: 'M1-T3', description: 'lost first recipient ACK causes retry and one effect',
    agentArgs: { 'agent-b': [...fast, '--drop-acks', '1'] },
    async run(cluster) {
      const message = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload);
      await delivered(cluster, message);
      await event(cluster, 'message.retried');
      await event(cluster, 'message.duplicate');
      const sender = await cluster.agent('agent-a').status();
      const recipient = await cluster.agent('agent-b').status();
      const attempts = sender.outbox[0]!.attempts;
      assert.ok(attempts >= 2);
      assert.equal(recipient.effectCount, 1);
      return { attempts, domainEffects: recipient.effectCount };
    },
  },
  {
    id: 'M1-T4', description: 'invalid frames and routing errors are visible without crashing',
    async run(cluster) {
      const message = createMessage({ fromAgentId: 'agent-a', toAgentId: 'agent-b', meetingId: 'meeting-invalid', type: 'REQUEST', payload: requestPayload, sequence: 1 });
      const { toAgentId: omitted, ...missingReceiver } = message;
      assert.equal(omitted, 'agent-b');
      for (const [raw, code] of [
        ['{', 'INVALID_JSON'], ['null', 'INVALID_MESSAGE'],
        [JSON.stringify(missingReceiver), 'INVALID_MESSAGE'],
        [JSON.stringify({ ...message, toAgentId: 'agent-z' }), 'UNKNOWN_AGENT'],
        [JSON.stringify({ ...message, protocolVersion: '2' }), 'UNSUPPORTED_VERSION'],
        [JSON.stringify({ ...message, fromAgentId: 'agent-c' }), 'SENDER_MISMATCH'],
        [JSON.stringify({ ...message, createdAt: '2026-99-99T00:00:00Z' }), 'INVALID_MESSAGE'],
      ]) {
        await cluster.agent('agent-a').command({ command: 'raw', raw });
        await event(cluster, 'relay.error', code);
      }
      assert.equal((await cluster.agent('agent-b').status()).effectCount, 0);
      assert.equal((await cluster.agent('agent-c').status()).effectCount, 0);
      assert.equal((await cluster.health()).agentIds.length, 3);
      await delivered(cluster, await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload));
      return { invalidFrames: 7, processesHealthy: true };
    },
  },
  {
    id: 'M1-T5', description: 'SIGKILL after inbox persistence recovers acknowledged pending work',
    agentArgs: { 'agent-b': [...fast, '--pause-after-persist', 'true'] },
    async run(cluster) {
      const message = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload);
      await waitFor(() => cluster.agent('agent-a').status(), status => status.outbox[0]?.status === 'ACKED', 'ACK before crash');
      const before = await cluster.agent('agent-b').status();
      assert.equal(before.pendingWork, 1);
      assert.equal(before.effectCount, 0);
      await cluster.stopAgent('agent-b', 'SIGKILL');
      await cluster.startAgent('agent-b', fast);
      await delivered(cluster, message);
      const after = await cluster.agent('agent-b').status();
      assert.equal(after.effectCount, 1);
      assert.equal(after.pendingWork, 0);
      await event(cluster, 'work.recovered');
      await cluster.agent('agent-a').command({ command: 'raw', raw: JSON.stringify(message) });
      await event(cluster, 'message.duplicate');
      assert.equal((await cluster.agent('agent-b').status()).effectCount, 1);
      return { acknowledgedBeforeCrash: true, recoveredEffects: 1 };
    },
  },
  {
    id: 'M1-100', description: '100 distinct messages arrive only at their intended recipients',
    async run(cluster) {
      const messages: Message[] = [];
      for (let index = 0; index < 100; index++) messages.push(await send(cluster, 'agent-a', index % 2 ? 'agent-b' : 'agent-c', 'REQUEST', requestPayload, 'meeting-100'));
      assert.equal(new Set(messages.map(message => message.messageId)).size, 100);
      await waitFor(() => cluster.agent('agent-a').status(), status => status.outbox.length === 100 && status.outbox.every(row => row.status === 'ACKED'), '100 ACKs');
      const b = await cluster.agent('agent-b').status();
      const c = await cluster.agent('agent-c').status();
      const expected = (id: string) => messages.filter(message => message.toAgentId === id).map(message => message.messageId).sort();
      assert.deepEqual(b.inbox.map(row => row.messageId).sort(), expected('agent-b'));
      assert.deepEqual(c.inbox.map(row => row.messageId).sort(), expected('agent-c'));
      assert.equal(b.effectCount + c.effectCount, 100);
      assert.equal((await cluster.agent('agent-a').status()).effectCount, 0);
      return { uniqueMessages: 100, deliveredMessages: b.inbox.length + c.inbox.length, domainEffects: b.effectCount + c.effectCount };
    },
  },
  {
    id: 'M1-DUPLICATE', description: 'ten wire deliveries produce one effect; ID reuse with changed content fails',
    async run(cluster) {
      const message = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload);
      await delivered(cluster, message);
      for (let index = 0; index < 9; index++) await cluster.agent('agent-a').command({ command: 'raw', raw: JSON.stringify(message) });
      await waitFor(() => cluster.records(), records => records.filter(record => record.event === 'message.duplicate').length >= 9, 'nine duplicates');
      await cluster.agent('agent-a').command({ command: 'raw', raw: JSON.stringify({ ...message, nonce: 'conflicting-nonce' }) });
      await event(cluster, 'message.rejected', 'MESSAGE_ID_CONFLICT');
      const status = await cluster.agent('agent-b').status();
      assert.equal(status.effectCount, 1);
      assert.equal(status.inbox.length, 1);
      return { wireDeliveries: 10, domainEffects: 1, conflictingContentRejected: true };
    },
  },
  {
    id: 'M1-UNCONFIRMED', description: 'retry exhaustion stays explicit; group ACKs remain independent',
    agentArgs: { 'agent-a': [...fast, '--max-retries', '2'], 'agent-b': [...fast, '--drop-acks', '1000'] },
    async run(cluster) {
      const b = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload);
      const c = await send(cluster, 'agent-a', 'agent-c', 'REQUEST', requestPayload);
      assert.notEqual(b.messageId, c.messageId);
      await delivered(cluster, c);
      const sender = await waitFor(() => cluster.agent('agent-a').status(), status =>
        status.outbox.some(row => row.messageId === b.messageId && row.status === 'DELIVERY_UNCONFIRMED'), 'retry exhaustion');
      assert.equal(sender.outbox.find(row => row.messageId === b.messageId)!.attempts, 3);
      assert.equal(sender.outbox.find(row => row.messageId === c.messageId)!.status, 'ACKED');
      assert.equal((await cluster.agent('agent-b').status()).effectCount, 1);
      await event(cluster, 'message.unconfirmed', 'DELIVERY_UNCONFIRMED');
      return { attempts: 3, bStatus: 'DELIVERY_UNCONFIRMED', cStatus: 'ACKED', bEffects: 1 };
    },
  },
  {
    id: 'M1-OUTBOX', description: 'persisted outbox and sequence resume after sender SIGKILL',
    agentArgs: { 'agent-a': ['--ack-timeout-ms', '1000', '--max-backoff-ms', '1000', '--drop-messages', '1'] },
    async run(cluster) {
      const first = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload, 'meeting-outbox');
      assert.equal((await cluster.agent('agent-a').status()).outbox[0]!.status, 'PENDING');
      await cluster.stopAgent('agent-a', 'SIGKILL');
      await cluster.startAgent('agent-a', fast);
      await delivered(cluster, first);
      const second = await send(cluster, 'agent-a', 'agent-b', 'REQUEST', requestPayload, 'meeting-outbox');
      assert.equal(second.sequence, first.sequence + 1);
      await delivered(cluster, second);
      assert.equal((await cluster.agent('agent-b').status()).effectCount, 2);
      return { restoredOutbox: true, persistedSequence: second.sequence, domainEffects: 2 };
    },
  },
  {
    id: 'M1-COLLISION', description: 'duplicate port, active agent ID, and state ownership fail clearly',
    async run(cluster) {
      const duplicates = [
        new ManagedProcess('hub', ['--port', String(cluster.port)]),
        new ManagedProcess('agent-node', ['--id', 'agent-a', '--hub', `ws://127.0.0.1:${cluster.port}`, '--state-root', join(cluster.options.stateRoot, 'other')]),
        new ManagedProcess('agent-node', ['--id', 'agent-a', '--hub', `ws://127.0.0.1:${cluster.port}`, '--state-root', cluster.options.stateRoot]),
      ];
      try {
        await Promise.all(duplicates.map(async process => assert.rejects(process.ready)));
        await event(cluster, 'connection.rejected', 'DUPLICATE_AGENT');
        await waitFor(() => duplicates[2]!.records, records => records.some(record => record.outcome === 'STATE_IN_USE'), 'state collision error');
        assert.ok(duplicates[0]!.records.some(record => String(record.outcome).includes('EADDRINUSE')));
        assert.equal((await cluster.health()).agentIds.length, 3);
        return { portCollision: true, identityCollision: true, stateCollision: true };
      } finally { for (const process of duplicates) await process.stop(); }
    },
  },
];

export async function runM1Scenarios(onResult: (result: LogRecord) => void = () => {}, evidenceDirectory?: string) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const codeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const worktreeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const root = mkdtempSync(join(tmpdir(), 'meetmesh-m1-'));
  const results: LogRecord[] = [];
  const logs: LogRecord[] = [];
  try {
    for (const scenario of scenarios) {
      const cluster = new LocalCluster({
        runId, stateRoot: join(root, scenario.id),
        agentArgs: { 'agent-a': fast, 'agent-b': fast, 'agent-c': fast, ...scenario.agentArgs },
      });
      const started = Date.now();
      let result: LogRecord;
      try {
        await cluster.start();
        const metrics = await scenario.run(cluster);
        result = { id: scenario.id, description: scenario.description, status: 'passed', durationMs: Date.now() - started, ...metrics };
      } catch (error) {
        result = { id: scenario.id, description: scenario.description, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      } finally {
        await cluster.close();
        logs.push(...cluster.records().map(record => ({ ...record, scenarioId: scenario.id })));
      }
      results.push(result);
      onResult(result);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  const summary = {
    milestone: 'M1', runId, codeCommit, worktreeDirty, startedAt, finishedAt: new Date().toISOString(),
    status: results.every(result => result.status === 'passed') ? 'passed' : 'failed',
    environment: {
      node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      platform: process.platform, arch: process.arch,
      packages: JSON.parse(execFileSync('npm', ['ls', '--depth=0', '--json'], { encoding: 'utf8' })),
    },
    testData: 'Synthetic protocol messages only; scripted slots, no scheduler, calendar, or LLM',
    transport: 'Real loopback TCP/WebSocket; one hub and three separate Node agent processes per scenario',
    retryConfig: { ackTimeoutMs: 100, maxBackoffMs: 150, maxRetries: 5, overrides: 'M1-UNCONFIRMED: 2 retries; M1-OUTBOX first sender: 1000ms timeout/backoff' },
    results,
  };
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    const sampled = new Map<string, LogRecord>();
    for (const record of logs) {
      const key = [record.scenarioId, record.agentId, record.event, record.messageType, record.outcome].join('|');
      if (!sampled.has(key)) sampled.set(key, record);
    }
    writeFileSync(join(evidenceDirectory, 'events.jsonl'), [...sampled.values()].map(record => JSON.stringify(record)).join('\n') + '\n');
  }
  return summary;
}

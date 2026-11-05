import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { ProtocolError, type MessageType, type Payloads } from '../../../packages/protocol/src/index.ts';
import { integer, options, requireLoopbackUrl } from '../../../packages/runtime/src/config.ts';
import { jsonLogger } from '../../../packages/runtime/src/log.ts';
import { Agent, type AgentConfig } from './agent.ts';
import { SqliteAgentStore } from './sqlite-store.ts';
import { WebSocketTransport } from './websocket-transport.ts';

const args = options(['id', 'hub', 'state-root', 'run-id', 'ack-timeout-ms', 'max-retries', 'max-backoff-ms', 'drop-acks', 'drop-messages', 'pause-after-persist']);
const agentId = args.id ?? '';
const log = jsonLogger(args['run-id'] ?? process.env.RUN_ID ?? randomUUID(), agentId);
let store: SqliteAgentStore | undefined;
let transport: WebSocketTransport | undefined;
let agent: Agent | undefined;
let stopping = false;
let input: ReturnType<typeof createInterface> | undefined;
const stop = () => {
  if (stopping) return;
  stopping = true;
  agent?.stop();
  transport?.close();
  store?.close();
  input?.close();
  if (process.connected) process.disconnect?.();
};

try {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(agentId) || agentId === '.' || agentId === '..') throw new Error('--id must be a protocol agent ID');
  const url = requireLoopbackUrl(args.hub ?? process.env.HUB_URL ?? 'ws://127.0.0.1:8787');
  url.searchParams.set('agentId', agentId);
  const pause = args['pause-after-persist'] ?? 'false';
  if (!['true', 'false'].includes(pause)) throw new Error('pause-after-persist must be true or false');
  const config: AgentConfig = {
    agentId,
    ackTimeoutMs: integer(args['ack-timeout-ms'] ?? '1000', 'ack timeout', 10, 8000),
    maxRetries: integer(args['max-retries'] ?? '5', 'max retries', 0, 10),
    maxBackoffMs: integer(args['max-backoff-ms'] ?? '8000', 'max backoff', 10, 8000),
    dropAckCount: integer(args['drop-acks'] ?? '0', 'drop acks', 0, 1000),
    dropMessageCount: integer(args['drop-messages'] ?? '0', 'drop messages', 0, 1000),
    pauseAfterPersist: pause === 'true',
  };
  const directory = resolve(args['state-root'] ?? process.env.STATE_ROOT ?? '.state/local', agentId);
  store = new SqliteAgentStore(directory, agentId);
  transport = new WebSocketTransport(url, log);
  agent = new Agent(config, store, transport, log);
  await transport.connect(raw => agent!.receive(raw), () => {
    log('agent.offline', { outcome: 'hub_disconnected' });
    // M1 resumes durable work by restarting the process; session reconnection belongs to M2.
    stop();
    process.exitCode = 1;
  });
  agent.start();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);

  // IPC/stdin is a local scenario control surface, never a network application API.
  const command = (value: unknown) => {
    const request = (typeof value === 'object' && value !== null ? value : {}) as { requestId?: string; command?: string; toAgentId?: string; meetingId?: string; type?: MessageType; payload?: Payloads[MessageType]; message?: unknown; raw?: string };
    let response: Record<string, unknown>;
    try {
      switch (request.command) {
        case 'status': response = { snapshot: store!.snapshot() }; break;
        case 'send': {
          const message = agent!.send(request.toAgentId!, request.meetingId!, request.type!, request.payload!);
          response = { message }; break;
        }
        case 'queue': agent!.queue(request.message); response = { queued: true }; break;
        case 'raw': {
          if (typeof request.raw !== 'string') throw new Error('raw must be a string');
          transport!.send(request.raw); response = { sent: true }; break;
        }
        default: throw new Error('Expected status, send, queue, or raw command');
      }
    } catch (error) {
      response = { error: error instanceof Error ? error.message : 'Command failed', code: error instanceof ProtocolError ? error.code : 'INVALID_COMMAND' };
    }
    const result = { kind: 'response', requestId: request.requestId, ...response };
    if (process.send) process.send(result);
    else console.log(JSON.stringify(result));
  };
  if (process.send) process.on('message', command);
  else {
    input = createInterface({ input: process.stdin });
    input.on('line', line => {
      try { command(JSON.parse(line)); }
      catch { log('command.rejected', { outcome: 'INVALID_JSON' }); }
    });
  }
  log('agent.ready', { pid: process.pid, outcome: 'ready' });
  process.send?.({ kind: 'ready', agentId, pid: process.pid });
} catch (error) {
  log('agent.failed', { outcome: error instanceof ProtocolError ? error.code : error instanceof Error ? error.message : 'startup_failed' });
  stop();
  process.exitCode = 1;
}

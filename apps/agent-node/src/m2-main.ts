import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { ProtocolError, type MessageType, type Payloads } from '../../../packages/protocol/src/index.ts';
import { integer, options } from '../../../packages/runtime/src/config.ts';
import { jsonLogger } from '../../../packages/runtime/src/log.ts';
import { Agent, type AgentConfig } from './agent.ts';
import { SqliteAgentStore } from './sqlite-store.ts';
import { M2Transport, type ControlFrame } from './m2-transport.ts';
import { buildSecurity, loadSecrets } from './m2-security.ts';

const args = options(['id', 'hub', 'state-root', 'run-id', 'secrets', 'cert-dir', 'ack-timeout-ms', 'max-retries', 'max-backoff-ms', 'drop-acks', 'drop-messages', 'pause-after-persist', 'heartbeat-ms']);
const agentId = args.id ?? '';
const log = jsonLogger(args['run-id'] ?? process.env.RUN_ID ?? randomUUID(), agentId);
let store: SqliteAgentStore | undefined;
let transport: M2Transport | undefined;
let agent: Agent | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let input: ReturnType<typeof createInterface> | undefined;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  agent?.stop();
  transport?.close();
  store?.close();
  input?.close();
  if (process.connected) process.disconnect?.();
};

try {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(agentId) || agentId === '.' || agentId === '..') throw new Error('--id must be a protocol agent ID');
  const url = new URL(args.hub ?? process.env.HUB_URL ?? 'wss://127.0.0.1:8787');
  if (url.protocol !== 'wss:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('M2 requires a loopback wss:// hub URL');
  url.searchParams.set('agentId', agentId);

  const secrets = loadSecrets(resolve(args.secrets ?? process.env.SECRETS_FILE ?? '.state/secrets.json'));
  const bootstrapSecret = secrets.bootstrap[agentId];
  if (!bootstrapSecret) throw new Error(`No bootstrap secret for ${agentId}`);
  const ca = readFileSync(join(resolve(args['cert-dir'] ?? process.env.CERT_DIR ?? '.state/certs'), 'ca.crt'));

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
  const security = buildSecurity(agentId, secrets.pairKeys, (nonce, hash, expiresAt) => store!.rememberNonce(nonce, hash, expiresAt));
  transport = new M2Transport(url, agentId, bootstrapSecret, ca, log);
  agent = new Agent(config, store, transport, log, security);

  const pendingLookups = new Map<string, (agents: unknown) => void>();
  const onControl = (frame: ControlFrame) => {
    if (frame.kind === 'relay.ack' && typeof frame.messageId === 'string') agent!.onRelayAck(frame.messageId);
    else if (frame.kind === 'directory.result' && typeof frame.requestId === 'string') pendingLookups.get(frame.requestId)?.(frame.agents);
    else if (frame.kind === 'displaced') { log('agent.displaced', { outcome: 'replaced_by_new_session' }); stop(); process.exitCode = 1; }
    else if (frame.kind === 'expired' && typeof frame.messageId === 'string') log('message.expired', { messageId: frame.messageId, outcome: 'MESSAGE_EXPIRED' });
  };
  await transport.connect(raw => agent!.receive(raw), onControl, () => {
    log('agent.offline', { outcome: 'hub_disconnected' });
    stop();
    process.exitCode = 1;
  });
  agent.start();
  heartbeat = setInterval(() => { try { transport!.sendControl({ kind: 'heartbeat' }); } catch { /* closing */ } }, integer(args['heartbeat-ms'] ?? '5000', 'heartbeat', 200, 60_000));
  heartbeat.unref();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);

  const command = (value: unknown) => {
    const request = (typeof value === 'object' && value !== null ? value : {}) as { requestId?: string; command?: string; toAgentId?: string; meetingId?: string; type?: MessageType; payload?: Payloads[MessageType]; by?: string; term?: string; raw?: string };
    const respond = (body: Record<string, unknown>) => {
      const result = { kind: 'response', requestId: request.requestId, ...body };
      if (process.send) process.send(result); else console.log(JSON.stringify(result));
    };
    try {
      switch (request.command) {
        case 'status': respond({ snapshot: store!.snapshot() }); break;
        case 'send': respond({ message: agent!.send(request.toAgentId!, request.meetingId!, request.type!, request.payload!) }); break;
        case 'lookup': {
          const lookupId = randomUUID();
          const settled = new Promise<unknown>(resolve => pendingLookups.set(lookupId, resolve));
          transport!.sendControl({ kind: 'directory.lookup', by: request.by ?? 'name', term: request.term ?? '', requestId: lookupId });
          void settled.then(agents => { pendingLookups.delete(lookupId); respond({ agents }); });
          break;
        }
        case 'raw': {
          if (typeof request.raw !== 'string') throw new Error('raw must be a string');
          transport!.send(request.raw); respond({ sent: true }); break;
        }
        default: throw new Error('Expected status, send, lookup, or raw command');
      }
    } catch (error) {
      respond({ error: error instanceof Error ? error.message : 'Command failed', code: error instanceof ProtocolError ? error.code : 'INVALID_COMMAND' });
    }
  };
  if (process.send) process.on('message', command);
  else { input = createInterface({ input: process.stdin }); input.on('line', line => { try { command(JSON.parse(line)); } catch { log('command.rejected', { outcome: 'INVALID_JSON' }); } }); }
  log('agent.ready', { pid: process.pid, outcome: 'ready' });
  process.send?.({ kind: 'ready', agentId, pid: process.pid });
} catch (error) {
  log('agent.failed', { outcome: error instanceof ProtocolError ? error.code : error instanceof Error ? error.message : 'startup_failed' });
  stop();
  process.exitCode = 1;
}

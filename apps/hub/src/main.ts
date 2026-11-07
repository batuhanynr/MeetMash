import { randomUUID } from 'node:crypto';
import { integer, options } from '../../../packages/runtime/src/config.ts';
import { jsonLogger } from '../../../packages/runtime/src/log.ts';
import { startHub } from './server.ts';

const args = options(['host', 'port', 'agents', 'run-id']);
const log = jsonLogger(args['run-id'] ?? process.env.RUN_ID ?? randomUUID(), 'hub');
try {
  const hub = await startHub({
    host: args.host ?? process.env.HUB_HOST ?? '127.0.0.1',
    port: integer(args.port ?? process.env.HUB_PORT ?? '8787', 'port', 0, 65535),
    agentIds: (args.agents ?? process.env.AGENT_IDS ?? 'agent-a,agent-b,agent-c').split(','),
  }, log);
  process.send?.({ kind: 'ready', port: hub.port, pid: process.pid });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await hub.close();
    if (process.connected) process.disconnect?.();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);
} catch (error) {
  log('hub.failed', { outcome: error instanceof Error ? error.message : 'startup_failed' });
  process.exitCode = 1;
}

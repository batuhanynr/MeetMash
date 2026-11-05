import { resolve } from 'node:path';
import { SqliteAgentStore } from '../apps/agent-node/src/sqlite-store.ts';

const stores: SqliteAgentStore[] = [];
try {
  const root = resolve(process.env.STATE_ROOT ?? '.state/local');
  // Acquire every lock before clearing anything; a live agent blocks the whole reset.
  for (const agentId of ['agent-a', 'agent-b', 'agent-c']) stores.push(new SqliteAgentStore(resolve(root, agentId), agentId));
  for (const store of stores) store.reset();
  console.log('Cleared synthetic inboxes, outboxes, effects, and sequences for local A/B/C.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { for (const store of stores) store.close(); }

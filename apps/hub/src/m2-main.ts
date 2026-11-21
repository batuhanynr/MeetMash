import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { integer, options } from '../../../packages/runtime/src/config.ts';
import { jsonLogger } from '../../../packages/runtime/src/log.ts';
import { createDatabase, migrate } from './db.ts';
import { startM2Hub } from './m2-server.ts';

const args = options(['host', 'port', 'run-id', 'cert-dir', 'database-url', 'tick-ms']);
const log = jsonLogger(args['run-id'] ?? process.env.RUN_ID ?? randomUUID(), 'hub');
try {
  const certDir = resolve(args['cert-dir'] ?? process.env.CERT_DIR ?? '.state/certs');
  const tls = { cert: readFileSync(join(certDir, 'hub.crt')), key: readFileSync(join(certDir, 'hub.key')) };
  const database = createDatabase(args['database-url'] ?? process.env.DATABASE_URL ?? 'postgres://meetmesh:meetmesh@127.0.0.1:5433/meetmesh');
  await migrate(database);
  const hub = await startM2Hub(database, {
    host: args.host ?? process.env.HUB_HOST ?? '127.0.0.1',
    port: integer(args.port ?? process.env.HUB_PORT ?? '8787', 'port', 0, 65535),
    tls,
    tickMs: integer(args['tick-ms'] ?? '1000', 'tick', 50, 10_000),
  }, log);
  process.send?.({ kind: 'ready', port: hub.port, pid: process.pid });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await hub.close();
    await database.end();
    if (process.connected) process.disconnect?.();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);
} catch (error) {
  log('hub.failed', { outcome: error instanceof Error ? error.message : 'startup_failed' });
  process.exitCode = 1;
}

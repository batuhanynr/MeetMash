import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { integer } from '../packages/runtime/src/config.ts';
import { LocalCluster } from './lib/processes.ts';

const cluster = new LocalCluster({
  runId: randomUUID(), stateRoot: resolve(process.env.STATE_ROOT ?? '.state/local'),
  port: integer(process.env.HUB_PORT ?? '8787', 'HUB_PORT', 0, 65535), echo: true,
});
try {
  await cluster.start();
  console.log(`Local hub + A/B/C ready. Health: http://127.0.0.1:${cluster.port}/health. Ctrl+C stops all processes.`);
  await new Promise<void>(resolve => {
    let stopping = false;
    const stop = () => { stopping = true; resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // A failed runtime process must not leave an apparently healthy cluster running.
    for (const managed of cluster.processes) {
      const failed = () => { if (!stopping) { process.exitCode = 1; stop(); } };
      managed.child.once('exit', failed);
      if (managed.child.exitCode !== null || managed.child.signalCode !== null) failed();
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await cluster.close(); }

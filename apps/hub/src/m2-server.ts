import { createServer } from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';
import { ProtocolError } from '../../../packages/protocol/src/index.ts';
import type { Logger } from '../../../packages/runtime/src/log.ts';
import type { Database } from './db.ts';
import { Directory } from './directory.ts';
import { Mailbox } from './mailbox.ts';
import { Registrar } from './registrar.ts';
import { PgDirectoryStore } from './pg-directory.ts';
import { PgMailboxStore } from './pg-mailbox.ts';
import { PgRegistrarStore } from './pg-sessions.ts';
import { HubCore } from './hub-core.ts';

export type M2HubConfig = { host: string; port: number; tls: { cert: Buffer; key: Buffer }; tickMs?: number };

export async function startM2Hub(database: Database, config: M2HubConfig, log: Logger) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw new Error('M2 hub must bind to loopback for the local demo');
  const hub = new HubCore(new Registrar(new PgRegistrarStore(database)), new Directory(new PgDirectoryStore(database)), new Mailbox(new PgMailboxStore(database)), log);

  const server = createServer({ cert: config.tls.cert, key: config.tls.key }, (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url !== '/health') { response.writeHead(404).end(JSON.stringify({ code: 'NOT_FOUND' })); return; }
    response.end(JSON.stringify({ status: 'ok', pid: process.pid, agentIds: hub.onlineAgentIds }));
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const agentId = String(request.headers['x-meetmesh-agent'] ?? '');
    const secret = String(request.headers['x-meetmesh-secret'] ?? '');
    sockets.handleUpgrade(request, socket, head, async client => {
      const peer = { send: (frame: string) => { if (client.readyState === WebSocket.OPEN) client.send(frame); } };
      try {
        const generation = await hub.connect(agentId, secret, `wss://${config.host}:${config.port}`, peer);
        client.on('message', data => { void hub.handle(agentId, generation, data.toString()); });
        client.on('close', () => { void hub.disconnect(agentId, generation); });
        client.on('error', () => log('transport.error', { connectedAgentId: agentId, outcome: 'socket_error' }));
      } catch (error) {
        const code = error instanceof ProtocolError ? error.code : 'AUTH_FAILED';
        log('connection.rejected', { connectedAgentId: agentId, outcome: code });
        peer.send(JSON.stringify({ kind: 'error', code }));
        client.close();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Hub did not bind a TCP port');
  const port = address.port;
  // The delivery worker retries online recipients and expires overdue mail without a client request.
  const timer = setInterval(() => { void hub.tick(); }, config.tickMs ?? 1000);
  timer.unref();
  log('hub.ready', { port, pid: process.pid, outcome: 'ready' });
  return {
    port,
    async close() {
      clearInterval(timer);
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      server.closeIdleConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { ProtocolError } from '../../../packages/protocol/src/index.ts';
import type { Logger } from '../../../packages/runtime/src/log.ts';
import { Relay } from './relay.ts';

export async function startHub(config: { host: string; port: number; agentIds: string[] }, log: Logger) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw new Error('M1 hub must bind to loopback');
  if (new Set(config.agentIds).size !== config.agentIds.length || config.agentIds.some(id => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) {
    throw new Error('AGENT_IDS must contain distinct protocol agent IDs');
  }
  const relay = new Relay(config.agentIds, log);
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url !== '/health') { response.writeHead(404).end(JSON.stringify({ code: 'NOT_FOUND' })); return; }
    response.end(JSON.stringify({ status: 'ok', pid: process.pid, agentIds: [...relay.peers.keys()].sort() }));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    let agentId = '';
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      agentId = url.searchParams.get('agentId') ?? '';
      if (url.pathname !== '/') throw new ProtocolError('INVALID_MESSAGE', 'Use the root WebSocket endpoint');
      if (!config.agentIds.includes(agentId)) throw new ProtocolError('UNKNOWN_AGENT', 'Agent ID is not allowed');
      if (relay.peers.has(agentId)) throw new ProtocolError('DUPLICATE_AGENT', 'Agent ID already has a connection');
      sockets.handleUpgrade(request, socket, head, client => {
        const peer = { send: (frame: string) => { if (client.readyState === WebSocket.OPEN) client.send(frame); } };
        relay.attach(agentId, peer);
        client.on('message', data => relay.route(agentId, data.toString()));
        client.on('close', () => relay.detach(agentId, peer));
        client.on('error', () => log('transport.error', { connectedAgentId: agentId, outcome: 'socket_error' }));
        peer.send(JSON.stringify({ kind: 'ready', agentId }));
      });
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : 'INVALID_MESSAGE';
      log('connection.rejected', { connectedAgentId: agentId, outcome: code });
      socket.end(`HTTP/1.1 409 ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Hub did not bind a TCP port');
  const port = address.port;
  log('hub.ready', { port, pid: process.pid, outcome: 'ready' });
  return {
    port,
    async close() {
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      server.closeIdleConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

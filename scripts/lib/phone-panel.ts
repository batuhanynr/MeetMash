import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { LogFields } from '../../packages/runtime/src/log.ts';
import calendar from '../../packages/protocol/fixtures/calendar-v1.json' with { type: 'json' };
import { ManagedProcess } from './processes.ts';

export const phoneAgents = [
  { id: 'agent-a', name: 'Ada', device: 'iPhone' },
  { id: 'agent-b', name: 'Ece', device: 'Mac' },
  { id: 'agent-c', name: 'Deniz', device: 'Mac' },
] as const;

type PanelEvent = { seq: number; at: string } & (
  { kind: 'online' | 'offline'; agent: string } |
  { kind: 'queued' | 'forwarded'; from: string; to: string; type: string; phase?: string; meeting: string }
);

export function phonePanel(options: { directory: string; certs: string; secrets: string }) {
  const host = '127.0.0.1';
  const port = 8790;
  const origin = `http://${host}:${port}`;
  const html = readFileSync(new URL('../phone-panel.html', import.meta.url));
  const icons = new Map(
    ['meetmesh-icon.svg', 'meetmesh-mark.svg'].map(name => [
      `/brand/${name}`, readFileSync(new URL(`../../assets/brand/${name}`, import.meta.url)),
    ]),
  );
  const hubAgents = new Set(phoneAgents.map(agent => String(agent.id)));
  const online = new Set<string>();
  const events: PanelEvent[] = [];
  const agents = new Map<string, ManagedProcess>();
  let seq = 0;
  let hub: string;
  let busy = false;
  let closing = false;
  const fixture = {
    ...calendar.window,
    zone: calendar.zone, durationMinutes: calendar.durationMinutes,
  };

  const startAgent = async (id: string) => {
    const agent = new ManagedProcess('agent-node', [
      '--id', id, '--hub', hub, '--state-root', options.directory,
      '--secrets', options.secrets, '--cert-dir', options.certs,
    ], false, 'm2-main');
    agents.set(id, agent);
    agent.child.once('exit', () => { if (agents.get(id) === agent) agents.delete(id); });
    try { await agent.ready; }
    catch (error) { await agent.stop(); throw error; }
  };

  const server = createServer(async (request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.host !== `${host}:${port}`) return json(403, { error: 'Panel yalnızca Mac üzerinden açılabilir.' });
    const icon = request.method === 'GET' ? icons.get(request.url ?? '') : undefined;
    if (icon) {
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' });
      response.end(icon);
      return;
    }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      });
      response.end(html);
      return;
    }
    if (request.method === 'GET' && request.url === '/state') {
      return json(200, { agents: phoneAgents.map(agent => ({ ...agent, online: online.has(agent.id) })), fixture, events });
    }
    if (request.method !== 'POST' || !['/invite', '/toggle-deniz'].includes(request.url ?? '')) return json(404, { error: 'Sayfa bulunamadı.' });
    if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
      return json(403, { error: 'İşlemi yerel panelden başlat.' });
    }
    request.resume();
    if (busy || closing) return json(409, { error: 'Önceki işlem sürüyor.' });
    busy = true;
    try {
      if (request.url === '/invite') {
        const ece = agents.get('agent-b');
        if (!ece || !online.has('agent-a') || !online.has('agent-b')) {
          return json(409, { error: 'Önce Ada ve Ece bağlanmalı.' });
        }
        await ece.command({
          command: 'schedule', meetingId: randomUUID(), participantAgentIds: phoneAgents.map(agent => agent.id),
          window: calendar.window, durationMinutes: calendar.durationMinutes,
        });
      } else {
        const deniz = agents.get('agent-c');
        if (deniz) await deniz.stop();
        else await startAgent('agent-c');
      }
      json(200, { ok: true });
    } catch (error) {
      console.error('Phone lab action failed:', error instanceof Error ? error.message : error);
      json(500, { error: 'İşlem tamamlanamadı. Mac’teki demo çıktısını kontrol et.' });
    } finally {
      busy = false;
    }
  });

  return {
    observe(event: string, fields: LogFields) {
      const at = new Date().toISOString();
      const { connectedAgentId, fromAgentId, toAgentId, messageType, phase, meetingId } = fields;
      if ((event === 'agent.online' || event === 'agent.offline') && typeof connectedAgentId === 'string' && hubAgents.has(connectedAgentId)) {
        const kind = event === 'agent.online' ? 'online' : 'offline';
        if (kind === 'online') online.add(connectedAgentId);
        else online.delete(connectedAgentId);
        events.push({ seq: ++seq, at, kind, agent: connectedAgentId });
      } else if ((event === 'message.queued' || event === 'message.forwarded') &&
        typeof fromAgentId === 'string' && hubAgents.has(fromAgentId) && typeof toAgentId === 'string' && hubAgents.has(toAgentId) &&
        typeof messageType === 'string' && typeof meetingId === 'string') {
        const kind = event === 'message.queued' ? 'queued' : 'forwarded';
        const previous = events.findLast(item => item.kind === kind && item.meeting === meetingId &&
          item.from === fromAgentId && item.to === toAgentId && item.type === messageType && item.phase === phase);
        // The planner retries while a person is deciding. Keep those pulses from hiding later stages.
        if (previous && Date.parse(at) - Date.parse(previous.at) < 5000) return;
        events.push({ seq: ++seq, at, kind,
          from: fromAgentId, to: toAgentId, type: messageType, meeting: meetingId,
          ...(typeof phase === 'string' ? { phase } : {}),
        });
      }
      if (events.length > 160) events.shift();
    },
    async start(hubUrl: string) {
      hub = hubUrl;
      for (const agent of phoneAgents) if (agent.device === 'Mac') await startAgent(agent.id);
      await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => { server.off('error', fail); done(); });
      });
      console.log(`Phone lab panel: ${origin}/`);
    },
    async close() {
      closing = true;
      for (const agent of agents.values()) await agent.stop();
      await new Promise<void>(done => server.close(() => done()));
    },
  };
}

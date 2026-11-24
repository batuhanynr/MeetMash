import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { get } from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CalendarProfile } from '../apps/agent-node/src/meetings/slots.ts';
import { loadCalendarAccounts } from '../apps/hub/src/calendar-accounts.ts';
import { createDatabase } from '../apps/hub/src/db.ts';
import { phonePanel, type PanelEvent } from './lib/phone-panel.ts';
import { defaultMeetingTitle } from '../packages/protocol/src/meeting-title.ts';

const catalog = process.env.MEETMESH_ACCOUNTS_FILE ?? join(homedir(), '.config/meetmesh/calendar-accounts.json');
const ca = readFileSync(join(process.env.CERT_DIR ?? '.state/m5-phone/certs', 'ca.crt'));
const healthUrl = new URL('/health', process.env.MEETMESH_PANEL_HUB ?? 'https://127.0.0.1:8792');
if (healthUrl.protocol !== 'https:') throw new Error('Use an HTTPS hub URL.');
const logPath = process.env.MEETMESH_PANEL_LOG ?? '.state/m5-calendars/service.log';
const mockRoot = process.env.MEETMESH_MOCK_STATE ?? '.state/m5-calendars/mock-agents';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL to the managed hub database.');
const database = createDatabase(databaseUrl);

function health(): Promise<{ agentIds: string[] } | null> {
  return new Promise(resolve => {
    const request = get(healthUrl, { ca, signal: AbortSignal.timeout(1500) }, async response => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of response) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        resolve(response.statusCode === 200 && Array.isArray(body.agentIds) ? body : null);
      } catch {
        resolve(null);
      }
    });
    request.on('error', () => resolve(null));
  });
}

function recentEvents(ids: Set<string>): PanelEvent[] {
  let fd: number;
  try { fd = openSync(logPath, 'r'); }
  catch { return []; }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, 96 * 1024);
    const data = Buffer.alloc(length);
    readSync(fd, data, 0, length, size - length);
    const events: PanelEvent[] = [];
    let offset = size - length;
    for (const line of data.toString('utf8').split('\n')) {
      offset += Buffer.byteLength(line) + 1;
      let row;
      try { row = JSON.parse(line); }
      catch { continue; }
      if (typeof row.timestamp !== 'string') continue;
      const base = { at: row.timestamp, seq: offset };
      if ((row.event === 'agent.online' || row.event === 'agent.offline') && ids.has(row.connectedAgentId)) {
        events.push({ ...base, kind: row.event === 'agent.online' ? 'online' : 'offline', agent: row.connectedAgentId });
      } else if ((row.event === 'message.queued' || row.event === 'message.forwarded') &&
          ids.has(row.fromAgentId) && ids.has(row.toAgentId) &&
          typeof row.messageType === 'string' && typeof row.meetingId === 'string') {
        events.push({
          ...base, kind: row.event === 'message.queued' ? 'queued' : 'forwarded',
          from: row.fromAgentId, to: row.toAgentId, type: row.messageType, meeting: row.meetingId,
          ...(typeof row.phase === 'string' ? { phase: row.phase } : {}),
        });
      }
    }
    return events.slice(-160);
  } finally { closeSync(fd); }
}

function mockCalendars(day: string) {
  const start = new Date(`${day}T00:00:00+03:00`);
  const end = new Date(+start + 86_400_000);
  const onDay = (slot: { start: string; end: string }) => Date.parse(slot.start) < +end && Date.parse(slot.end) > +start;
  const { mockAgents = [] } = loadCalendarAccounts(catalog);
  return mockAgents.map(agent => {
    const directory = join(mockRoot, agent.agentId);
    const path = join(directory, 'meetings.sqlite');
    let profile: CalendarProfile | undefined;
    let confirmed: { title: string; start: string; end: string; kind: string }[] = [];
    if (existsSync(path)) {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        profile = JSON.parse(String(db.prepare('SELECT data FROM calendar_config WHERE id=1').get()?.data));
        const hasTitle = db.prepare('PRAGMA table_info(calendar_events)').all().some(column => column.name === 'title');
        confirmed = db.prepare(`SELECT start,end${hasTitle ? ',title' : ''} FROM calendar_events
          WHERE julianday(start) < julianday(?) AND julianday(end) > julianday(?)`)
          .all(end.toISOString(), start.toISOString()).map(row => ({
            title: String(row.title ?? defaultMeetingTitle), start: String(row.start), end: String(row.end), kind: 'confirmed',
          }));
      } finally { db.close(); }
    } else {
      const seed = join(directory, 'calendar.json');
      if (existsSync(seed)) profile = JSON.parse(readFileSync(seed, 'utf8'));
    }
    const events = [
      ...(profile?.busy ?? []).filter(onDay).map(({ title, start, end }) => ({ title, start, end, kind: 'mock' })),
      ...confirmed,
    ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return { name: agent.displayName, events };
  });
}

const panel = phonePanel({ calendars: mockCalendars, state: async () => {
  const { accounts, mockAgents = [] } = loadCalendarAccounts(catalog);
  const roster = [
    ...accounts.map(agent => ({ ...agent, device: 'Mobil' })),
    ...mockAgents.map(agent => ({ ...agent, device: 'Mac' })),
  ];
  const ids = new Set(roster.map(agent => agent.agentId));
  const [hub, profiles] = await Promise.all([
    health(),
    database.query<{ agent_id: string; display_name: string }>(
      'SELECT agent_id,display_name FROM agent_profiles WHERE agent_id = ANY($1)', [[...ids]],
    ).then(result => result.rows, () => []),
  ]);
  const names = new Map(profiles.map(profile => [profile.agent_id, profile.display_name]));
  return {
    agents: roster.map(agent => ({
      id: agent.agentId, name: names.get(agent.agentId) ?? agent.displayName,
      device: agent.device, online: hub?.agentIds.includes(agent.agentId) ?? false,
    })),
    hubOnline: hub !== null,
    events: recentEvents(ids),
  };
} });
try {
  await panel.start();
} catch (error) {
  await database.end();
  throw error;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await panel.close();
    await database.end();
  });
}

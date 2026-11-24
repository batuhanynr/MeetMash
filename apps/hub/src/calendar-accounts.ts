import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { normalizeMeetingTitle } from '../../../packages/protocol/src/meeting-title.ts';
import { pairId } from '../../../packages/protocol/src/mac.ts';
import type { Database } from './db.ts';
import { calendarTitle, exchangeGoogleToken, GoogleAuthorizationRequired, googleRequest, loadGoogleClient, readPrivateJson } from './google-calendar.ts';
import { hashSecret, randomToken, verifySecret } from './secrets.ts';

export type CalendarAccount = {
  agentId: string; email: string; displayName: string; passwordHash: string;
  bootstrap: string; calendarId: string; refreshToken: string;
};
type MockCalendarAgent = Pick<CalendarAccount, 'agentId' | 'displayName' | 'bootstrap'>;
export type CalendarAccountsFile = {
  accounts: CalendarAccount[]; mockAgents?: MockCalendarAgent[]; pairKeys: Record<string, string>;
};
export const validAgentId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const derivedHash = /^[a-f0-9]{32}:[a-f0-9]{64}$/;
const randomKey = /^[a-f0-9]{64}$/;
const derive = promisify(scrypt);

export function loadCalendarAccounts(path: string): CalendarAccountsFile {
  const data = readPrivateJson(path) as CalendarAccountsFile;
  if (!data || !Array.isArray(data.accounts) || !data.pairKeys || typeof data.pairKeys !== 'object') {
    throw new Error('Invalid MeetMesh calendar account catalog.');
  }
  const emails = new Set<string>(), ids = new Set<string>(), calendars = new Set<string>();
  for (const a of data.accounts) {
    if (!a || typeof a.agentId !== 'string' || !validAgentId.test(a.agentId) || typeof a.email !== 'string' || a.email !== a.email.toLowerCase() ||
        !validEmail.test(a.email) || a.email.length > 254 || typeof a.displayName !== 'string' ||
        !a.displayName.trim() || a.displayName.length > 100 || !derivedHash.test(a.passwordHash) ||
        !randomKey.test(a.bootstrap) || typeof a.calendarId !== 'string' || !a.calendarId ||
        ['.', '..', 'primary'].includes(a.calendarId) || a.calendarId.toLowerCase() === a.email ||
        typeof a.refreshToken !== 'string' || !a.refreshToken ||
        emails.has(a.email) || ids.has(a.agentId) || calendars.has(a.calendarId)) {
      throw new Error('Invalid or duplicate MeetMesh calendar account.');
    }
    emails.add(a.email);
    ids.add(a.agentId);
    calendars.add(a.calendarId);
  }
  if (data.mockAgents !== undefined && !Array.isArray(data.mockAgents)) throw new Error('Invalid mock calendar agents.');
  for (const agent of data.mockAgents ?? []) {
    if (!agent || typeof agent.agentId !== 'string' || !validAgentId.test(agent.agentId) ||
        ids.has(agent.agentId) || typeof agent.displayName !== 'string' || !agent.displayName.trim() ||
        agent.displayName.length > 100 || typeof agent.bootstrap !== 'string' || !randomKey.test(agent.bootstrap)) {
      throw new Error('Invalid or duplicate mock calendar agent.');
    }
    ids.add(agent.agentId);
  }
  const peers = [...ids];
  for (const [index, id] of peers.entries()) {
    for (const peer of peers.slice(0, index)) {
      if (!randomKey.test(data.pairKeys[pairId(id, peer)] ?? '')) throw new Error('Missing MeetMesh calendar account pair key.');
    }
  }
  return data;
}

export class CalendarAccounts {
  private readonly byAgent: Map<string, CalendarAccount>;
  private readonly byEmail: Map<string, CalendarAccount>;
  private readonly accounts: CalendarAccountsFile;
  private readonly oauth: ReturnType<typeof loadGoogleClient>;
  private readonly dummyHash = hashSecret(randomToken());
  private readonly tokens = new Map<string, { expires: number; token: Promise<string> }>();
  private readonly attempts = new Map<string, number>();
  private attemptsUntil = 0;
  private loggingIn = 0;

  constructor(accounts: CalendarAccountsFile, oauth: ReturnType<typeof loadGoogleClient>) {
    this.accounts = accounts;
    this.oauth = oauth;
    this.byAgent = new Map(accounts.accounts.map(a => [a.agentId, a]));
    this.byEmail = new Map(accounts.accounts.map(a => [a.email, a]));
  }

  keysFor(agentId: string): Record<string, string> | undefined {
    if (!this.byAgent.has(agentId)) return;
    const ids = [...this.byAgent.keys(), ...(this.accounts.mockAgents ?? []).map(agent => agent.agentId)];
    return Object.fromEntries(ids.filter(id => id !== agentId).map(id => {
      const keyId = pairId(id, agentId);
      return [keyId, this.accounts.pairKeys[keyId]!];
    }));
  }

  async provision(database: Database): Promise<void> {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      for (const a of [...this.byAgent.values(), ...(this.accounts.mockAgents ?? [])]) {
        const userId = `${this.byAgent.has(a.agentId) ? 'calendar' : 'mock-calendar'}:${a.agentId}`;
        await client.query('INSERT INTO agent_identities(agent_id,user_id,bootstrap_secret_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [a.agentId, userId, hashSecret(a.bootstrap)]);
        const { rows } = await client.query('SELECT user_id,bootstrap_secret_hash FROM agent_identities WHERE agent_id=$1', [a.agentId]);
        if (rows[0]?.user_id !== userId || !verifySecret(a.bootstrap, rows[0].bootstrap_secret_hash)) {
          throw new Error(`Calendar account conflicts with an existing identity: ${a.agentId}`);
        }
        await client.query("INSERT INTO agent_profiles(agent_id,display_name,visibility) VALUES ($1,$2,'public') ON CONFLICT DO NOTHING",
          [a.agentId, a.displayName]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const reply = (status: number, data: unknown) => {
      response.writeHead(status, { 'cache-control': 'no-store' }).end(JSON.stringify(data));
    };
    if (request.method !== 'POST') { reply(405, { code: 'METHOD_NOT_ALLOWED' }); return; }
    if (request.headers['content-type'] !== 'application/json') { reply(415, { code: 'INVALID_CONTENT_TYPE' }); return; }
    if (Number(request.headers['content-length']) > 4096) { reply(413, { code: 'REQUEST_TOO_LARGE' }); return; }
    const ip = request.socket.remoteAddress ?? '';
    if (Date.now() >= this.attemptsUntil) {
      this.attempts.clear();
      this.attemptsUntil = Date.now() + 60_000;
    }
    const attempts = this.attempts.get(ip) ?? 0;
    if (attempts >= 12 || this.attempts.size >= 512 && !this.attempts.has(ip) || this.loggingIn >= 4) {
      reply(429, { code: 'TRY_LATER' });
      return;
    }
    this.attempts.set(ip, attempts + 1);
    this.loggingIn++;
    const deadline = setTimeout(() => request.destroy(), 5000);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > 4096) { request.destroy(); return; }
        chunks.push(chunk);
      }
      clearTimeout(deadline);
      const { email, password } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 256) {
        reply(400, { code: 'INVALID_LOGIN' });
        return;
      }
      const account = this.byEmail.get(email.trim().toLowerCase());
      const [salt, hash] = (account?.passwordHash ?? this.dummyHash).split(':') as [string, string];
      const key = await derive(password, Buffer.from(salt, 'hex'), 32) as Buffer;
      if (!timingSafeEqual(key, Buffer.from(hash, 'hex')) || !account) { reply(401, { code: 'LOGIN_FAILED' }); return; }
      reply(200, { agentId: account.agentId, secret: account.bootstrap, calendar: 'managed', calendarName: calendarTitle, email: account.email, pairKeys: this.keysFor(account.agentId) });
    } catch {
      if (!response.destroyed && !response.headersSent) reply(400, { code: 'INVALID_LOGIN' });
    } finally {
      clearTimeout(deadline);
      this.loggingIn--;
    }
  }

  handle = async (agentId: string, frame: { kind: string; [key: string]: unknown }) => {
    if (frame.kind !== 'calendar.request') return;
    const result = (status: number, body: unknown = {}) => ({ kind: 'calendar.result', requestId: frame.requestId, status, body });
    const account = this.byAgent.get(agentId);
    if (!account) return result(403);
    const request = calendarRequest(account.calendarId, agentId, frame);
    if (!request) return result(400);
    try {
      const response = await googleRequest(await this.token(account), request.path, request.method, request.body);
      if (response.status === 401) this.tokens.delete(agentId);
      if (response.status === 200 && frame.operation === 'busy') {
        const body = await response.json();
        const busy = body.calendars?.[account.calendarId];
        if (busy?.errors?.length || !Array.isArray(busy?.busy)) return result(503);
        // The Dart adapter uses a logical alias for the one selected calendar.
        return result(200, { calendars: { primary: { busy: busy.busy } } });
      }
      if (!response.ok) return result(response.status);
      return result(response.status, await response.json());
    } catch (error) { return result(error instanceof GoogleAuthorizationRequired ? 401 : 503); }
  };

  private token(account: CalendarAccount): Promise<string> {
    const cached = this.tokens.get(account.agentId);
    if (cached && cached.expires > Date.now()) return cached.token;
    const entry = { expires: Infinity, token: this.refresh(account).then(result => {
      entry.expires = result.expires;
      return result.value;
    }, error => {
      this.tokens.delete(account.agentId);
      throw error;
    }) };
    this.tokens.set(account.agentId, entry);
    return entry.token;
  }

  private async refresh(account: CalendarAccount) {
    const result = await exchangeGoogleToken(this.oauth, { grant_type: 'refresh_token', refresh_token: account.refreshToken });
    return { value: result.access_token, expires: Date.now() + Math.max(0, (result.expires_in ?? 0) - 60) * 1000 };
  }
}

const eventId = /^[a-f0-9]{64}$/;
const rfc3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/;
const time = (value: unknown) => typeof value === 'string' && rfc3339.test(value) ? Date.parse(value) : NaN;

export function calendarRequest(calendarId: string, agentId: string, frame: Record<string, unknown>):
  { path: string; method?: string; body?: unknown } | undefined {
  const path = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const { operation, id, start, end, zone, pageToken, meeting, title } = frame;
  if (operation === 'event' && typeof id === 'string' && eventId.test(id)) {
    return { path: `${path}/${id}?fields=status,start,end,extendedProperties%28private%28meetmesh%29%29` };
  }
  const from = time(start), to = time(end);
  const maxHours = operation === 'events' ? 32 * 24 : 64;
  if (!(from < to && to - from <= maxHours * 60 * 60 * 1000)) return;
  if (operation === 'busy') {
    return { path: '/calendar/v3/freeBusy', method: 'POST', body: { timeMin: start, timeMax: end, items: [{ id: calendarId }] } };
  }
  if (operation === 'events' && typeof zone === 'string' && zone.length <= 80 && /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone) &&
      (pageToken === undefined || typeof pageToken === 'string' && pageToken.length <= 4096)) {
    const query = new URLSearchParams({ timeMin: String(start), timeMax: String(end), timeZone: zone,
      singleEvents: 'true', maxResults: '100', fields: 'nextPageToken,items(summary,start,end)' });
    if (pageToken) query.set('pageToken', pageToken);
    return { path: `${path}?${query}` };
  }
  if (operation === 'insert' && typeof meeting === 'string' && meeting.length > 0 && meeting.length <= 128 && to - from <= 24 * 60 * 60 * 1000 && (title === undefined || typeof title === 'string')) {
    const id = createHash('sha256').update(JSON.stringify([agentId, meeting])).digest('hex');
    return { path: `${path}?fields=id`, method: 'POST', body: {
      id, summary: normalizeMeetingTitle(title), start: { dateTime: start }, end: { dateTime: end }, extendedProperties: { private: { meetmesh: id } },
    } };
  }
}

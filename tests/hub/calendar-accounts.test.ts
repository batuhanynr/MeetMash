import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { CalendarAccounts, type CalendarAccount } from '../../apps/hub/src/calendar-accounts.ts';
import { findTestCalendar } from '../../apps/hub/src/google-calendar.ts';
import { hashSecret } from '../../apps/hub/src/secrets.ts';

test('MeetMesh login verifies the password and keeps the Google grant on the hub', async () => {
  const service = new CalendarAccounts({ accounts: [{
    agentId: 'fatma', email: 'fatma@example.test', displayName: 'Fatma', bootstrap: 'agent-bootstrap',
    calendarId: 'private-calendar', refreshToken: 'private-token', passwordHash: hashSecret('test-password'),
  }], pairKeys: {} }, { client_id: 'test-client', client_secret: 'test-secret' });
  async function login(email: string, password: string) {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({ email, password }))]), {
      method: 'POST', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' },
    });
    let status: number | undefined, body: unknown;
    const response = { writeHead(code: number) { status = code; return this; }, end(value: string) { body = JSON.parse(value); } };
    await service.login(request as unknown as IncomingMessage, response as unknown as ServerResponse);
    return { status, body };
  }
  assert.deepEqual(await login(' Fatma@EXAMPLE.TEST ', 'test-password'), { status: 200, body: {
    agentId: 'fatma', email: 'fatma@example.test', calendar: 'managed', calendarName: 'Meetmash Takvimim', secret: 'agent-bootstrap', pairKeys: {},
  } });
  assert.deepEqual(await login('fatma@example.test', 'wrong'), { status: 401, body: { code: 'LOGIN_FAILED' } });
  assert.deepEqual(await login('unknown@example.test', 'test-password'), { status: 401, body: { code: 'LOGIN_FAILED' } });
});

test('Google account verification selects the owned secondary calendar across pages', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('/userinfo')) return Response.json({ email: 'fatma@example.test', verified_email: true });
    const page = new URL(url).searchParams.get('pageToken');
    return Response.json(page ? { items: [
      { id: 'fatma-calendar', summary: 'Meetmash Takvimim', accessRole: 'owner' },
    ] } : { nextPageToken: '2', items: [
      { id: 'fatma@example.test', primary: true, summary: 'Meetmash Takvimim', accessRole: 'owner' },
      { id: 'shared-calendar', summary: 'Meetmash Takvimim', accessRole: 'writer' },
    ] });
  });
  assert.equal(await findTestCalendar('test-token', 'fatma@example.test'), 'fatma-calendar');
  assert.equal(fetch.mock.callCount(), 3);
  await assert.rejects(findTestCalendar('test-token', 'batuhan@example.test'), /email must match/);
  assert.equal(fetch.mock.callCount(), 4);
});

test('calendar control scopes Google tokens, reads, writes and pair keys to the authenticated agent', async t => {
  const account = (agentId: string): CalendarAccount => ({
    agentId, email: `${agentId}@example.test`, displayName: agentId, passwordHash: '', bootstrap: '',
    calendarId: `${agentId}@group.calendar.google.com`, refreshToken: `${agentId}-refresh`,
  });
  const accounts = new CalendarAccounts({
    accounts: ['batuhan', 'fatma', 'other'].map(account),
    pairKeys: { 'batuhan:fatma': 'shared', 'batuhan:other': 'never-return', 'fatma:other': 'other-pair' },
  }, { client_id: 'test-client', client_secret: 'test-secret' });
  assert.deepEqual(accounts.keysFor('fatma'), { 'batuhan:fatma': 'shared', 'fatma:other': 'other-pair' });
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const own = 'fatma@group.calendar.google.com';
  let refreshes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      refreshes++;
      assert.equal((init.body as URLSearchParams).get('refresh_token'), 'fatma-refresh');
      return Response.json({ access_token: 'fatma-token', expires_in: 3600 });
    }
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fatma-token');
    calls.push({ path: new URL(url).pathname, method: init.method ?? '', ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return Response.json(url.endsWith('freeBusy') ? { calendars: { [own]: { busy: [] } } } : {});
  });
  const frame = {
    kind: 'calendar.request', requestId: '1', start: '2026-11-21T07:00:00Z', end: '2026-11-21T08:00:00Z',
    agentId: 'batuhan', calendarId: 'primary', attendees: [{ email: 'someone@example.test' }],
  };
  const [busy, events, insert, unauthorized] = await Promise.all([
    accounts.handle('fatma', { ...frame, operation: 'busy' }),
    accounts.handle('fatma', { ...frame, operation: 'events', zone: 'Europe/Istanbul' }),
    accounts.handle('fatma', { ...frame, operation: 'insert', meeting: 'my-meeting' }),
    accounts.handle('not-enrolled', { ...frame, operation: 'busy' }),
  ]);
  assert.equal(unauthorized?.status, 403);
  assert.equal(events?.status, 200);
  assert.equal(insert?.status, 200);
  assert.deepEqual(busy?.body, { calendars: { primary: { busy: [] } } });
  assert.equal(refreshes, 1);
  const selectedPath = '/calendar/v3/calendars/' + encodeURIComponent(own) + '/events';
  assert.deepEqual(calls.find(c => c.path.endsWith('freeBusy'))?.body, { timeMin: frame.start, timeMax: frame.end, items: [{ id: own }] });
  assert.ok(calls.some(c => c.path === selectedPath && c.method === 'GET'));
  const written = calls.find(c => c.path === selectedPath && c.method === 'POST')?.body as Record<string, unknown>;
  assert.ok(written);
  assert.equal(written.attendees, undefined);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadCalendarAccounts } from '../apps/hub/src/calendar-accounts.ts';
import { exchangeGoogleToken, findTestCalendar, googleClientPath, googleRequest, loadGoogleClient } from '../apps/hub/src/google-calendar.ts';

const schedules = {
  batuhan: [
    ['Sprint planlama', '10:00', '11:00'],
    ['Proje geliştirme', '14:00', '15:30'],
    ['Yüzme antrenmanı', '18:30', '19:30'],
    ['Tasarım değerlendirmesi', '11:00', '12:00'],
    ['Fotoğraf kulübü', '16:00', '17:30'],
    ['Sahilde koşu', '09:30', '10:30'],
  ],
  fatma: [
    ['Araştırma semineri', '11:00', '12:00'],
    ['Kütüphane çalışması', '09:30', '11:00'],
    ['Seramik atölyesi', '16:30', '18:00'],
    ['Gönüllü ekip buluşması', '13:00', '14:30'],
    ['İngilizce konuşma kulübü', '15:00', '16:30'],
    ['Kitap kulübü', '14:00', '15:30'],
  ],
} as const;

const zone = 'Europe/Istanbul';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(new Date());
const end = `${today.slice(0, 4)}-12-31`;
const catalog = loadCalendarAccounts(process.env.MEETMESH_ACCOUNTS_FILE ?? join(homedir(), '.config/meetmesh/calendar-accounts.json'));
const oauth = loadGoogleClient(googleClientPath());
const accounts = await Promise.all((['batuhan', 'fatma'] as const).map(async agentId => {
  const account = catalog.accounts.find(a => a.agentId === agentId);
  assert(account, `Missing demo account: ${agentId}`);
  const token = await exchangeGoogleToken(oauth, { grant_type: 'refresh_token', refresh_token: account.refreshToken });
  const calendarId = await findTestCalendar(token.access_token, account.email);
  assert.equal(calendarId, account.calendarId, `Linked calendar changed for ${agentId}`);
  return { agentId, token: token.access_token, calendarId };
}));
assert.equal(new Set(accounts.map(a => a.calendarId)).size, accounts.length);

for (const { agentId, token, calendarId } of accounts) {
  const events = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  let verified = 0;
  for (const cursor = new Date(today); cursor.toISOString().slice(0, 10) <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    if (weekday === 0) continue;
    const [activity, from, to] = schedules[agentId][weekday - 1]!;
    const id = createHash('sha256').update(`meetmesh-demo-v1:${agentId}:${day}`).digest('hex');
    const summary = `[Demo] ${activity}`;
    const result = await googleRequest(token, `${events}?sendUpdates=none&fields=id,summary`, 'POST', {
      id, summary, start: { dateTime: `${day}T${from}:00+03:00`, timeZone: zone },
      end: { dateTime: `${day}T${to}:00+03:00`, timeZone: zone },
      reminders: { useDefault: false },
    });
    const stored = result.status === 409
      ? await googleRequest(token, `${events}/${id}?fields=id,summary,status`)
      : result;
    assert(stored.ok, `Could not seed ${agentId} on ${day} (Google HTTP ${stored.status})`);
    const event = await stored.json();
    assert(event.id === id && event.summary === summary && event.status !== 'cancelled', `Unexpected demo event for ${agentId} on ${day}`);
    verified++;
  }
  console.log(`${agentId}: ${verified} demo events verified (${today} – ${end}, ${zone})`);
}

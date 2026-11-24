import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadCalendarAccounts, validAgentId, validEmail, type CalendarAccount, type CalendarAccountsFile } from '../apps/hub/src/calendar-accounts.ts';
import { calendarScopes, exchangeGoogleToken, findTestCalendar, googleClientPath, loadGoogleClient } from '../apps/hub/src/google-calendar.ts';
import { hashSecret, randomToken } from '../apps/hub/src/secrets.ts';
import { pairId } from '../packages/protocol/src/mac.ts';

const redirect = 'http://127.0.0.1:8791/google/callback';
const [agentId = '', inputEmail = '', name = '', ...extra] = process.argv.slice(2);
const email = inputEmail.trim().toLowerCase(), displayName = name.trim();
if (!validAgentId.test(agentId) || !validEmail.test(email) || email.length > 254 || !displayName || displayName.length > 100 || extra.length) {
  throw new Error('Usage: node scripts/connect-calendar.ts <agent-id> <google-email> <display-name>');
}
const catalog = resolve(process.env.MEETMESH_ACCOUNTS_FILE ?? join(homedir(), '.config/meetmesh/calendar-accounts.json'));
const oauth = loadGoogleClient(googleClientPath());
const load = (): CalendarAccountsFile => existsSync(catalog) ? loadCalendarAccounts(catalog) : { accounts: [], pairKeys: {} };
function existing(data: CalendarAccountsFile) {
  if (data.mockAgents?.some(a => a.agentId === agentId)) throw new Error('This agent ID belongs to a mock agent.');
  const account = data.accounts.find(a => a.agentId === agentId || a.email === email);
  if (account && (account.agentId !== agentId || account.email !== email)) throw new Error('Email and agent ID must match the existing account.');
  return account;
}
existing(load());

const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({
  client_id: oauth.client_id, redirect_uri: redirect, response_type: 'code', login_hint: email,
  access_type: 'offline', prompt: 'consent', scope: calendarScopes.join(' '), state,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
}).toString();

const code = await new Promise<string>((done, fail) => {
  const timeout = setTimeout(() => finish(undefined, 'Google authorization timed out.'), 600_000);
  const server = createServer((request, response) => {
    const url = URL.parse(request.url ?? '/', redirect);
    if (request.method !== 'GET' || !url || url.origin !== 'http://127.0.0.1:8791' || url.pathname !== '/google/callback' ||
        request.headers.host !== '127.0.0.1:8791' || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid Google authorization callback.');
      return;
    }
    const code = url.searchParams.get('code');
    response.writeHead(code ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      .end('MeetMesh kurulum sonucunu Terminal’den kontrol et.');
    finish(code ?? undefined, 'Google calendar permission was declined.');
  });
  function finish(code?: string, problem?: string) {
    clearTimeout(timeout);
    server.close();
    if (code) done(code);
    else fail(new Error(problem));
  }
  server.once('error', error => finish(undefined, error.message));
  server.listen(8791, '127.0.0.1', () => console.log(`Open this URL on this Mac to permit Google Calendar access:\n${auth}`));
});
const token = await exchangeGoogleToken(oauth, { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
if (!token.refresh_token) throw new Error('Google did not issue offline access. Repeat authorization.');
const scopes = new Set(token.scope?.split(' '));
const missingScopes = calendarScopes.slice(1).filter(scope => !scopes.has(scope));
if (missingScopes.length) {
  throw new Error('Missing Google Calendar permissions: ' + missingScopes.map(scope => scope.split('/').at(-1)).join(', '));
}
const calendarId = await findTestCalendar(token.access_token, email);

mkdirSync(dirname(catalog), { recursive: true, mode: 0o700 });
const lock = `${catalog}.lock`;
mkdirSync(lock, { mode: 0o700 });
try {
  const data = load();
  const prior = existing(data);
  if (prior && prior.calendarId !== calendarId) throw new Error('The selected calendar ID has changed. Provision a fresh agent before using a different calendar.');
  if (data.accounts.some(a => a.agentId !== agentId && a.calendarId === calendarId)) throw new Error('This calendar belongs to another MeetMesh account.');
  const password = prior ? undefined : randomBytes(18).toString('base64url');
  const account: CalendarAccount = {
    agentId, email, displayName, calendarId, refreshToken: token.refresh_token,
    passwordHash: prior?.passwordHash ?? hashSecret(password!), bootstrap: prior?.bootstrap ?? randomToken(),
  };
  for (const peer of [...data.accounts, ...(data.mockAgents ?? [])]) {
    if (peer.agentId !== agentId) data.pairKeys[pairId(agentId, peer.agentId)] ??= randomToken();
  }
  data.accounts = [...data.accounts.filter(a => a.agentId !== agentId), account];
  const staging = join(lock, 'accounts.json');
  writeFileSync(staging, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  loadCalendarAccounts(staging);
  if (password) {
    const passwordPath = join(dirname(catalog), `meetmesh-password-${agentId}.txt`);
    writeFileSync(passwordPath, password + '\n', { mode: 0o600, flag: 'wx' });
    try { renameSync(staging, catalog); }
    catch (error) { rmSync(passwordPath); throw error; }
    console.log(`MeetMesh password saved to ${passwordPath}`);
  } else {
    renameSync(staging, catalog);
  }
  console.log('Calendar linked. Start or restart the managed MeetMesh hub to load the account.');
} finally { rmSync(lock, { recursive: true }); }

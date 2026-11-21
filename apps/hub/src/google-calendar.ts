import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const calendarTitle = 'Meetmash Takvimim';
export const googleClientPath = () => process.env.MEETMESH_GOOGLE_OAUTH_FILE ?? join(homedir(), '.config/meetmash/google-oauth-web.json');
export const calendarScopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export function readPrivateJson(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
      throw new Error('MeetMesh credential files must be private files owned by the hub user (chmod 600).');
    }
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}

type OAuthClient = { client_id: string; client_secret: string };
type GoogleToken = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
export class GoogleAuthorizationRequired extends Error {}

export function loadGoogleClient(path: string): OAuthClient {
  const data = readPrivateJson(path) as { web?: OAuthClient; installed?: OAuthClient };
  const client = data.web ?? data.installed;
  if (!client?.client_id || !client.client_secret) throw new Error('Google OAuth client JSON is missing the client ID or secret.');
  return client;
}

export async function exchangeGoogleToken(client: OAuthClient, parameters: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ ...client, ...parameters }),
    signal: AbortSignal.timeout(8_000), redirect: 'error',
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    const message = 'Google authorization failed. Check the OAuth client and repeat calendar authorization.';
    if (failure?.error === 'invalid_grant') throw new GoogleAuthorizationRequired(message);
    throw new Error(message);
  }
  const token = await response.json() as GoogleToken;
  if (!token.access_token) throw new Error('Google did not issue an access token.');
  return { ...token, access_token: token.access_token };
}

export function googleRequest(accessToken: string, path: string, method = 'GET', body?: unknown) {
  return fetch(`https://www.googleapis.com${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function findTestCalendar(accessToken: string, expectedEmail: string): Promise<string> {
  const profile = await googleRequest(accessToken, '/oauth2/v2/userinfo');
  if (!profile.ok) throw new Error('Could not verify the Google account.');
  const user = await profile.json() as { email?: string; verified_email?: boolean };
  if (!user.verified_email || user.email?.toLowerCase() !== expectedEmail) {
    throw new Error('The verified Google email must match the MeetMesh email.');
  }
  const ids = new Set<string>();
  const pages = new Set<string>();
  const query = new URLSearchParams({
    minAccessRole: 'owner', showHidden: 'true',
    fields: 'nextPageToken,items(id,summary,primary,accessRole)',
  });
  for (;;) {
    const response = await googleRequest(accessToken, `/calendar/v3/users/me/calendarList?${query}`);
    if (!response.ok) throw new Error('Could not read the Google calendar list.');
    const page = await response.json() as {
      items?: { id: string; summary?: string; primary?: boolean; accessRole?: string }[];
      nextPageToken?: string;
    };
    for (const item of page.items ?? []) {
      if (item.summary === calendarTitle && item.accessRole === 'owner' && !item.primary && item.id) ids.add(item.id);
    }
    if (!page.nextPageToken) break;
    if (pages.has(page.nextPageToken)) throw new Error('Google returned a repeated calendar page.');
    pages.add(page.nextPageToken);
    query.set('pageToken', page.nextPageToken);
  }
  if (ids.size !== 1) throw new Error(`The Google account must own exactly one secondary calendar named ${calendarTitle}.`);
  return [...ids][0]!;
}

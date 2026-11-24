import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CalendarProfile } from '../apps/agent-node/src/meetings/slots.ts';
import { loadCalendarAccounts } from '../apps/hub/src/calendar-accounts.ts';
import { randomToken } from '../apps/hub/src/secrets.ts';
import { pairId } from '../packages/protocol/src/mac.ts';

const catalogPath = resolve(process.env.MEETMESH_ACCOUNTS_FILE ?? join(homedir(), '.config/meetmesh/calendar-accounts.json'));
const root = resolve(process.env.MEETMESH_MOCK_STATE ?? '.state/m5-calendars/mock-agents');
const lock = catalogPath + '.lock';
mkdirSync(lock, { mode: 0o700 });
try {
  const catalog = loadCalendarAccounts(catalogPath);
  if (!catalog.accounts.length) throw new Error('Connect a Google test account first.');
  catalog.mockAgents ??= [];
  for (const [agentId, displayName] of [['ege', 'Ferhat'], ['deniz', 'Elif']] as const) {
    if (catalog.accounts.some(account => account.agentId === agentId)) throw new Error(`Google account already uses ${agentId}.`);
    const existing = catalog.mockAgents.find(agent => agent.agentId === agentId);
    if (existing) existing.displayName = displayName;
    else {
      catalog.mockAgents.push({ agentId, displayName, bootstrap: randomToken() });
    }
  }
  const peers = [...catalog.accounts, ...catalog.mockAgents];
  for (const [index, account] of peers.entries()) {
    for (const peer of peers.slice(0, index)) catalog.pairKeys[pairId(account.agentId, peer.agentId)] ??= randomToken();
  }

  const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Istanbul', year: 'numeric' }).format(new Date());
  for (const agent of catalog.mockAgents.filter(agent => ['ege', 'deniz'].includes(agent.agentId))) {
    const { agentId, bootstrap } = agent;
    const directory = join(root, agentId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keys = Object.fromEntries(peers.filter(peer => peer.agentId !== agentId).map(peer => {
      const id = pairId(agentId, peer.agentId);
      return [id, catalog.pairKeys[id]];
    }));
    const profile: CalendarProfile = { working: [], busy: [], preferences: [] };
    for (const day = new Date(`${year}-01-01`); day.getUTCFullYear() === Number(year); day.setUTCDate(day.getUTCDate() + 1)) {
      const date = day.toISOString().slice(0, 10);
      const at = (time: string) => new Date(`${date}T${time}:00+03:00`).toISOString();
      profile.working.push({ start: at('09:00'), end: at('20:00') });
      if (day.getUTCDay() === 0) continue;
      const [title, start, end] = agentId === 'ege'
        ? ['Proje çalışması', '10:00', '11:30']
        : ['Atölye', '15:00', '16:30'];
      profile.busy.push({ title, start: at(start!), end: at(end!), description: 'Demo etkinliği' });
    }
    for (const [name, content] of [
      ['secrets.json', { bootstrap: { [agentId]: bootstrap }, pairKeys: keys }],
      ['calendar.json', profile],
    ] as const) {
      const tmp = join(directory, `.${name}.${process.pid}`);
      writeFileSync(tmp, JSON.stringify(content) + '\n', { mode: 0o600, flag: 'wx' });
      renameSync(tmp, join(directory, name));
    }
    console.log(`Prepared ${agent.displayName} in ${directory}`);
  }
  const staging = join(lock, 'accounts.json');
  writeFileSync(staging, JSON.stringify(catalog, null, 2) + '\n', { mode: 0o600 });
  loadCalendarAccounts(staging);
  renameSync(staging, catalogPath);
} finally {
  rmSync(lock, { recursive: true });
}

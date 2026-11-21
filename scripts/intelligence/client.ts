import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { M2Transport } from '../../apps/agent-node/src/m2-transport.ts';
import { loadSecrets } from '../../apps/agent-node/src/m2-security.ts';

// Pass a separately provisioned demo identity; connecting rotates that identity's hub session.
const [command, agentId, ...parts] = process.argv.slice(2);
const text = parts.join(' ').trim();
if ((command !== 'preview' && command !== 'semantic') || !agentId || !text) throw new Error('Use preview|semantic <agentId> "<text>"');
const secret = loadSecrets(process.env.SECRETS_FILE ?? '.state/secrets.json').bootstrap[agentId];
if (!secret) throw new Error('Missing demo credential');
const url = new URL(process.env.HUB_URL ?? 'wss://localhost:8787');
if (url.protocol !== 'wss:') throw new Error('Use a wss:// hub');
const transport = new M2Transport(url, agentId, secret, readFileSync(join(process.env.CERT_DIR ?? '.state/certs','ca.crt')), () => {});
const requestId = randomUUID();
let resolveReply!: (frame: unknown) => void, rejectReply!: (error: Error) => void;
const reply = new Promise<unknown>((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  await transport.connect(() => {}, frame => { if (frame.requestId === requestId) resolveReply(frame); }, () => rejectReply(new Error('Hub disconnected')));
  timer = setTimeout(() => rejectReply(new Error('Hub reply timed out')), 70_000);
  transport.sendControl(command === 'preview' ? { kind: 'meeting.preview', requestId, text, timeZone: process.env.MEETING_TIME_ZONE ?? 'Europe/Istanbul' }
    : { kind: 'directory.lookup', requestId, by: 'semantic', term: text });
  console.log(JSON.stringify(await reply, null, 2));
} finally { clearTimeout(timer); transport.close(); }

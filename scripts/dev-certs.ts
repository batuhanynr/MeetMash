import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Generates a local development CA and a hub certificate for wss://. Output lives under
// .state/certs (gitignored) and is never committed. Agents trust this CA explicitly.
const directory = resolve(process.env.CERT_DIR ?? '.state/certs');
mkdirSync(directory, { recursive: true });
const file = (name: string) => join(directory, name);
const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] });

if (existsSync(file('hub.crt')) && !process.env.CERT_FORCE) {
  console.log(`Dev certificates already present in ${directory}. Set CERT_FORCE=1 to regenerate.`);
  process.exit(0);
}

openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-sha256',
  '-keyout', file('ca.key'), '-out', file('ca.crt'), '-subj', '/CN=MeetMesh Dev CA']);

openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
  '-keyout', file('hub.key'), '-out', file('hub.csr'), '-subj', '/CN=localhost']);

// The SAN extension is passed on stdin so no temp extfile is left behind.
execFileSync('openssl', ['x509', '-req', '-in', file('hub.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'),
  '-CAcreateserial', '-days', '825', '-sha256', '-out', file('hub.crt'), '-extfile', '/dev/stdin'],
  { input: 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1', stdio: ['pipe', 'ignore', 'inherit'] });

console.log(`Dev CA and hub certificate written to ${directory} (ca.crt, hub.crt, hub.key).`);

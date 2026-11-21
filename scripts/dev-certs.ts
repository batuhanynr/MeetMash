import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';

// Generates a local development CA and a hub certificate for wss://. Output lives under
// .state/certs (gitignored) and is never committed. Agents trust this CA explicitly.
const directory = resolve(process.env.CERT_DIR ?? '.state/certs');
const additionalHost = process.env.CERT_EXTRA_HOST;
const altNames = ['DNS:localhost', 'DNS:hub-data', 'IP:127.0.0.1', 'IP:::1'];
if (additionalHost) {
  if (isIP(additionalHost)) altNames.push('IP:' + additionalHost);
  else if (/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(additionalHost)) altNames.push('DNS:' + additionalHost);
  else throw new Error('CERT_EXTRA_HOST must be a DNS hostname or IP address');
}
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
  '-CAcreateserial', '-days', '365', '-sha256', '-out', file('hub.crt'), '-extfile', '/dev/stdin'],
  { input: 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=' + altNames.join(','), stdio: ['pipe', 'ignore', 'inherit'] });

console.log(`Dev CA and hub certificate written to ${directory} (ca.crt, hub.crt, hub.key).`);

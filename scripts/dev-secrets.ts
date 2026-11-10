import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pairId } from '../apps/agent-node/src/m2-security.ts';

// Generates demo bootstrap secrets and per-pair MAC keys into .state/secrets.json (gitignored). These stand
// in for out-of-band provisioning and are not a production key-management system.
const file = resolve(process.env.SECRETS_FILE ?? '.state/secrets.json');
if (existsSync(file) && !process.env.SECRETS_FORCE) {
  console.log(`Dev secrets already present at ${file}. Set SECRETS_FORCE=1 to regenerate.`);
  process.exit(0);
}

const agents = (process.env.AGENT_IDS ?? 'agent-a,agent-b,agent-c').split(',');
const secret = () => randomBytes(24).toString('hex');
const bootstrap: Record<string, string> = {};
const pairKeys: Record<string, string> = {};
for (const agent of agents) bootstrap[agent] = secret();
for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) pairKeys[pairId(agents[i]!, agents[j]!)] = secret();

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ bootstrap, pairKeys }, null, 2) + '\n');
console.log(`Dev secrets written to ${file} for ${agents.join(', ')}.`);

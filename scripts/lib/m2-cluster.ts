import { createDatabase, migrate } from '../../apps/hub/src/db.ts';
import { Directory } from '../../apps/hub/src/directory.ts';
import { PgDirectoryStore } from '../../apps/hub/src/pg-directory.ts';
import { provisionIdentity } from '../../apps/hub/src/pg-identity.ts';
import { loadSecrets } from '../../apps/agent-node/src/m2-security.ts';
import { ManagedProcess, waitFor } from './processes.ts';

const DISPLAY_NAMES: Record<string, string> = { 'agent-a': 'Alpha', 'agent-b': 'Bravo', 'agent-c': 'Carol' };

export type M2ClusterOptions = {
  runId: string; stateRoot: string; databaseUrl: string; secretsFile: string; certDir: string;
  agentIds: string[]; echo?: boolean; agentArgs?: Partial<Record<string, string[]>>;
};

// Boots a real wss hub and authenticated agents as separate processes, after provisioning identities and
// directory profiles in Postgres from the dev secrets file.
export class M2Cluster {
  readonly options: M2ClusterOptions;
  readonly agents = new Map<string, ManagedProcess>();
  hub!: ManagedProcess;
  port = 0;

  constructor(options: M2ClusterOptions) { this.options = options; }

  async provision(): Promise<void> {
    const database = createDatabase(this.options.databaseUrl);
    try {
      await migrate(database);
      await database.query('TRUNCATE agent_identities, agent_profiles, agent_capabilities, friendships, sessions, mailbox RESTART IDENTITY CASCADE');
      const secrets = loadSecrets(this.options.secretsFile);
      const directory = new Directory(new PgDirectoryStore(database));
      for (const agentId of this.options.agentIds) {
        await provisionIdentity(database, { agentId, userId: `user-${agentId}`, secret: secrets.bootstrap[agentId]! });
        await directory.putProfile({ agentId, displayName: DISPLAY_NAMES[agentId] ?? agentId, visibility: 'public', capabilities: ['scheduling'] });
      }
      // Mutual friendships so friends-only lookups would also resolve among the demo agents.
      for (const a of this.options.agentIds) for (const b of this.options.agentIds) if (a !== b) await directory.addFriend(a, b);
    } finally {
      await database.end();
    }
  }

  async start(): Promise<void> {
    await this.provision();
    this.hub = new ManagedProcess('hub', ['--port', '0', '--host', '127.0.0.1', '--cert-dir', this.options.certDir, '--database-url', this.options.databaseUrl, '--run-id', this.options.runId, '--tick-ms', '200'], this.options.echo, 'm2-main');
    this.port = Number((await this.hub.ready).port);
    for (const agentId of this.options.agentIds) await this.startAgent(agentId);
  }

  async startAgent(agentId: string, extraArgs = this.options.agentArgs?.[agentId] ?? []): Promise<ManagedProcess> {
    const agent = new ManagedProcess('agent-node', [
      '--id', agentId, '--hub', `wss://127.0.0.1:${this.port}`, '--state-root', this.options.stateRoot,
      '--secrets', this.options.secretsFile, '--cert-dir', this.options.certDir, '--run-id', this.options.runId,
      '--heartbeat-ms', '500', ...extraArgs,
    ], this.options.echo, 'm2-main');
    this.agents.set(agentId, agent);
    await agent.ready;
    return agent;
  }

  agent(agentId: string): ManagedProcess {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`${agentId} is not running`);
    return agent;
  }

  async stopAgent(agentId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    await this.agent(agentId).stop(signal);
    this.agents.delete(agentId);
    await waitFor(() => this.hub.records, records => records.some(record => record.event === 'agent.offline' && record.connectedAgentId === agentId), `${agentId} offline`);
  }

  async restartHub(): Promise<void> {
    await this.hub.stop();
    this.hub = new ManagedProcess('hub', ['--port', String(this.port), '--host', '127.0.0.1', '--cert-dir', this.options.certDir, '--database-url', this.options.databaseUrl, '--run-id', this.options.runId, '--tick-ms', '200'], this.options.echo, 'm2-main');
    await this.hub.ready;
  }

  records() { return [this.hub, ...this.agents.values()].flatMap(process => process.records); }

  async close(): Promise<void> {
    for (const agent of this.agents.values()) await agent.stop();
    await this.hub?.stop();
  }
}

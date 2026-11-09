import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { SqliteAgentStore } from '../../apps/agent-node/src/sqlite-store.ts';

export type Snapshot = ReturnType<SqliteAgentStore['snapshot']>;
export type LogRecord = Record<string, unknown>;

export async function waitFor<T>(read: () => T | Promise<T>, matches: (value: T) => boolean, description: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (matches(value)) return value;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

export class ManagedProcess {
  readonly child: ChildProcess;
  readonly records: LogRecord[] = [];
  readonly ready: Promise<LogRecord>;
  stderr = '';
  private readonly pending = new Map<string, { resolve(value: LogRecord): void; reject(error: Error): void }>();

  constructor(app: 'hub' | 'agent-node', args: string[], echo = false, entryName = 'main') {
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const entry = fileURLToPath(new URL(`../../apps/${app}/src/${entryName}.${extension}`, import.meta.url));
    this.child = fork(entry, args, { execArgv: [], stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    createInterface({ input: this.child.stdout! }).on('line', line => {
      try { this.records.push(JSON.parse(line) as LogRecord); } catch { /* Node diagnostic, not an application event. */ }
      if (echo) console.log(line);
    });
    this.child.stderr!.on('data', (data: Buffer) => { this.stderr += data.toString(); });
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${app} startup timed out: ${this.stderr}`)), 10_000);
      this.child.on('message', value => {
        const message = value as LogRecord;
        if (message.kind === 'ready') { clearTimeout(timeout); resolve(message); }
        if (message.kind === 'response' && typeof message.requestId === 'string') this.pending.get(message.requestId)?.resolve(message);
      });
      this.child.once('error', error => { clearTimeout(timeout); reject(error); });
      this.child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        const error = new Error(`${app} exited (${code ?? signal}): ${this.stderr || JSON.stringify(this.records.at(-1))}`);
        reject(error);
        for (const request of this.pending.values()) request.reject(error);
      });
    });
  }

  async command(input: LogRecord): Promise<LogRecord> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Agent command timed out')); }, 5000);
      const finish = (operation: () => void) => { clearTimeout(timeout); this.pending.delete(requestId); operation(); };
      this.pending.set(requestId, {
        resolve: result => finish(() => result.error ? reject(new Error(`${result.code}: ${result.error}`)) : resolve(result)),
        reject: error => finish(() => reject(error)),
      });
      this.child.send({ ...input, requestId }, error => {
        if (error) this.pending.get(requestId)?.reject(error);
      });
    });
  }

  async status(): Promise<Snapshot> { return (await this.command({ command: 'status' })).snapshot as Snapshot; }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => this.child.kill('SIGKILL'), 3000);
      this.child.once('exit', () => { clearTimeout(timeout); resolve(); });
      this.child.kill(signal);
    });
  }
}

export type ClusterOptions = {
  stateRoot: string; runId: string; port?: number; echo?: boolean;
  agentArgs?: Partial<Record<string, string[]>>;
};

export class LocalCluster {
  readonly agents = new Map<string, ManagedProcess>();
  readonly processes: ManagedProcess[] = [];
  readonly options: ClusterOptions;
  port = 0;

  constructor(options: ClusterOptions) { this.options = options; }

  async start(): Promise<void> {
    try {
      const hub = new ManagedProcess('hub', ['--port', String(this.options.port ?? 0), '--host', '127.0.0.1', '--agents', 'agent-a,agent-b,agent-c', '--run-id', this.options.runId], this.options.echo);
      this.processes.push(hub);
      this.port = Number((await hub.ready).port);
      // Each process owns an independent SQLite directory and TCP connection.
      for (const agentId of ['agent-a', 'agent-b', 'agent-c']) await this.startAgent(agentId);
    } catch (error) { await this.close(); throw error; }
  }

  async startAgent(agentId: string, extraArgs = this.options.agentArgs?.[agentId] ?? []): Promise<ManagedProcess> {
    const agent = new ManagedProcess('agent-node', [
      '--id', agentId, '--hub', `ws://127.0.0.1:${this.port}`,
      '--state-root', this.options.stateRoot, '--run-id', this.options.runId, ...extraArgs,
    ], this.options.echo);
    this.processes.push(agent);
    this.agents.set(agentId, agent);
    await agent.ready;
    return agent;
  }

  agent(agentId: string): ManagedProcess {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`${agentId} is not running`);
    return agent;
  }

  async health(): Promise<{ status: string; pid: number; agentIds: string[] }> {
    return await (await fetch(`http://127.0.0.1:${this.port}/health`)).json() as { status: string; pid: number; agentIds: string[] };
  }

  async stopAgent(agentId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    await this.agent(agentId).stop(signal);
    this.agents.delete(agentId);
    await waitFor(() => this.health(), state => !state.agentIds.includes(agentId), 'agent to disconnect');
  }

  records(): LogRecord[] { return this.processes.flatMap(process => process.records); }

  async close(): Promise<void> {
    // Agents close before the relay so an orderly stop is not reported as a network failure.
    for (const process of [...this.processes].reverse()) await process.stop();
  }
}

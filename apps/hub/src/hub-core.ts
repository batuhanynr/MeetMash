import { parseMessage, ProtocolError, type Message } from '../../../packages/protocol/src/index.ts';
import { messageFields, type Logger } from '../../../packages/runtime/src/log.ts';
import type { Directory } from './directory.ts';
import type { Mailbox } from './mailbox.ts';
import type { Registrar } from './registrar.ts';

export interface AgentConnection { send(frame: string): void }

// Composes the authenticated relay: Registrar (sessions), Directory (discovery), and Mailbox (durable queue).
// Transport-agnostic, so it is tested with in-memory connections and driven by the wss server in production.
export class HubCore {
  private readonly registrar: Registrar;
  private readonly directory: Directory;
  private readonly mailbox: Mailbox;
  private readonly log: Logger;
  private readonly connections = new Map<string, { connection: AgentConnection; generation: number }>();

  constructor(registrar: Registrar, directory: Directory, mailbox: Mailbox, log: Logger) {
    this.registrar = registrar;
    this.directory = directory;
    this.mailbox = mailbox;
    this.log = log;
  }

  // Authenticates the connection via the bootstrap secret and rotates to a fresh session. A newer session
  // displaces an older connection for the same agent. Returns the session generation this connection owns.
  async connect(agentId: string, secret: string, endpoint: string | null, connection: AgentConnection): Promise<number> {
    const { generation } = await this.registrar.register(agentId, secret, endpoint);
    const previous = this.connections.get(agentId);
    if (previous) previous.connection.send(JSON.stringify({ kind: 'displaced' }));
    this.connections.set(agentId, { connection, generation });
    this.log('agent.online', { connectedAgentId: agentId, outcome: 'authenticated' });
    connection.send(JSON.stringify({ kind: 'ready', agentId, generation }));
    await this.deliverTo(agentId);
    return generation;
  }

  async disconnect(agentId: string, generation: number): Promise<void> {
    if (this.connections.get(agentId)?.generation !== generation) return; // a stale close must not drop the new session
    this.connections.delete(agentId);
    await this.registrar.disconnect(agentId, generation);
    this.log('agent.offline', { connectedAgentId: agentId, outcome: 'disconnected' });
  }

  async handle(agentId: string, generation: number, raw: string): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { this.reject(agentId, 'INVALID_JSON'); return; }
    if (value !== null && typeof value === 'object' && 'kind' in value) { await this.control(agentId, generation, value as { kind: string; [key: string]: unknown }); return; }
    try {
      const message = parseMessage(raw);
      if (message.fromAgentId !== agentId) throw new ProtocolError('SENDER_MISMATCH', 'Envelope sender must match the authenticated connection');
      await this.route(agentId, message);
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      this.reject(agentId, error.code);
    }
  }

  private async control(agentId: string, generation: number, value: { kind: string; [key: string]: unknown }): Promise<void> {
    if (value.kind === 'heartbeat') { await this.registrar.keepAlive(agentId, generation); return; }
    if (value.kind === 'directory.lookup') {
      const term = String(value.term ?? '');
      const profiles = value.by === 'capability' ? await this.directory.searchByCapability(agentId, term)
        : value.by === 'id' ? [await this.directory.lookup(agentId, term)].filter(p => p !== undefined)
        : await this.directory.searchByName(agentId, term);
      this.send(agentId, { kind: 'directory.result', requestId: value.requestId, agents: profiles.map(p => ({ agentId: p.agentId, displayName: p.displayName })) });
    }
  }

  private async route(sender: string, message: Message): Promise<void> {
    if (message.type === 'ACK') {
      if (message.payload.scope === 'recipient.persisted') await this.mailbox.confirm(message.payload.ackForMessageId);
      this.send(message.toAgentId, message); // forward the receipt to the original sender if it is online
      return;
    }
    const { queued } = await this.mailbox.accept(message);
    this.send(sender, { kind: 'relay.ack', messageId: message.messageId, scope: 'relay.persisted' });
    this.log(queued ? 'message.queued' : 'message.duplicate', { ...messageFields(message), direction: 'relay', outcome: 'persisted', toAgentId: message.toAgentId });
    await this.deliverTo(message.toAgentId);
  }

  // Delivers queued work to a recipient only while it is connected; otherwise the mailbox keeps it durably.
  private async deliverTo(agentId: string): Promise<void> {
    if (!this.connections.has(agentId)) return;
    await this.mailbox.drain(agentId, async message => this.send(agentId, message));
  }

  // Periodic maintenance: expire overdue messages (notifying senders) and retry delivery to online recipients.
  async tick(): Promise<void> {
    for (const { messageKey, senderAgentId } of await this.mailbox.sweepExpired()) {
      this.send(senderAgentId, { kind: 'expired', messageId: messageKey });
    }
    for (const agentId of this.connections.keys()) await this.deliverTo(agentId);
  }

  private reject(agentId: string, code: string): void {
    this.send(agentId, { kind: 'error', code });
    this.log('message.rejected', { direction: 'inbound', outcome: code, connectedAgentId: agentId });
  }

  private send(agentId: string, payload: unknown): void {
    this.connections.get(agentId)?.connection.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  get onlineAgentIds(): string[] { return [...this.connections.keys()].sort(); }
}

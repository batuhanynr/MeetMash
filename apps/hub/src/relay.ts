import { parseMessage, ProtocolError } from '../../../packages/protocol/src/index.ts';
import { messageFields, type Logger } from '../../../packages/runtime/src/log.ts';

export interface RelayPeer { send(frame: string): void }

export class Relay {
  readonly peers = new Map<string, RelayPeer>();
  private readonly allowed: Set<string>;
  private readonly log: Logger;

  constructor(agentIds: string[], log: Logger) {
    this.allowed = new Set(agentIds);
    this.log = log;
  }

  attach(agentId: string, peer: RelayPeer): void {
    if (!this.allowed.has(agentId)) throw new ProtocolError('UNKNOWN_AGENT', 'Agent ID is not allowed');
    if (this.peers.has(agentId)) throw new ProtocolError('DUPLICATE_AGENT', 'Agent ID already has a connection');
    this.peers.set(agentId, peer);
    this.log('agent.online', { connectedAgentId: agentId, outcome: 'connected' });
  }

  detach(agentId: string, peer: RelayPeer): void {
    if (this.peers.get(agentId) !== peer) return;
    this.peers.delete(agentId);
    this.log('agent.offline', { connectedAgentId: agentId, outcome: 'disconnected' });
  }

  route(agentId: string, raw: string): void {
    const sender = this.peers.get(agentId);
    if (!sender) return;
    try {
      const message = parseMessage(raw);
      if (message.fromAgentId !== agentId) throw new ProtocolError('SENDER_MISMATCH', 'Sender does not match connection');
      if (!this.allowed.has(message.toAgentId)) throw new ProtocolError('UNKNOWN_AGENT', 'Recipient is not allowed');
      const recipient = this.peers.get(message.toAgentId);
      if (!recipient) throw new ProtocolError('RECIPIENT_OFFLINE', 'Recipient is offline; retain the sender outbox');
      recipient.send(raw);
      this.log('message.routed', { ...messageFields(message), direction: 'relay', outcome: 'forwarded', toAgentId: message.toAgentId });
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      sender.send(JSON.stringify({ kind: 'error', code: error.code, detail: error.message }));
      this.log('message.rejected', { direction: 'inbound', outcome: error.code, connectedAgentId: agentId });
    }
  }
}

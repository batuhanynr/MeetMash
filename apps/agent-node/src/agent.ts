import { createMessage, parseMessage, ProtocolError, validateMessage, type Message, type MessageType, type Payloads } from '../../../packages/protocol/src/index.ts';
import { messageFields, type Logger } from '../../../packages/runtime/src/log.ts';
import type { InboxStore, OutboxStore, SequenceStore, Transport } from './ports.ts';

export type AgentConfig = {
  agentId: string; ackTimeoutMs: number; maxRetries: number; maxBackoffMs: number;
  dropAckCount: number; dropMessageCount: number; pauseAfterPersist: boolean;
};

export class Agent {
  private readonly config: AgentConfig;
  private readonly store: InboxStore & OutboxStore & SequenceStore;
  private readonly transport: Transport;
  private readonly log: Logger;
  private timer: ReturnType<typeof setInterval> | undefined;
  private dropAcks: number;
  private dropMessages: number;

  constructor(config: AgentConfig, store: InboxStore & OutboxStore & SequenceStore, transport: Transport, log: Logger) {
    this.config = config;
    this.store = store;
    this.transport = transport;
    this.log = log;
    this.dropAcks = config.dropAckCount;
    this.dropMessages = config.dropMessageCount;
  }

  start(): void {
    this.processWork(true);
    this.tick();
    this.timer = setInterval(() => this.tick(), Math.min(this.config.ackTimeoutMs, 50));
  }

  stop(): void { clearInterval(this.timer); }

  send<T extends MessageType>(toAgentId: string, meetingId: string, type: T, payload: Payloads[T]): Message {
    if (type === 'ACK') throw new ProtocolError('INVALID_MESSAGE', 'ACK is generated only after inbox persistence');
    const message = createMessage({
      fromAgentId: this.config.agentId, toAgentId, meetingId, type, payload,
      sequence: this.store.nextSequence(toAgentId, meetingId),
    });
    this.queue(message);
    return message;
  }

  queue(value: unknown): void {
    const message = validateMessage(value);
    if (message.fromAgentId !== this.config.agentId || message.type === 'ACK') throw new ProtocolError('SENDER_MISMATCH', 'Outbox sender must match this agent and must not be ACK');
    this.store.enqueue(message);
    this.log('message.queued', { ...messageFields(message), direction: 'outbound', outcome: 'persisted' });
    this.tick();
  }

  receive(raw: string): void {
    try {
      const message = parseMessage(raw);
      if (message.toAgentId !== this.config.agentId) throw new ProtocolError('UNKNOWN_AGENT', 'Message was routed to the wrong recipient');
      if (message.type === 'ACK') {
        this.store.acknowledge(message);
        this.log('message.acked', { ...messageFields(message), direction: 'inbound', ackForMessageId: message.payload.ackForMessageId, outcome: 'recipient.persisted' });
        return;
      }
      const isNew = this.store.persist(message);
      this.log(isNew ? 'message.received' : 'message.duplicate', { ...messageFields(message), direction: 'inbound', outcome: 'persisted' });
      const ack = createMessage({
        fromAgentId: this.config.agentId, toAgentId: message.fromAgentId, meetingId: message.meetingId,
        type: 'ACK', payload: { ackForMessageId: message.messageId, scope: 'recipient.persisted' },
        sequence: this.store.nextSequence(message.fromAgentId, message.meetingId),
      });
      if (this.dropAcks > 0) {
        this.dropAcks--;
        this.log('fault.ack_dropped', { ...messageFields(ack), direction: 'outbound', ackForMessageId: message.messageId, outcome: 'injected' });
      } else this.transmit(ack);
      this.processWork(false);
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      this.log('message.rejected', { direction: 'inbound', outcome: error.code });
    }
  }

  private processWork(recovering: boolean): void {
    if (this.config.pauseAfterPersist) return;
    for (const message of this.store.completePending()) {
      this.log(recovering ? 'work.recovered' : 'work.completed', { ...messageFields(message), outcome: 'effect_committed' });
    }
  }

  private transmit(message: Message): void {
    try { this.transport.send(JSON.stringify(message)); }
    catch { this.log('transport.error', { ...messageFields(message), outcome: 'send_failed' }); }
  }

  private tick(): void {
    const now = Date.now();
    for (const entry of this.store.due(now)) {
      const { message, attempts } = entry;
      if (Date.parse(message.expiresAt) <= now) {
        this.store.mark(message.messageId, 'EXPIRED');
        this.log('message.expired', { ...messageFields(message), direction: 'outbound', attempt: attempts, outcome: 'MESSAGE_EXPIRED' });
        continue;
      }
      if (attempts > this.config.maxRetries) {
        this.store.mark(message.messageId, 'DELIVERY_UNCONFIRMED');
        this.log('message.unconfirmed', { ...messageFields(message), direction: 'outbound', attempt: attempts, outcome: 'DELIVERY_UNCONFIRMED' });
        continue;
      }
      const backoff = Math.min(this.config.ackTimeoutMs * 2 ** attempts, this.config.maxBackoffMs);
      this.store.attempted(message.messageId, now + backoff);
      this.log(attempts ? 'message.retried' : 'message.sent', { ...messageFields(message), direction: 'outbound', attempt: attempts + 1, outcome: 'attempted' });
      if (this.dropMessages > 0) {
        this.dropMessages--;
        this.log('fault.message_dropped', { ...messageFields(message), attempt: attempts + 1, outcome: 'injected' });
      } else this.transmit(message);
    }
  }
}

import type { Message } from '../../../packages/protocol/src/index.ts';

export type DeliveryStatus = 'PENDING' | 'ACKED' | 'DELIVERY_UNCONFIRMED' | 'EXPIRED' | 'HUB_ACKED';
export type OutboxEntry = { message: Message; attempts: number; nextAttemptAt: number };

export interface InboxStore {
  persist(message: Message): boolean;
  completePending(): Message[];
}

export interface OutboxStore {
  enqueue(message: Message): void;
  due(now: number): OutboxEntry[];
  attempted(messageId: string, nextAttemptAt: number): void;
  mark(messageId: string, status: DeliveryStatus): void;
  relayAck(messageId: string): void;
  acknowledge(message: Extract<Message, { type: 'ACK' }>): void;
}

// Optional MM-204 hooks. When present, the agent signs outgoing messages and verifies incoming ones
// (MAC plus replay). Absent in M1, so the M1 path is unchanged.
export interface AgentSecurity {
  sign(message: Message): Message;
  verify(message: Message): void;
}

export interface SequenceStore {
  nextSequence(toAgentId: string, meetingId: string): number;
}

export interface Transport {
  send(frame: string): void;
}

import type { Message } from '../../../packages/protocol/src/index.ts';

export type DeliveryStatus = 'PENDING' | 'ACKED' | 'DELIVERY_UNCONFIRMED' | 'EXPIRED';
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
  acknowledge(message: Extract<Message, { type: 'ACK' }>): void;
}

export interface SequenceStore {
  nextSequence(toAgentId: string, meetingId: string): number;
}

export interface Transport {
  send(frame: string): void;
}

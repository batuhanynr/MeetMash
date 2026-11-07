import type { Message } from '../../../packages/protocol/src/index.ts';

export type MailStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'EXPIRED';
export type MailItem = {
  messageKey: string; recipientAgentId: string; senderAgentId: string;
  meetingId: string; messageId: string; content: Message; status: MailStatus; attempts: number;
};

// Durable per-recipient queue. The Postgres adapter implements this; the service depends only on it.
export interface MailboxStore {
  enqueue(message: Message): Promise<boolean>;
  claimDue(recipientAgentId: string, now: number, lockMs: number, limit: number): Promise<MailItem[]>;
  markDelivered(messageKey: string, now: number): Promise<boolean>;
  expireOverdue(now: number): Promise<{ messageKey: string; senderAgentId: string }[]>;
  list(recipientAgentId?: string): Promise<MailItem[]>;
}

export class Mailbox {
  private readonly store: MailboxStore;
  private readonly now: () => number;
  private readonly lockMs: number;

  constructor(store: MailboxStore, now: () => number = Date.now, lockMs = 10_000) {
    this.store = store;
    this.now = now;
    this.lockMs = lockMs;
  }

  // Persisting here is what lets the hub return a relay.persisted ACK; duplicates collapse to one row.
  async accept(message: Message): Promise<{ queued: boolean }> {
    return { queued: await this.store.enqueue(message) };
  }

  // Claims due work for an online recipient and attempts transport delivery. A delivered transport frame
  // is not a recipient.persisted ACK, so items stay SENT until confirm() runs.
  async drain(recipientAgentId: string, deliver: (message: Message) => Promise<void>, limit = 100): Promise<number> {
    const due = await this.store.claimDue(recipientAgentId, this.now(), this.lockMs, limit);
    let attempted = 0;
    for (const item of due) {
      try { await deliver(item.content); attempted++; }
      catch { /* leave it locked; it is reclaimed once the lock expires. */ }
    }
    return attempted;
  }

  async confirm(messageKey: string): Promise<boolean> {
    return this.store.markDelivered(messageKey, this.now());
  }

  async sweepExpired(): Promise<{ messageKey: string; senderAgentId: string }[]> {
    return this.store.expireOverdue(this.now());
  }

  async snapshot(recipientAgentId?: string): Promise<MailItem[]> {
    return this.store.list(recipientAgentId);
  }
}

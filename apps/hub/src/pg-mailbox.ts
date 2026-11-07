import type { Message } from '../../../packages/protocol/src/index.ts';
import type { Database } from './db.ts';
import type { MailboxStore, MailItem, MailStatus } from './mailbox.ts';

type MailRow = {
  message_key: string; recipient_agent_id: string; sender_agent_id: string;
  meeting_id: string; message_id: string; content: Message; status: MailStatus; attempts: number;
};

const toItem = (row: MailRow): MailItem => ({
  messageKey: row.message_key, recipientAgentId: row.recipient_agent_id, senderAgentId: row.sender_agent_id,
  meetingId: row.meeting_id, messageId: row.message_id, content: row.content, status: row.status, attempts: row.attempts,
});

const COLUMNS = 'message_key, recipient_agent_id, sender_agent_id, meeting_id, message_id, content, status, attempts';

export class PgMailboxStore implements MailboxStore {
  private readonly database: Database;

  constructor(database: Database) { this.database = database; }

  async enqueue(message: Message): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO mailbox (message_key, recipient_agent_id, sender_agent_id, meeting_id, message_id, content, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7)
       ON CONFLICT (message_key) DO NOTHING`,
      [message.messageId, message.toAgentId, message.fromAgentId, message.meetingId, message.messageId, message, message.expiresAt]);
    return result.rowCount === 1;
  }

  // Locks due rows atomically so two drains never deliver the same item; a crashed lock is reclaimed once it expires.
  async claimDue(recipientAgentId: string, now: number, lockMs: number, limit: number): Promise<MailItem[]> {
    const result = await this.database.query<MailRow>(
      `UPDATE mailbox SET
         status = CASE WHEN status = 'QUEUED' THEN 'SENT' ELSE status END,
         attempts = attempts + 1,
         locked_until = to_timestamp(($2 + $3) / 1000.0)
       WHERE id IN (
         SELECT id FROM mailbox
         WHERE recipient_agent_id = $1 AND status IN ('QUEUED', 'SENT')
           AND expires_at > to_timestamp($2 / 1000.0)
           AND (locked_until IS NULL OR locked_until < to_timestamp($2 / 1000.0))
         ORDER BY id LIMIT $4 FOR UPDATE SKIP LOCKED)
       RETURNING ${COLUMNS}`,
      [recipientAgentId, now, lockMs, limit]);
    return result.rows.map(toItem);
  }

  async markDelivered(messageKey: string, now: number): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE mailbox SET status = 'DELIVERED', delivered_at = to_timestamp($2 / 1000.0)
       WHERE message_key = $1 AND status IN ('QUEUED', 'SENT')`, [messageKey, now]);
    return result.rowCount === 1;
  }

  async expireOverdue(now: number): Promise<{ messageKey: string; senderAgentId: string }[]> {
    const result = await this.database.query<{ message_key: string; sender_agent_id: string }>(
      `UPDATE mailbox SET status = 'EXPIRED'
       WHERE status IN ('QUEUED', 'SENT') AND expires_at <= to_timestamp($1 / 1000.0)
       RETURNING message_key, sender_agent_id`, [now]);
    return result.rows.map(row => ({ messageKey: row.message_key, senderAgentId: row.sender_agent_id }));
  }

  async list(recipientAgentId?: string): Promise<MailItem[]> {
    const result = recipientAgentId === undefined
      ? await this.database.query<MailRow>(`SELECT ${COLUMNS} FROM mailbox ORDER BY id`)
      : await this.database.query<MailRow>(`SELECT ${COLUMNS} FROM mailbox WHERE recipient_agent_id = $1 ORDER BY id`, [recipientAgentId]);
    return result.rows.map(toItem);
  }
}

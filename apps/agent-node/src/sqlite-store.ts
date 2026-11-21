import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, ProtocolError, type Message } from '../../../packages/protocol/src/index.ts';
import type { DeliveryStatus, InboxStore, OutboxEntry, OutboxStore, SequenceStore } from './ports.ts';

export class SqliteAgentStore implements InboxStore, OutboxStore, SequenceStore {
  private readonly database: DatabaseSync;
  private readonly lock: DatabaseSync;
  private closed = false;

  constructor(directory: string, agentId: string) {
    mkdirSync(directory, { recursive: true });
    this.lock = new DatabaseSync(join(directory, 'process-lock.sqlite'));
    try { this.lock.exec('BEGIN EXCLUSIVE'); }
    catch {
      this.lock.close();
      throw new ProtocolError('STATE_IN_USE', 'Another process owns this agent state directory');
    }
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(join(directory, 'agent.sqlite'), { timeout: 5000 });
      this.database = database;
      this.database.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sequences (
          recipient TEXT NOT NULL, meeting TEXT NOT NULL, value INTEGER NOT NULL,
          PRIMARY KEY (recipient, meeting)
        );
        CREATE TABLE IF NOT EXISTS inbox (
          message_id TEXT PRIMARY KEY, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
        );
        CREATE TABLE IF NOT EXISTS work_queue (
          message_id TEXT PRIMARY KEY REFERENCES inbox(message_id)
        );
        CREATE TABLE IF NOT EXISTS effects (
          message_id TEXT PRIMARY KEY REFERENCES inbox(message_id)
        );
        CREATE TABLE IF NOT EXISTS outbox (
          message_id TEXT PRIMARY KEY, content TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'PENDING'
        );
        CREATE TABLE IF NOT EXISTS seen_nonces (
          nonce TEXT PRIMARY KEY, hash TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
      `);
      const owner = this.database.prepare('SELECT value FROM metadata WHERE key = ?').get('agentId');
      if (owner && owner.value !== agentId) throw new ProtocolError('STATE_OWNER_MISMATCH', 'State directory belongs to another agent');
      this.database.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('agentId', agentId);
    } catch (error) {
      database?.close();
      this.lock.close();
      throw error;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  nextSequence(toAgentId: string, meetingId: string): number {
    const row = this.database.prepare(`
      INSERT INTO sequences VALUES (?, ?, 1)
      ON CONFLICT(recipient, meeting) DO UPDATE SET value = value + 1 RETURNING value
    `).get(toAgentId, meetingId)!;
    return Number(row.value);
  }

  enqueue(message: Message): void {
    const content = canonicalJson(message);
    const previous = this.database.prepare('SELECT content FROM outbox WHERE message_id = ?').get(message.messageId);
    if (previous && previous.content !== content) throw new ProtocolError('MESSAGE_ID_CONFLICT', 'Outbox ID has different content');
    this.database.prepare('INSERT OR IGNORE INTO outbox (message_id, content) VALUES (?, ?)').run(message.messageId, content);
  }

  due(now: number): OutboxEntry[] {
    return this.database.prepare("SELECT content, attempts, next_attempt_at FROM outbox WHERE status = 'PENDING' AND next_attempt_at <= ?")
      .all(now).map(row => ({ message: JSON.parse(String(row.content)) as Message, attempts: Number(row.attempts), nextAttemptAt: Number(row.next_attempt_at) }));
  }

  attempted(messageId: string, nextAttemptAt: number): void {
    this.database.prepare('UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE message_id = ?')
      .run(nextAttemptAt, messageId);
  }

  mark(messageId: string, status: DeliveryStatus): void {
    this.database.prepare('UPDATE outbox SET status = ? WHERE message_id = ?').run(status, messageId);
  }

  // The hub took durable responsibility, so stop retransmitting; a later recipient ACK still marks it ACKED.
  relayAck(messageId: string): void {
    this.database.prepare("UPDATE outbox SET status = 'HUB_ACKED' WHERE message_id = ? AND status = 'PENDING'").run(messageId);
  }

  acknowledge(ack: Extract<Message, { type: 'ACK' }>): void {
    const row = this.database.prepare('SELECT content FROM outbox WHERE message_id = ?').get(ack.payload.ackForMessageId);
    const original = row ? JSON.parse(String(row.content)) as Message : undefined;
    if (!original || ack.payload.scope !== 'recipient.persisted'
      || ack.fromAgentId !== original.toAgentId || ack.toAgentId !== original.fromAgentId || ack.meetingId !== original.meetingId) {
      throw new ProtocolError('INVALID_ACK', 'ACK must match the original recipient, sender, meeting, and persistence scope');
    }
    this.mark(original.messageId, 'ACKED');
  }

  persist(message: Message): boolean {
    return this.transaction(() => {
      const content = canonicalJson(message);
      const previous = this.database.prepare('SELECT content FROM inbox WHERE message_id = ?').get(message.messageId);
      if (previous) {
        if (previous.content !== content) throw new ProtocolError('MESSAGE_ID_CONFLICT', 'Inbox ID has different content');
        return false;
      }
      if (Date.parse(message.expiresAt) <= Date.now()) throw new ProtocolError('MESSAGE_EXPIRED', 'Expired message cannot start new work');
      this.database.prepare('INSERT INTO inbox (message_id, content) VALUES (?, ?)').run(message.messageId, content);
      this.database.prepare('INSERT INTO work_queue VALUES (?)').run(message.messageId);
      return true;
    });
  }

  // Replay guard: a new nonce is accepted, the same nonce with identical content is a legitimate retransmit
  // (not reprocessed), and the same nonce with different content is rejected as a replay or forgery.
  rememberNonce(nonce: string, hash: string, expiresAt: number): boolean {
    return this.transaction(() => {
      const existing = this.database.prepare('SELECT hash FROM seen_nonces WHERE nonce = ?').get(nonce);
      if (existing) {
        if (existing.hash !== hash) throw new ProtocolError('REPLAY_DETECTED', 'Nonce was reused with different content');
        return false;
      }
      this.database.prepare('DELETE FROM seen_nonces WHERE expires_at <= ?').run(Date.now());
      this.database.prepare('INSERT INTO seen_nonces (nonce, hash, expires_at) VALUES (?, ?, ?)').run(nonce, hash, expiresAt);
      return true;
    });
  }

  completePending(): Message[] {
    return this.transaction(() => {
      const pending = this.database.prepare('SELECT inbox.content FROM work_queue JOIN inbox USING (message_id)').all();
      for (const row of pending) {
        const message = JSON.parse(String(row.content)) as Message;
        // The M1 synthetic effect and work completion commit together; calendar writes need M3's recovery protocol.
        this.database.prepare('INSERT OR IGNORE INTO effects VALUES (?)').run(message.messageId);
        this.database.prepare("UPDATE inbox SET status = 'PROCESSED' WHERE message_id = ?").run(message.messageId);
        this.database.prepare('DELETE FROM work_queue WHERE message_id = ?').run(message.messageId);
      }
      return pending.map(row => JSON.parse(String(row.content)) as Message);
    });
  }

  snapshot() {
    return {
      inbox: this.database.prepare('SELECT message_id, content, status FROM inbox').all().map(row => {
        const message = JSON.parse(String(row.content)) as Message;
        return { messageId: String(row.message_id), fromAgentId: message.fromAgentId, type: message.type, status: String(row.status) };
      }),
      outbox: this.database.prepare('SELECT message_id, content, attempts, status FROM outbox').all().map(row => {
        const message = JSON.parse(String(row.content)) as Message;
        return { messageId: String(row.message_id), toAgentId: message.toAgentId, type: message.type, attempts: Number(row.attempts), status: String(row.status) };
      }),
      effectCount: Number(this.database.prepare('SELECT COUNT(*) AS count FROM effects').get()!.count),
      pendingWork: Number(this.database.prepare('SELECT COUNT(*) AS count FROM work_queue').get()!.count),
    };
  }

  reset(): void {
    this.transaction(() => this.database.exec(`
      DELETE FROM effects;
      DELETE FROM work_queue;
      DELETE FROM inbox;
      DELETE FROM outbox;
      DELETE FROM sequences;
      DELETE FROM seen_nonces;
    `));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
    this.lock.close();
  }
}

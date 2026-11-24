import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  createMessage,
  type Message,
  type MessageType,
  type Payloads,
  type Round,
  type Slot,
} from '../../../../packages/protocol/src/index.ts';
import type { Logger } from '../../../../packages/runtime/src/log.ts';
import { normalizeMeetingTitle } from '../../../../packages/protocol/src/meeting-title.ts';
import { LocalCalendar } from './calendar.ts';
import { rankSlots, sameSlot, type CalendarProfile, type RatedSlot } from './slots.ts';

export type Send = <T extends MessageType>(
  to: string,
  meeting: string,
  type: T,
  payload: Payloads[T],
  round: Round,
) => Message;
type Status =
  | 'COLLECTING'
  | 'VOTING'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'PENDING_RECOVERY'
  | 'COMMIT_PENDING'
  | 'APPLIED'
  | 'CONFIRMED'
  | 'ABORTED';
type Decision = { id: string; kind: 'COMMIT' | 'ABORT'; reason: string };
type Meeting = Round & {
  id: string;
  owner: string;
  request: Payloads['REQUEST'];
  status: Status;
  offers: Record<string, RatedSlot[]>;
  ranking: RatedSlot[];
  selected?: Slot;
  votes: string[];
  references: Record<string, string[]>;
  acceptedRef?: string;
  decision?: Decision;
  applied: string[];
  next: number;
  error?: string;
};
const plainSlot = ({ start, end }: Slot) => ({ start, end });
function safeIds(ids: string[]) {
  return ids.every((id) => !Object.hasOwn(Object.prototype, id));
}

export class MeetingPlanner {
  private readonly db: DatabaseSync;
  readonly calendar: LocalCalendar;
  readonly id: string;
  private readonly send: Send;
  private readonly log: Logger;
  readonly faults = {
    decline: false,
    holdVote: false,
    failWrite: false,
    pauseDecision: false,
    loseWriteReply: false,
  };
  constructor(file: string, id: string, profile: CalendarProfile, send: Send, log: Logger) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY, data TEXT NOT NULL, due INTEGER NOT NULL);`);
    this.calendar = new LocalCalendar(this.db, profile);
    this.id = id;
    this.send = send;
    this.log = log;
  }
  private load(id: string): Meeting | undefined {
    const row = this.db.prepare('SELECT data FROM meetings WHERE id=?').get(id);
    return row && JSON.parse(String(row.data));
  }
  private save(m: Meeting) {
    this.db
      .prepare(
        'INSERT INTO meetings VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,due=excluded.due',
      )
      .run(m.id, JSON.stringify(m), m.next);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private open(id: string, owner: string, request: Payloads['REQUEST'], round: Round): Meeting {
    if (
      !request.deadline ||
      !request.participantAgentIds.includes(this.id) ||
      !request.participantAgentIds.includes(owner) ||
      !safeIds(request.participantAgentIds)
    )
      throw new Error('Invalid meeting participants or deadline');
    return {
      id,
      owner,
      request,
      ...round,
      status: owner === this.id ? 'COLLECTING' : 'OFFERED',
      offers: {
        [this.id]: this.calendar.offers(request.window, request.durationMinutes),
      },
      ranking: [],
      references: {},
      votes: [],
      applied: [],
      next: 0,
    };
  }
  schedule(id: string, request: Payloads['REQUEST'], timeout = 120_000) {
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 600_000)
      throw new Error('Invalid meeting timeout');
    const round = { roundId: randomUUID(), decisionVersion: 1 };
    const payload = { ...request, ...(request.title !== undefined && { title: normalizeMeetingTitle(request.title) }),
      deadline: new Date(Date.now() + timeout).toISOString() };
    createMessage({
      meetingId: id,
      fromAgentId: this.id,
      toAgentId: this.id,
      type: 'REQUEST',
      payload,
      sequence: 1,
      ...round,
    });
    if (this.load(id)) throw new Error('Meeting ID is already in use');
    const m = this.open(id, this.id, payload, round);
    this.save(m);
    return this.view(id);
  }
  view(id: string) {
    const m = this.load(id);
    if (!m) return null;
    return {
      meetingId: id,
      roundId: m.roundId,
      title: normalizeMeetingTitle(m.request.title),
      decisionVersion: m.decisionVersion,
      status: m.status,
      decision: m.decision ?? null,
      selected: m.ranking[0] ?? m.selected ?? null,
      ranking: m.ranking,
      votes: m.votes,
      pending: m.request.participantAgentIds.filter((id) => !m.applied.includes(id)),
      eventCount: this.calendar.event(id) ? 1 : 0,
      error: m.error ?? null,
    };
  }
  private decide(m: Meeting, kind: Decision['kind'], reason: string) {
    if (m.decision) return;
    m.decision = { id: randomUUID(), kind, reason };
    m.status = kind === 'COMMIT' ? 'COMMIT_PENDING' : 'ABORTED';
    if (kind === 'ABORT') {
      this.calendar.release(m.id);
      m.applied = [this.id];
    }
    m.next = 0;
    this.log('meeting.decided', { meetingId: m.id, outcome: kind, reason, decisionId: m.decision.id });
  }
  accept(message: Message) {
    if (!message.roundId || !message.decisionVersion || message.toAgentId !== this.id) return;
    const round = { roundId: message.roundId, decisionVersion: message.decisionVersion };
    this.atomic(() => {
      let m = this.load(message.meetingId);
      if (!m && message.type === 'REQUEST' && message.fromAgentId !== this.id && message.payload.deadline) {
        try {
          m = this.open(message.meetingId, message.fromAgentId, message.payload, round);
        } catch {
          this.log('meeting.invalid', { meetingId: message.meetingId, outcome: 'invalid_request' });
          return;
        }
      }
      if (
        !m ||
        m.roundId !== round.roundId ||
        m.decisionVersion !== round.decisionVersion ||
        !m.request.participantAgentIds.includes(message.fromAgentId)
      )
        return;
      const before = m.status;
      if (m.owner === this.id) {
        if (!m.decision && Date.now() >= Date.parse(m.request.deadline!)) this.decide(m, 'ABORT', 'TIMEOUT');
        this.receiveVote(m, message);
      } else if (m.owner === message.fromAgentId) this.receiveProposal(m, message);
      if (before !== m.status)
        this.log('meeting.transition', { meetingId: m.id, messageType: message.type, outcome: m.status });
      this.save(m);
    });
  }
  private receiveVote(m: Meeting, msg: Message) {
    const who = msg.fromAgentId;
    if (who === this.id) return;
    if (msg.type === 'CONFIRM' && msg.payload.phase === 'SYNC') {
      m.next = 0;
      return;
    }
    if (m.decision) {
      if (
        msg.type === 'CONFIRM' &&
        msg.payload.phase === 'APPLIED' &&
        msg.payload.decisionId === m.decision.id &&
        !m.applied.includes(who)
      ) {
        m.applied.push(who);
        m.next = 0;
      }
      return;
    }
    if (msg.type === 'REJECT') {
      this.decide(m, 'ABORT', 'DECLINED');
      return;
    }
    if (m.status === 'COLLECTING' && msg.type === 'PROPOSE' && msg.payload.phase === 'AVAILABILITY') {
      if (!Object.hasOwn(m.offers, who) && msg.payload.slots.every((s) => s.score !== undefined)) {
        m.offers[who] = msg.payload.slots as RatedSlot[];
        m.next = 0;
      }
    }
    if (
      m.status === 'VOTING' &&
      msg.type === 'ACCEPT' &&
      m.references[who]?.includes(msg.payload.proposalMessageId) &&
      !m.votes.includes(who)
    ) {
      m.votes.push(who);
      m.next = 0;
    }
  }
  private receiveProposal(m: Meeting, msg: Message) {
    if (msg.type === 'CONFIRM') {
      const p = msg.payload;
      if (p.phase === 'ABORT' && !m.decision) {
        this.calendar.release(m.id);
        m.status = 'ABORTED';
        m.decision = { id: p.decisionId, kind: 'ABORT', reason: p.reasonCode };
      } else if (
        p.phase === 'COMMIT' &&
        !m.decision &&
        m.selected &&
        sameSlot(m.selected, p.slot) &&
        (m.status === 'ACCEPTED' || m.status === 'PENDING_RECOVERY')
      ) {
        m.decision = { id: p.decisionId, kind: 'COMMIT', reason: 'UNANIMOUS' };
        m.status = 'COMMIT_PENDING';
      }
      m.next = 0;
      return;
    }
    if (m.decision) return;
    if (msg.type === 'REQUEST') {
      m.next = 0;
      return;
    }
    if (msg.type !== 'PROPOSE' || msg.payload.phase !== 'SELECTION') return;
    const slot = msg.payload.slot;
    if (m.status === 'OFFERED') {
      if (this.faults.holdVote) return;
      if (
        Date.now() >= Date.parse(m.request.deadline!) ||
        this.faults.decline ||
        !m.offers[this.id]!.some((s) => sameSlot(s, slot)) ||
        !this.calendar.reserve(m.id, slot)
      )
        m.status = 'DECLINED';
      else {
        m.status = 'ACCEPTED';
        m.selected = plainSlot(slot);
      }
    }
    if (m.selected && sameSlot(m.selected, slot)) m.acceptedRef = msg.messageId;
    m.next = 0;
  }
  private apply(m: Meeting) {
    if (m.applied.includes(this.id) || m.decision?.kind !== 'COMMIT' || !m.selected) return;
    try {
      if (!this.calendar.event(m.id)) {
        if (this.faults.failWrite) throw new Error('PROVIDER_UNAVAILABLE');
        this.calendar.ensureEvent(m.id, m.selected, m.request.title);
        if (this.faults.loseWriteReply) {
          this.faults.loseWriteReply = false;
          throw new Error('WRITE_RESULT_UNKNOWN');
        }
      } else this.calendar.ensureEvent(m.id, m.selected, m.request.title);
      this.calendar.release(m.id);
      m.applied.push(this.id);
      delete m.error;
      this.log('calendar.applied', { meetingId: m.id, outcome: 'persisted', decisionId: m.decision.id });
    } catch (error) {
      m.error = error instanceof Error ? error.message : 'PROVIDER_ERROR';
    }
  }
  tick(now = Date.now()) {
    for (const row of this.db.prepare('SELECT data FROM meetings WHERE due<=? ORDER BY rowid').all(now)) {
      const m: Meeting = JSON.parse(String(row.data));
      m.next = now + 1000;
      const before = m.status;
      if (m.owner === this.id) this.driveOwner(m, now);
      else this.drivePeer(m, now);
      if (m.status !== before) this.log('meeting.transition', { meetingId: m.id, outcome: m.status });
      this.save(m);
    }
  }
  private emit<T extends MessageType>(m: Meeting, to: string, type: T, payload: Payloads[T]) {
    return this.send(to, m.id, type, payload, { roundId: m.roundId, decisionVersion: m.decisionVersion });
  }
  private driveOwner(m: Meeting, now: number) {
    const ids = m.request.participantAgentIds;
    if (!m.decision && now >= Date.parse(m.request.deadline!)) this.decide(m, 'ABORT', 'TIMEOUT');
    if (m.status === 'COLLECTING') {
      const missing = ids.filter((id) => !Object.hasOwn(m.offers, id));
      if (missing.length) {
        for (const id of missing) this.emit(m, id, 'REQUEST', m.request);
        return;
      }
      m.ranking = rankSlots(ids, m.offers);
      if (!m.ranking[0]) this.decide(m, 'ABORT', 'NO_COMMON_SLOT');
      else {
        m.selected = plainSlot(m.ranking[0]);
        if (this.faults.decline || !this.calendar.reserve(m.id, m.selected)) this.decide(m, 'ABORT', 'CONFLICT');
        else {
          m.votes = [this.id];
          m.status = 'VOTING';
        }
      }
    }
    if (m.status === 'VOTING') {
      const missing = ids.filter((id) => !m.votes.includes(id));
      if (missing.length) {
        for (const id of missing) {
          const sent = this.emit(m, id, 'PROPOSE', { phase: 'SELECTION', slot: m.selected! });
          m.references[id] = [...(m.references[id] ?? []).slice(-127), sent.messageId];
        }
        return;
      }
      this.decide(m, 'COMMIT', 'UNANIMOUS');
    }
    if (!m.decision) return;
    // Persist the one decision before provider I/O or sending it to any peer.
    this.save(m);
    if (this.faults.pauseDecision) return;
    this.apply(m);
    for (const id of ids) {
      if (id === this.id || m.applied.includes(id)) continue;
      this.emit(
        m,
        id,
        'CONFIRM',
        m.decision.kind === 'COMMIT'
          ? { phase: 'COMMIT', decisionId: m.decision.id, slot: m.selected! }
          : { phase: 'ABORT', decisionId: m.decision.id, reasonCode: m.decision.reason },
      );
    }
    if (ids.every((id) => m.applied.includes(id))) {
      if (m.decision.kind === 'COMMIT') m.status = 'CONFIRMED';
      m.next = Number.MAX_SAFE_INTEGER;
    }
  }
  private drivePeer(m: Meeting, now: number) {
    if (m.decision) {
      this.apply(m);
      if (m.decision.kind === 'ABORT' || m.applied.includes(this.id)) {
        if (m.decision.kind === 'COMMIT') m.status = 'APPLIED';
        this.emit(m, m.owner, 'CONFIRM', { phase: 'APPLIED', decisionId: m.decision.id });
        m.next = Number.MAX_SAFE_INTEGER;
      }
      return;
    }
    if (m.status === 'OFFERED') {
      if (now >= Date.parse(m.request.deadline!)) {
        m.status = 'DECLINED';
      } else {
        this.emit(m, m.owner, 'PROPOSE', { phase: 'AVAILABILITY', slots: m.offers[this.id]! });
        m.next = Date.parse(m.request.deadline!);
        return;
      }
    }
    if (m.status === 'DECLINED') {
      this.emit(m, m.owner, 'REJECT', { reasonCode: 'DECLINED' });
      m.next = Number.MAX_SAFE_INTEGER;
      return;
    }
    if (now >= Date.parse(m.request.deadline!)) m.status = 'PENDING_RECOVERY';
    if (m.status === 'PENDING_RECOVERY') this.emit(m, m.owner, 'CONFIRM', { phase: 'SYNC' });
    else if (m.acceptedRef) this.emit(m, m.owner, 'ACCEPT', { proposalMessageId: m.acceptedRef });
  }
  close() {
    this.db.close();
  }
}

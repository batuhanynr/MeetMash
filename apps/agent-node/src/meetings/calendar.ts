import type { DatabaseSync } from 'node:sqlite';
import type { Slot } from '../../../../packages/protocol/src/index.ts';
import { defaultMeetingTitle, normalizeMeetingTitle } from '../../../../packages/protocol/src/meeting-title.ts';
import { candidates, overlaps, sameSlot, type CalendarProfile } from './slots.ts';

export interface Calendar {
  getBusy(): Slot[];
  reserve(meetingId: string, slot: Slot): boolean;
  release(meetingId: string): void;
  event(meetingId: string): Slot | undefined;
  ensureEvent(meetingId: string, slot: Slot, title?: string): void;
}

// Each agent owns this database. The write lock covers the overlap check and reservation.
export class LocalCalendar implements Calendar {
  readonly profile: CalendarProfile;
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync, seed: CalendarProfile) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS calendar_config(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations(meeting TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calendar_events(meeting TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'MeetMesh');`);
    if (!db.prepare('PRAGMA table_info(calendar_events)').all().some(column => column.name === 'title')) {
      db.exec(`ALTER TABLE calendar_events ADD COLUMN title TEXT NOT NULL DEFAULT '${defaultMeetingTitle}'`);
    }
    db.prepare('INSERT OR IGNORE INTO calendar_config VALUES(1,?)').run(JSON.stringify(seed));
    this.profile = JSON.parse(String(db.prepare('SELECT data FROM calendar_config WHERE id=1').get()!.data));
  }
  getBusy(): Slot[] {
    const rows = this.db
      .prepare('SELECT start,end FROM reservations UNION SELECT start,end FROM calendar_events')
      .all();
    return [...this.profile.busy, ...rows].map((s) => ({ start: String(s.start), end: String(s.end) }));
  }
  offers(window: Slot, duration: number) {
    return candidates(this.profile, this.getBusy(), window, duration);
  }
  reserve(meetingId: string, slot: Slot): boolean {
    this.db.exec('SAVEPOINT reserve_slot');
    try {
      const prior = this.db.prepare('SELECT start,end FROM reservations WHERE meeting=?').get(meetingId);
      if (prior) return sameSlot({ start: String(prior.start), end: String(prior.end) }, slot);
      if (this.getBusy().some((b) => overlaps(b, slot))) return false;
      this.db.prepare('INSERT INTO reservations VALUES(?,?,?)').run(meetingId, slot.start, slot.end);
      return true;
    } finally {
      this.db.exec('RELEASE reserve_slot');
    }
  }
  release(id: string) {
    this.db.prepare('DELETE FROM reservations WHERE meeting=?').run(id);
  }
  event(id: string) {
    const r = this.db.prepare('SELECT start,end FROM calendar_events WHERE meeting=?').get(id);
    return r ? { start: String(r.start), end: String(r.end) } : undefined;
  }
  ensureEvent(id: string, slot: Slot, title?: string) {
    const existing = this.event(id);
    if (existing && !sameSlot(existing, slot)) throw new Error('EVENT_CONFLICT');
    this.db.prepare('INSERT OR IGNORE INTO calendar_events(meeting,start,end,title) VALUES(?,?,?,?)').run(id, slot.start, slot.end, normalizeMeetingTitle(title));
  }
}

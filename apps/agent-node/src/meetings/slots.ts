import type { Slot } from '../../../../packages/protocol/src/index.ts';

export type RatedSlot = Slot & { score: number };
export type CalendarProfile = {
  working: Slot[];
  busy: (Slot & { title: string; description: string })[];
  preferences: { start: string; score: number }[];
};

export const overlaps = (a: Slot, b: Slot) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
export const sameSlot = (a: Slot, b: Slot) =>
  Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
export function candidates(
  profile: CalendarProfile,
  busy: Slot[],
  window: Slot,
  duration: number,
  step = 30,
): RatedSlot[] {
  const start = Date.parse(window.start),
    end = Date.parse(window.end);
  if (
    !Number.isInteger(duration) ||
    duration < 1 ||
    !Number.isInteger(step) ||
    step < 1 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    (end - start) / (step * 60_000) > 128
  )
    throw new Error('Invalid scheduling window, duration or step (maximum 128 candidate starts)');
  const result: RatedSlot[] = [];
  for (let time = start; time + duration * 60_000 <= end; time += step * 60_000) {
    const stop = time + duration * 60_000;
    if (!profile.working.some((w) => time >= Date.parse(w.start) && stop <= Date.parse(w.end))) continue;
    const slot = { start: new Date(time).toISOString(), end: new Date(stop).toISOString() };
    if (busy.some((b) => overlaps(b, slot))) continue;
    const score = profile.preferences.find((p) => Date.parse(p.start) === time)?.score ?? 50;
    result.push({ ...slot, score });
  }
  return result;
}

export function rankSlots(members: string[], offers: Record<string, RatedSlot[]>): RatedSlot[] {
  if (!members.length || members.some((id) => !Object.hasOwn(offers, id))) return [];
  const common: RatedSlot[] = [];
  for (const first of offers[members[0]!]!) {
    const matches = members.map((id) => offers[id]!.find((other) => sameSlot(first, other)));
    if (matches.every((s) => s !== undefined))
      common.push({ ...first, score: matches.reduce((n, s) => n + s.score, 0) });
  }
  return common.sort(
    (a, b) =>
      b.score - a.score || Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end),
  );
}

export const defaultMeetingTitle = 'MeetMesh';
export const maxMeetingTitleLength = 100;

export function normalizeMeetingTitle(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  return [...text].slice(0, maxMeetingTitleLength).join('').trimEnd() || defaultMeetingTitle;
}

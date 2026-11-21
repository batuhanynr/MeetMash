// Exact spellings for wall-clock times present in a Turkish request.
// Model output still goes through schema, timezone, and permission checks.
export function dateHints(text: string, reference: string): string[] {
  const folded = text.toLocaleLowerCase('tr');
  const dates = new Set<string>();
  const shift = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
  if (/\bbugün\b/u.test(folded)) dates.add(reference);
  if (folded.includes('yarın')) dates.add(shift(reference, 1));
  if (folded.includes('öbür gün')) dates.add(shift(reference, 2));
  const months = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
  const validDate = (ymd: string) => {
    const parsed = new Date(ymd + 'T12:00:00Z');
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(ymd)) dates.add(ymd);
  };
  for (const m of folded.matchAll(/(\d{1,2})\s+(\p{L}+)(?:\s+(\d{4}))?/gu)) {
    const month = months.indexOf(m[2]!) + 1;
    if (month) validDate([m[3] ?? reference.slice(0,4), String(month).padStart(2,'0'),m[1]!.padStart(2,'0')].join('-'));
  }
  for (const m of folded.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) validDate(m[1]!);
  for (const m of folded.matchAll(/\b(\d{2})[./](\d{2})[./](\d{4})\b/g)) validDate([m[3],m[2],m[1]].join('-'));
  const clocks = [...new Set([...folded.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(m => m[1]!.padStart(2,'0') + ':' + m[2]))];
  if (!dates.size || dates.size > 8 || clocks.length > 16) return [];
  if (!clocks.length) return [...dates].flatMap(d => [d + 'T00:00',shift(d,1) + 'T00:00']);
  return [...dates].flatMap(d => clocks.map(t => d + 'T' + t));
}

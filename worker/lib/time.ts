// Dates the way the PHP shop used them: calendar days and months in Cairo time (DateTime with market_tz()),
// stored and compared as UTC "Y-m-d H:i:s" strings.
const TZ = 'Africa/Cairo';

const parts = (d: Date, tz = TZ): Record<string, string> =>
  Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d).map((p) => [p.type, p.value]));

// Cairo calendar date of a moment, "Y-m-d".
export const cairoDay = (d: Date = new Date()): string => { const p = parts(d); return p.year + '-' + p.month + '-' + p.day; };
export const cairoMonth = (d: Date = new Date()): string => cairoDay(d).slice(0, 7);
export const cairoDayOfMonth = (d: Date = new Date()): number => Number(parts(d).day);

// Offset of Cairo from UTC (minutes) at a given UTC moment.
function offsetAt(utcMs: number): number {
  const p = parts(new Date(utcMs));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - utcMs) / 60000);
}
// The UTC moment of a Cairo wall-clock time.
export function cairoToUtc(y: number, m: number, d: number, h = 0, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess - offsetAt(guess) * 60000;
  t = guess - offsetAt(t) * 60000; // once more, across a DST change
  return new Date(t);
}
// "Y-m-d H:i:s" in UTC.
export const utcStamp = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');
export const parseUtc = (s: string): Date => new Date(s.replace(' ', 'T') + (s.length <= 10 ? 'T00:00:00Z' : 'Z'));

// Midnight (Cairo) starting a Cairo day, as UTC.
export const cairoMidnight = (ymd: string): Date => { const [y, m, d] = ymd.split('-').map(Number); return cairoToUtc(y, m, d); };
// A Cairo calendar day plus n days.
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
// Days between two Cairo dates (b - a).
export const dayDiff = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

// cairo_month_bounds(): [month, fromUtc, toUtc] for "Y-m" (this month when not valid).
export function cairoMonthBounds(month: string): [string, string, string] {
  if (!/^\d{4}-\d{2}$/.test(month)) month = cairoMonth();
  return [month, utcStamp(cairoMidnight(month + '-01')), utcStamp(cairoMidnight(addMonths(month, 1) + '-01'))];
}

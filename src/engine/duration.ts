// Durations as people type and read them: "5 days", "2 wks", "4 hrs", "3 edays", "1 day?".
// Stored as minutes: working minutes, or clock minutes for elapsed durations.

export type DurUnit = 'm' | 'h' | 'd' | 'w' | 'mo';
export interface Duration { minutes: number; unit: DurUnit; elapsed: boolean; estimated: boolean }
export interface TimeSettings { minutesPerDay: number; minutesPerWeek: number; daysPerMonth: number }

export const DEFAULT_TIME: TimeSettings = { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 };

export function unitMinutes(unit: DurUnit, elapsed: boolean, ts: TimeSettings): number {
  if (elapsed) return { m: 1, h: 60, d: 1440, w: 10080, mo: 43200 }[unit];
  return { m: 1, h: 60, d: ts.minutesPerDay, w: ts.minutesPerWeek, mo: ts.minutesPerDay * ts.daysPerMonth }[unit];
}

const UNIT_WORDS: [RegExp, DurUnit][] = [
  [/^(m|min|mins|minute|minutes)$/, 'm'],
  [/^(h|hr|hrs|hour|hours)$/, 'h'],
  [/^(d|dy|dys|day|days)$/, 'd'],
  [/^(w|wk|wks|week|weeks)$/, 'w'],
  [/^(mo|mon|mons|month|months)$/, 'mo']
];

function unitOf(word: string): { unit: DurUnit; elapsed: boolean } | null {
  let w = word.toLowerCase(), elapsed = false;
  for (const [re, u] of UNIT_WORDS) if (re.test(w)) return { unit: u, elapsed };
  if (w.startsWith('e')) { w = w.slice(1); elapsed = true; for (const [re, u] of UNIT_WORDS) if (re.test(w)) return { unit: u, elapsed }; }
  return null;
}

// "3", "3d", "3 days", "2.5wks", "4ed", "5d?", "1 mon". A bare number uses `defaultUnit`.
export function parseDuration(text: string, ts: TimeSettings = DEFAULT_TIME, defaultUnit: DurUnit = 'd'): Duration | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?|-?[.,]\d+)\s*([a-z]*)\s*(\?)?\s*$/i.exec(String(text));
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  if (!isFinite(value)) return null;
  const u = m[2] ? unitOf(m[2]) : { unit: defaultUnit, elapsed: false };
  if (!u) return null;
  return { minutes: Math.round(value * unitMinutes(u.unit, u.elapsed, ts) * 1000) / 1000, unit: u.unit, elapsed: u.elapsed, estimated: !!m[3] };
}

const LABEL: Record<DurUnit, [string, string]> = { m: ['min', 'mins'], h: ['hr', 'hrs'], d: ['day', 'days'], w: ['wk', 'wks'], mo: ['mon', 'mons'] };

export function formatNumber(v: number, dp = 2): string {
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return String(r);
}

export function formatDuration(d: Duration, ts: TimeSettings = DEFAULT_TIME): string {
  const v = d.minutes / unitMinutes(d.unit, d.elapsed, ts);
  const n = formatNumber(v);
  const [one, many] = LABEL[d.unit];
  return n + ' ' + (d.elapsed ? 'e' : '') + (Math.abs(+n) === 1 ? one : many) + (d.estimated ? '?' : '');
}

// Short form used by the Predecessors column: "2d", "4h", "1.5w", "3ed".
export function formatShort(minutes: number, unit: DurUnit, elapsed: boolean, ts: TimeSettings = DEFAULT_TIME): string {
  return formatNumber(minutes / unitMinutes(unit, elapsed, ts)) + (elapsed ? 'e' : '') + unit;
}

// Work is shown in hours by default ("40 hrs").
export function formatWork(minutes: number, unit: DurUnit = 'h', ts: TimeSettings = DEFAULT_TIME): string {
  return formatDuration({ minutes, unit, elapsed: false, estimated: false }, ts);
}

// Time is a whole number of minutes since 1970-01-01 00:00, with no time zone: a plan says "Mon 5 Jan 8:00"
// wherever it is opened. Days are whole numbers of days since 1970-01-01.

export type Minutes = number;
export const MIN_PER_DAY = 1440;

export const dayOf = (t: Minutes) => Math.floor(t / MIN_PER_DAY);
export const minuteOfDay = (t: Minutes) => t - dayOf(t) * MIN_PER_DAY;
export const atDay = (day: number, minute = 0): Minutes => day * MIN_PER_DAY + minute;
// 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday).
export const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;

export function dayFromYmd(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

export function ymd(day: number): [number, number, number] {
  const d = new Date(day * 864e5);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

// "2026-01-05" (date part only)
export function isoDate(t: Minutes): string {
  const [y, m, d] = ymd(dayOf(t));
  return y + '-' + pad(m) + '-' + pad(d);
}

// "2026-01-05T08:00:00", the format project XML uses
export function isoDateTime(t: Minutes): string {
  const mm = minuteOfDay(t);
  return isoDate(t) + 'T' + pad(Math.floor(mm / 60)) + ':' + pad(mm % 60) + ':00';
}

// Parses "2026-01-05", "2026-01-05T08:00", "2026-01-05T08:00:00". Returns null for anything else.
export function parseIso(s: string | null | undefined): Minutes | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s || '');
  if (!m) return null;
  const day = dayFromYmd(+m[1], +m[2], +m[3]);
  const [y, mo, d] = ymd(day);
  if (y !== +m[1] || mo !== +m[2] || d !== +m[3]) return null;
  return atDay(day, m[4] ? +m[4] * 60 + +m[5] : 0);
}

export function clock(minuteOfDayValue: number): string {
  const h = Math.floor(minuteOfDayValue / 60) % 24, mi = minuteOfDayValue % 60;
  return pad(h) + ':' + pad(mi);
}

export function todayMinutes(): Minutes {
  const n = new Date();
  return atDay(dayFromYmd(n.getFullYear(), n.getMonth() + 1, n.getDate()));
}

/* ---------- display formats ---------- */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Display formats (File › Preferences). Word formats avoid day/month confusion; numeric ones are the usual regional formats.
//   dmy  "Mon 13 Oct 26"    mdy  "Mon Oct 13 '26"    ndmy "Mon 13/10/26"    nmdy "Mon 10/13/26"    iso "Mon 2026-10-13"
export type DateFormat = 'dmy' | 'mdy' | 'ndmy' | 'nmdy' | 'iso';
export const DATE_FORMATS: DateFormat[] = ['dmy', 'mdy', 'ndmy', 'nmdy', 'iso'];
export const DATE_FORMAT_LABELS: Record<DateFormat, string> = { dmy: 'Tue 13 Oct 26', mdy: "Tue Oct 13 '26", ndmy: 'Tue 13/10/26', nmdy: 'Tue 10/13/26', iso: 'Tue 2026-10-13' };

// Month-first formats are the default where the browser's locale writes dates month first (en-US and similar).
export function localeDateFormat(): DateFormat {
  try {
    const lang = (globalThis as any).navigator?.language || '';
    const parts = new Intl.DateTimeFormat(lang || undefined).formatToParts(new Date(2026, 9, 13));
    const order = parts.filter(p => p.type === 'day' || p.type === 'month').map(p => p.type).join();
    return order === 'month,day' ? 'mdy' : 'dmy';
  } catch { return 'dmy'; }
}

export const monthFirst = (f: DateFormat) => f === 'mdy' || f === 'nmdy';

export function fmtDate(t: Minutes | null | undefined, opts: { time?: boolean; weekday?: boolean; format?: DateFormat } = {}): string {
  if (t == null || !isFinite(t)) return '';
  const day = dayOf(t), [y, m, d] = ymd(day), yy = String(y).slice(2);
  let s: string;
  switch (opts.format) {
    case 'iso': s = y + '-' + pad(m) + '-' + pad(d); break;
    case 'mdy': s = MONTHS[m - 1] + ' ' + d + " '" + yy; break;
    case 'ndmy': s = d + '/' + m + '/' + yy; break;
    case 'nmdy': s = m + '/' + d + '/' + yy; break;
    default: s = d + ' ' + MONTHS[m - 1] + ' ' + yy;
  }
  if (opts.weekday !== false) s = DAYS[weekday(day)] + ' ' + s;
  if (opts.time) s += ' ' + clock(minuteOfDay(t));
  return s;
}

// Accepts what people type in a date cell, in any common form: "13 Oct 26", "Oct 13 '26", "October 13, 2026",
// "13-Oct-2026", "10/13/2026", "13/10/26", "13.10.2026", "2026-10-13", "Tue 13 Oct 26 1:00 PM", "today", "tomorrow".
// Numeric dates are read in the order of the display format; if that order gives an impossible date
// (month 13 or more) the other order is used.
export function parseDateText(text: string, format: DateFormat = 'dmy', today = todayMinutes()): { day: number; minute: number | null } | null {
  let s = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let minute: number | null = null;
  const tm = /(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|a|p)?$/.exec(s) || /(?:^|\s)(\d{1,2})\s*(am|pm|a|p)$/.exec(s);
  if (tm) {
    let h = +tm[1];
    const mi = tm.length === 4 ? +(tm[2] || 0) : 0;
    const ap = (tm.length === 4 ? tm[3] : tm[2]) || '';
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    if (h > 24 || mi > 59) return null;
    minute = h * 60 + mi;
    s = s.slice(0, tm.index).trim();
  }
  s = s.replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*/, '').replace(/\s*'\s*(\d{2})$/, ' $1').trim();
  const base = dayOf(today);
  if (s === 'today' || s === 'now' || s === '') return s === '' && minute == null ? null : { day: base, minute };
  if (s === 'tomorrow') return { day: base + 1, minute };
  if (s === 'yesterday') return { day: base - 1, minute };
  const year = (v: string) => { const n = +v; return v.length <= 2 ? 2000 + n : n; };
  const mon = (v: string) => (v.length >= 3 ? MONTHS.findIndex(x => v.startsWith(x.toLowerCase())) + 1 : 0);
  let y = 0, m = 0, d = 0, r: RegExpExecArray | null;
  const currentYear = ymd(base)[0];
  const valid = (yy: number, mm: number, dd: number) => {
    if (!mm || !dd || mm > 12 || dd > 31) return false;
    const [a, b, c] = ymd(dayFromYmd(yy, mm, dd));
    return a === yy && b === mm && c === dd;
  };
  if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[ \-.]*([a-z]{3,})\.?[ \-.]*(\d{2}|\d{4})?$/.exec(s))) { d = +r[1]; m = mon(r[2]); y = r[3] ? year(r[3]) : currentYear; }
  else if ((r = /^([a-z]{3,})\.?[ \-]*(\d{1,2})(?:st|nd|rd|th)?(?:[ \-]+(\d{2}|\d{4}))?$/.exec(s))) { m = mon(r[1]); d = +r[2]; y = r[3] ? year(r[3]) : currentYear; }
  else if ((r = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(s))) {
    const a = +r[1], b = +r[2];
    y = r[3] ? year(r[3]) : currentYear;
    [m, d] = monthFirst(format) ? [a, b] : [b, a];
    if (!valid(y, m, d) && valid(y, d, m)) [m, d] = [d, m];
  } else return null;
  if (!valid(y, m, d)) return null;
  return { day: dayFromYmd(y, m, d), minute };
}

/* ---------- calendar units (timescale tiers, timephased buckets) ---------- */

export type Unit = 'year' | 'half' | 'quarter' | 'month' | 'third' | 'week' | 'day' | 'hour' | 'minute';

// Start of the unit containing time t. Weeks start on `weekStart` (0 = Sunday); fiscal years start in month `fiscal`.
export function unitStart(unit: Unit, t: Minutes, weekStart = 0, fiscal = 1): Minutes {
  const day = dayOf(t), [y, m, d] = ymd(day);
  switch (unit) {
    case 'minute': return Math.floor(t);
    case 'hour': return Math.floor(t / 60) * 60;
    case 'day': return atDay(day);
    case 'week': { let x = day; while (weekday(x) !== weekStart) x--; return atDay(x); }
    case 'third': return atDay(dayFromYmd(y, m, d <= 10 ? 1 : d <= 20 ? 11 : 21));
    case 'month': return atDay(dayFromYmd(y, m, 1));
    case 'quarter': { const off = ((m - fiscal) % 3 + 3) % 3; return atDay(Math.round(Date.UTC(y, m - 1 - off, 1) / 864e5)); }
    case 'half': { const off = ((m - fiscal) % 6 + 6) % 6; return atDay(Math.round(Date.UTC(y, m - 1 - off, 1) / 864e5)); }
    case 'year': { const off = ((m - fiscal) % 12 + 12) % 12; return atDay(Math.round(Date.UTC(y, m - 1 - off, 1) / 864e5)); }
  }
}

// Start of the next unit (count units later).
export function unitNext(unit: Unit, t: Minutes, count = 1): Minutes {
  const day = dayOf(t), [y, m, d] = ymd(day);
  switch (unit) {
    case 'minute': return t + count;
    case 'hour': return t + 60 * count;
    case 'day': return t + 1440 * count;
    case 'week': return t + 7 * 1440 * count;
    case 'third': { let yy = y, mm = m, dd = d; for (let k = 0; k < count; k++) { if (dd < 11) dd = 11; else if (dd < 21) dd = 21; else { dd = 1; mm++; if (mm > 12) { mm = 1; yy++; } } } return atDay(dayFromYmd(yy, mm, dd)); }
    case 'month': return atDay(Math.round(Date.UTC(y, m - 1 + count, 1) / 864e5));
    case 'quarter': return atDay(Math.round(Date.UTC(y, m - 1 + 3 * count, 1) / 864e5));
    case 'half': return atDay(Math.round(Date.UTC(y, m - 1 + 6 * count, 1) / 864e5));
    case 'year': return atDay(Math.round(Date.UTC(y + count, m - 1, 1) / 864e5));
  }
}

// ISO week number.
export function weekNumber(day: number): number {
  const wd = (weekday(day) + 6) % 7;            // Monday = 0
  const thursday = day - wd + 3;
  const [y] = ymd(thursday);
  return Math.floor((thursday - dayFromYmd(y, 1, 1)) / 7) + 1;
}

// Formats a timescale label: yyyy yy MMMM MMM MM M1 d dd ddd dddd d1 Qn H1 W T HH mm h am.
export function formatUnitLabel(fmt: string, t: Minutes, fiscal = 1): string {
  const day = dayOf(t), [y, m, d] = ymd(day), wd = weekday(day), mo = minuteOfDay(t);
  const fy = fiscal > 1 && m >= fiscal ? y + 1 : y;
  const fm = ((m - fiscal + 12) % 12);
  const q = Math.floor(fm / 3) + 1, h = fm < 6 ? 1 : 2;
  const hr = Math.floor(mo / 60), h12 = hr % 12 || 12;
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M1|dddd|ddd|dd|d1|d|Quarter n|Qn|H1|1st Half|W|T|HH|mm|h am|h/g, tok => {
    switch (tok) {
      case 'yyyy': return String(fy);
      case 'yy': return String(y).slice(2);
      case 'MMMM': return MONTHS_LONG[m - 1];
      case 'MMM': return MONTHS[m - 1];
      case 'MM': return String(m).padStart(2, '0');
      case 'M1': return MONTHS[m - 1][0];
      case 'dddd': return DAYS_LONG[wd];
      case 'ddd': return DAYS[wd];
      case 'dd': return String(d).padStart(2, '0');
      case 'd1': return DAYS[wd][0];
      case 'd': return String(d);
      case 'Quarter n': return 'Quarter ' + q;
      case 'Qn': return 'Q' + q;
      case 'H1': return 'H' + h;
      case '1st Half': return h === 1 ? '1st Half' : '2nd Half';
      case 'W': return String(weekNumber(day));
      case 'T': return d <= 10 ? 'B' : d <= 20 ? 'M' : 'E';
      case 'HH': return String(hr).padStart(2, '0');
      case 'mm': return String(mo % 60).padStart(2, '0');
      case 'h am': return h12 + (hr < 12 ? ' am' : ' pm');
      case 'h': return String(h12);
    }
    return tok;
  });
}

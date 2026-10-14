// Recurrence patterns, shared by recurring tasks (Task › Recurring Task) and recurring calendar exceptions
// (Working days and holidays › Exceptions › Details): daily, weekly on chosen weekdays, monthly and yearly
// on a day of the month or on the nth weekday ("the last Friday").
import { dayFromYmd, weekday, ymd } from './time';

export interface RecurRule {
  pattern: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;      // every N days / weeks / months / years
  days: number[];     // weekly: weekdays 0 (Sunday) – 6
  monthDay: number;   // monthly / yearly: day of the month; 0 = use nth + weekday
  nth: number;        // 1–4, or 5 for the last
  weekday: number;    // 0–6
  month: number;      // yearly: 1–12
}

const monthLen = (y: number, m: number) => ymd(dayFromYmd(y, m + 1, 1) - 1)[2];

// The day of the nth weekday of a month (n = 5 means the last one).
export function nthWeekday(y: number, m: number, n: number, wd: number): number {
  if (n >= 5) {
    let d = dayFromYmd(y, m, monthLen(y, m));
    while (weekday(d) !== wd) d--;
    return d;
  }
  let d = dayFromYmd(y, m, 1);
  while (weekday(d) !== wd) d++;
  return d + (n - 1) * 7;
}

function dayInMonth(rule: RecurRule, y: number, m: number): number {
  if (rule.monthDay > 0) return dayFromYmd(y, m, Math.min(rule.monthDay, monthLen(y, m)));
  return nthWeekday(y, m, rule.nth || 1, rule.weekday);
}

// Days (days since 1970) on which the pattern occurs, from startDay, up to endDay (inclusive) or `count` occurrences.
export function occurrences(rule: RecurRule, startDay: number, endDay: number | null, count: number, max = 2000): number[] {
  const out: number[] = [];
  const every = Math.max(1, Math.round(rule.every || 1));
  const limit = Math.min(max, endDay == null ? Math.max(1, count) : max);
  const done = (d: number) => (endDay != null && d > endDay) || out.length >= limit;
  const push = (d: number) => { if (d >= startDay && !done(d)) out.push(d); };
  const hardEnd = startDay + 366 * 60;
  if (rule.pattern === 'daily') {
    for (let d = startDay; d <= hardEnd && !done(d); d += every) out.push(d);
  } else if (rule.pattern === 'weekly') {
    const days = (rule.days.length ? rule.days : [weekday(startDay)]).slice().sort((a, b) => a - b);
    let wk = startDay - weekday(startDay);
    for (; wk <= hardEnd && !done(wk); wk += 7 * every) for (const wd of days) { const d = wk + wd; if (done(d) && d >= startDay) break; push(d); }
  } else if (rule.pattern === 'monthly') {
    let [y, m] = ymd(startDay);
    for (let k = 0; k < 12 * 60; k++) {
      const d = dayInMonth(rule, y, m);
      if (d > hardEnd || (d >= startDay && done(d))) break;
      push(d);
      m += every; while (m > 12) { m -= 12; y++; }
    }
  } else {
    let y = ymd(startDay)[0];
    for (let k = 0; k < 60; k++) {
      const d = dayInMonth(rule, y, rule.month || 1);
      if (d > hardEnd || (d >= startDay && done(d))) break;
      push(d);
      y += every;
    }
  }
  return out;
}

export const NTH = ['', 'first', 'second', 'third', 'fourth', 'last'];

// "Every 2 weeks on Mon, Wed" style description.
export function describeRule(r: RecurRule): string {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const e = Math.max(1, r.every);
  const on = r.monthDay > 0 ? 'day ' + r.monthDay : 'the ' + NTH[r.nth || 1] + ' ' + DAYS[r.weekday];
  switch (r.pattern) {
    case 'daily': return e === 1 ? 'Every day' : 'Every ' + e + ' days';
    case 'weekly': return (e === 1 ? 'Every week' : 'Every ' + e + ' weeks') + ' on ' + (r.days.length ? r.days.slice().sort().map(d => DAYS[d]).join(', ') : 'the same weekday');
    case 'monthly': return (e === 1 ? 'Every month' : 'Every ' + e + ' months') + ' on ' + on;
    default: return (e === 1 ? 'Every year' : 'Every ' + e + ' years') + ' on ' + (r.monthDay > 0 ? r.monthDay + ' ' + MONTHS[(r.month || 1) - 1] : on + ' of ' + MONTHS[(r.month || 1) - 1]);
  }
}

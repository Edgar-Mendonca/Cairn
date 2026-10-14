// Working-time calendars,
// plus exceptions (dates that are non-working or have different hours). A calendar can derive from a base
// calendar and override only some days, which is how resource calendars work.
//
// All schedule arithmetic goes through `WorkCalendar`, which keeps a running total of working minutes per day
// so that "add 3 days of work", "working time between two dates" and "next working moment" are fast.
import { atDay, dayOf, dayFromYmd, minuteOfDay, parseIso, weekday, type Minutes } from './time';
import { occurrences, type RecurRule } from './recur';

export interface WorkingTime { from: number; to: number } // minutes after midnight; `to` may be 1440
// ISO dates; no times = non-working. A recurring exception repeats from `start` until `finish` (or `count` times).
export interface CalendarException { name: string; start: string; finish: string; times: WorkingTime[]; recur?: RecurRule & { count: number } }
export interface CalendarDef {
  id: string;
  name: string;
  base: string | null;               // derived calendars name their base calendar
  week: (WorkingTime[] | null)[];    // index 0 = Sunday; null = same as the base calendar
  exceptions: CalendarException[];
}

const H = 60;
export const STANDARD_TIMES: WorkingTime[] = [{ from: 8 * H, to: 12 * H }, { from: 13 * H, to: 17 * H }];

export function standardCalendar(): CalendarDef {
  return { id: 'standard', name: 'Standard', base: null, week: [[], STANDARD_TIMES, STANDARD_TIMES, STANDARD_TIMES, STANDARD_TIMES, STANDARD_TIMES, []].map(d => d.map(t => ({ ...t }))), exceptions: [] };
}

export function hours24Calendar(): CalendarDef {
  const all = [{ from: 0, to: 1440 }];
  return { id: '24hours', name: '24 Hours', base: null, week: [0, 1, 2, 3, 4, 5, 6].map(() => all.map(t => ({ ...t }))), exceptions: [] };
}

export function nightShiftCalendar(): CalendarDef {
  const late = [{ from: 23 * H, to: 1440 }];
  const night = [{ from: 0, to: 3 * H }, { from: 4 * H, to: 8 * H }, { from: 23 * H, to: 1440 }];
  const morning = [{ from: 0, to: 3 * H }, { from: 4 * H, to: 8 * H }];
  return { id: 'nightshift', name: 'Night Shift', base: null, week: [[], late, night, night, night, night, morning], exceptions: [] };
}

export function derivedCalendar(id: string, name: string, base: string): CalendarDef {
  return { id, name, base, week: [null, null, null, null, null, null, null], exceptions: [] };
}

export const minutesIn = (times: WorkingTime[]) => times.reduce((a, t) => a + Math.max(0, t.to - t.from), 0);

// Normalises working times: sorted, clipped to the day, overlaps merged.
export function cleanTimes(times: WorkingTime[]): WorkingTime[] {
  const t = times.map(x => ({ from: Math.max(0, Math.min(1440, Math.round(x.from))), to: Math.max(0, Math.min(1440, Math.round(x.to))) }))
    .filter(x => x.to > x.from).sort((a, b) => a.from - b.from);
  const out: WorkingTime[] = [];
  t.forEach(x => { const last = out[out.length - 1]; if (last && x.from <= last.to) last.to = Math.max(last.to, x.to); else out.push(x); });
  return out;
}

const ORIGIN = dayFromYmd(1984, 1, 1);
const LIMIT = dayFromYmd(2149, 12, 31);
const CHUNK = 400;

export class WorkCalendar {
  readonly id: string;
  private week: WorkingTime[][];
  private exceptions = new Map<number, WorkingTime[]>();
  private cum: number[] = [0]; // cum[i] = working minutes from ORIGIN to the start of day ORIGIN + i
  readonly hasWork: boolean;

  constructor(def: CalendarDef, all: Map<string, CalendarDef>) {
    this.id = def.id;
    // Resolve the chain of base calendars (derived calendar wins day by day; exceptions accumulate, nearest wins).
    const chain: CalendarDef[] = [];
    for (let c: CalendarDef | undefined = def, guard = 0; c && guard < 10; c = c.base ? all.get(c.base) : undefined, guard++) chain.push(c);
    this.week = [0, 1, 2, 3, 4, 5, 6].map(d => {
      for (const c of chain) { const w = c.week[d]; if (w) return cleanTimes(w); }
      return d === 0 || d === 6 ? [] : STANDARD_TIMES;
    });
    for (let i = chain.length - 1; i >= 0; i--) {
      chain[i].exceptions.forEach(ex => {
        const a = parseIso(ex.start), b = parseIso(ex.finish || ex.start);
        if (a == null) return;
        const times = cleanTimes(ex.times || []);
        if (ex.recur) {
          const end = b != null && b > a ? dayOf(b) : null;
          occurrences(ex.recur, dayOf(a), end, ex.recur.count || 1).forEach(d => this.exceptions.set(d, times));
          return;
        }
        for (let d = dayOf(a), e = dayOf(b ?? a); d <= e && d - dayOf(a) < 20000; d++) this.exceptions.set(d, times);
      });
    }
    this.hasWork = this.week.some(w => w.length > 0) || [...this.exceptions.values()].some(w => w.length > 0);
  }

  // Working times on one day.
  times(day: number): WorkingTime[] {
    return this.exceptions.get(day) ?? this.week[weekday(day)];
  }

  isWorkingDay(day: number) { return this.times(day).length > 0; }
  minutesOn(day: number) { return minutesIn(this.times(day)); }

  private ensure(day: number) {
    const idx = Math.min(day, LIMIT) - ORIGIN + 1;
    while (this.cum.length <= idx) {
      const end = this.cum.length + CHUNK;
      for (let i = this.cum.length; i < end; i++) this.cum.push(this.cum[i - 1] + this.minutesOn(ORIGIN + i - 1));
    }
  }

  private cumAt(day: number): number {
    if (day <= ORIGIN) return 0;
    this.ensure(day);
    return this.cum[Math.min(day, LIMIT) - ORIGIN];
  }

  // Working minutes from the calendar origin to time t.
  workBefore(t: Minutes): number {
    const day = dayOf(t);
    if (day < ORIGIN) return 0;
    let w = this.cumAt(day);
    const mo = minuteOfDay(t);
    for (const x of this.times(day)) { if (mo <= x.from) break; w += Math.min(mo, x.to) - x.from; }
    return w;
  }

  workBetween(a: Minutes, b: Minutes): number { return this.workBefore(b) - this.workBefore(a); }

  // Smallest day index i (from ORIGIN) with cum[i + 1] >= target, i.e. the day on which the total reaches target.
  private dayReaching(target: number, strict: boolean): number {
    if (this.cum.length < 2) this.ensure(ORIGIN + CHUNK);
    // Grow the table until it passes the target.
    while (this.cum[this.cum.length - 1] < target + (strict ? 1 : 0) && ORIGIN + this.cum.length < LIMIT) this.ensure(ORIGIN + this.cum.length + CHUNK);
    let lo = 0, hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? this.cum[mid + 1] > target : this.cum[mid + 1] >= target) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  // The earliest moment by which `target` working minutes have passed: an end of work (e.g. 17:00, not 8:00 next day).
  private earliest(target: number): Minutes {
    const i = this.dayReaching(target, false), day = ORIGIN + i;
    let acc = this.cum[i];
    for (const x of this.times(day)) {
      if (acc + (x.to - x.from) >= target) return atDay(day, x.from + (target - acc));
      acc += x.to - x.from;
    }
    return atDay(day + 1);
  }

  // The latest moment at which only `target` working minutes have passed: a start of work (e.g. 8:00, not 17:00 the day before).
  private latest(target: number): Minutes {
    const i = this.dayReaching(target, true), day = ORIGIN + i;
    let acc = this.cum[i];
    for (const x of this.times(day)) {
      if (acc + (x.to - x.from) > target) return atDay(day, x.from + Math.max(0, target - acc));
      acc += x.to - x.from;
    }
    return atDay(day + 1);
  }

  // Next moment at or after t when work happens (a task starting at 17:00 starts at 8:00 the next working day).
  nextWorkStart(t: Minutes): Minutes {
    if (!this.hasWork) return t;
    const mo = minuteOfDay(t);
    if (this.times(dayOf(t)).some(x => mo >= x.from && mo < x.to)) return t;
    return this.latest(this.workBefore(t));
  }

  // Last moment at or before t when work ended (a task finishing at 8:00 Monday finishes at 17:00 Friday).
  prevWorkEnd(t: Minutes): Minutes {
    if (!this.hasWork) return t;
    const mo = minuteOfDay(t);
    if (this.times(dayOf(t)).some(x => mo > x.from && mo <= x.to)) return t;
    return this.earliest(this.workBefore(t));
  }

  // Moves forward by `work` working minutes. The result is an end of work when the move ends on a boundary.
  add(t: Minutes, work: number): Minutes {
    if (!this.hasWork) return t + work;
    if (work < 0) return this.sub(t, -work);
    if (work === 0) return t;
    return this.earliest(this.workBefore(t) + work);
  }

  // Moves backward by `work` working minutes. The result is a start of work when the move ends on a boundary.
  sub(t: Minutes, work: number): Minutes {
    if (!this.hasWork) return t - work;
    if (work < 0) return this.add(t, -work);
    if (work === 0) return t;
    return this.latest(Math.max(0, this.workBefore(t) - work));
  }
}

export class CalendarSet {
  private defs = new Map<string, CalendarDef>();
  private cache = new Map<string, WorkCalendar>();
  constructor(defs: CalendarDef[]) { defs.forEach(d => this.defs.set(d.id, d)); }
  get(id: string | null | undefined, fallback = 'standard'): WorkCalendar {
    const key = id && this.defs.has(id) ? id : this.defs.has(fallback) ? fallback : [...this.defs.keys()][0];
    let c = this.cache.get(key);
    if (!c) {
      const def = this.defs.get(key) || standardCalendar();
      c = new WorkCalendar(def, this.defs);
      this.cache.set(key, c);
    }
    return c;
  }
}

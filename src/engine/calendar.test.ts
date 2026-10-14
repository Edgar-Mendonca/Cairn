import { describe, expect, it } from 'vitest';
import { CalendarSet, derivedCalendar, hours24Calendar, nightShiftCalendar, standardCalendar, WorkCalendar, type CalendarDef } from './calendar';
import { formatDuration, parseDuration, DEFAULT_TIME } from './duration';
import { fmtDate, isoDateTime, parseDateText, parseIso } from './time';

const T = (s: string) => parseIso(s)!;
const S = (t: number) => isoDateTime(t).slice(0, 16);
const cal = (defs: CalendarDef[] = [standardCalendar()], id = 'standard') => new CalendarSet(defs).get(id);

describe('standard calendar arithmetic ', () => {
  const c = cal();
  // Mon 5 Jan 2026 is a Monday.
  it('adds working time and finishes at the end of work, not the next morning', () => {
    expect(S(c.add(T('2026-01-05T08:00'), 480))).toBe('2026-01-05T17:00');
    expect(S(c.add(T('2026-01-05T08:00'), 5 * 480))).toBe('2026-01-09T17:00');
    expect(S(c.add(T('2026-01-05T08:00'), 6 * 480))).toBe('2026-01-12T17:00');
    expect(S(c.add(T('2026-01-05T08:00'), 300))).toBe('2026-01-05T14:00'); // lunch skipped
    expect(S(c.add(T('2026-01-05T08:00'), 240))).toBe('2026-01-05T12:00');
  });

  it('moves a start to the next working moment', () => {
    expect(S(c.nextWorkStart(T('2026-01-09T17:00')))).toBe('2026-01-12T08:00'); // Fri 17:00 -> Mon 8:00
    expect(S(c.nextWorkStart(T('2026-01-05T12:00')))).toBe('2026-01-05T13:00'); // lunch
    expect(S(c.nextWorkStart(T('2026-01-05T09:30')))).toBe('2026-01-05T09:30');
    expect(S(c.nextWorkStart(T('2026-01-10T10:00')))).toBe('2026-01-12T08:00'); // Saturday
  });

  it('moves a finish back to the previous end of work', () => {
    expect(S(c.prevWorkEnd(T('2026-01-12T08:00')))).toBe('2026-01-09T17:00');
    expect(S(c.prevWorkEnd(T('2026-01-05T13:00')))).toBe('2026-01-05T12:00');
  });

  it('subtracts working time and lands on a start of work', () => {
    expect(S(c.sub(T('2026-01-09T17:00'), 480))).toBe('2026-01-09T08:00');
    expect(S(c.sub(T('2026-01-12T08:00'), 60))).toBe('2026-01-09T16:00');
    expect(S(c.sub(T('2026-01-12T17:00'), 2 * 480))).toBe('2026-01-09T08:00');
  });

  it('measures working time between two moments', () => {
    expect(c.workBetween(T('2026-01-05T08:00'), T('2026-01-12T08:00'))).toBe(2400);
    expect(c.workBetween(T('2026-01-12T08:00'), T('2026-01-05T08:00'))).toBe(-2400);
    expect(c.workBetween(T('2026-01-09T17:00'), T('2026-01-12T08:00'))).toBe(0);
  });

  it('works far into the future and across years', () => {
    expect(S(c.add(T('2026-01-05T08:00'), 260 * 480))).toBe('2027-01-01T17:00');
    expect(c.workBetween(T('2026-01-01T00:00'), T('2036-01-01T00:00'))).toBe(c.workBetween(T('2026-01-01T00:00'), T('2031-01-01T00:00')) + c.workBetween(T('2031-01-01T00:00'), T('2036-01-01T00:00')));
  });
});

describe('exceptions and derived calendars', () => {
  const std = standardCalendar();
  std.exceptions.push({ name: 'Holiday', start: '2026-01-07', finish: '2026-01-08', times: [] });
  std.exceptions.push({ name: 'Saturday shift', start: '2026-01-10', finish: '2026-01-10', times: [{ from: 480, to: 720 }] });
  const res = derivedCalendar('r1', 'Ann', 'standard');
  res.week[5] = []; // Ann does not work Fridays
  res.exceptions.push({ name: 'Leave', start: '2026-01-12', finish: '2026-01-12', times: [] });
  const set = new CalendarSet([std, res]);

  it('skips non-working exception days and uses working exceptions', () => {
    const c = set.get('standard');
    expect(S(c.add(T('2026-01-05T08:00'), 3 * 480))).toBe('2026-01-09T17:00');
    expect(S(c.add(T('2026-01-09T08:00'), 480 + 240))).toBe('2026-01-10T12:00');
  });

  it('derives from the base calendar and inherits its exceptions', () => {
    const c = set.get('r1');
    // Mon 5, Tue 6 work; 7-8 holiday; Fri 9 off for Ann; Sat 10 morning; Mon 12 leave; Tue 13.
    expect(S(c.add(T('2026-01-05T08:00'), 3 * 480))).toBe('2026-01-13T12:00');
  });
});

describe('other base calendars', () => {
  it('24 Hours runs around the clock', () => {
    const c = cal([hours24Calendar()], '24hours');
    expect(S(c.add(T('2026-01-10T00:00'), 3 * 1440))).toBe('2026-01-13T00:00');
  });
  it('Night Shift starts Monday 23:00', () => {
    const c = cal([nightShiftCalendar()], 'nightshift');
    expect(S(c.nextWorkStart(T('2026-01-05T08:00')))).toBe('2026-01-05T23:00');
    expect(S(c.add(T('2026-01-05T23:00'), 480))).toBe('2026-01-06T08:00');
  });
  it('a calendar with no working time falls back to clock time', () => {
    const empty: CalendarDef = { id: 'x', name: 'x', base: null, week: [[], [], [], [], [], [], []], exceptions: [] };
    const c = new WorkCalendar(empty, new Map([['x', empty]]));
    expect(c.add(100, 50)).toBe(150);
  });
});

describe('durations', () => {
  it('parses duration text', () => {
    expect(parseDuration('3')).toEqual({ minutes: 1440, unit: 'd', elapsed: false, estimated: false });
    expect(parseDuration('2w')!.minutes).toBe(4800);
    expect(parseDuration('2.5 wks')!.minutes).toBe(6000);
    expect(parseDuration('4 hrs')!.minutes).toBe(240);
    expect(parseDuration('30 mins')!.minutes).toBe(30);
    expect(parseDuration('1 mon')!.minutes).toBe(9600);
    expect(parseDuration('3ed')).toEqual({ minutes: 4320, unit: 'd', elapsed: true, estimated: false });
    expect(parseDuration('1 day?')!.estimated).toBe(true);
    expect(parseDuration('2,5d')!.minutes).toBe(1200);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('3 parsecs')).toBeNull();
  });
  it('formats', () => {
    const f = (t: string) => formatDuration(parseDuration(t)!, DEFAULT_TIME);
    expect(f('1d')).toBe('1 day');
    expect(f('5')).toBe('5 days');
    expect(f('2w')).toBe('2 wks');
    expect(f('4h')).toBe('4 hrs');
    expect(f('3ed')).toBe('3 edays');
    expect(f('1d?')).toBe('1 day?');
    expect(f('0d')).toBe('0 days');
  });
});

describe('dates', () => {
  const today = T('2026-03-10');
  it('parses typed dates', () => {
    expect(parseDateText('5 Jan 26', 'dmy', today)).toEqual({ day: T('2026-01-05') / 1440, minute: null });
    expect(parseDateText('Mon 5 Jan 26 13:00', 'dmy', today)).toEqual({ day: T('2026-01-05') / 1440, minute: 780 });
    expect(parseDateText('Jan 5, 2026', 'dmy', today)!.day).toBe(T('2026-01-05') / 1440);
    expect(parseDateText('5/1/26', 'dmy', today)!.day).toBe(T('2026-01-05') / 1440);
    expect(parseDateText('1/5/26', 'mdy', today)!.day).toBe(T('2026-01-05') / 1440);
    expect(parseDateText('2026-01-05', 'dmy', today)!.day).toBe(T('2026-01-05') / 1440);
    expect(parseDateText('today 5pm', 'dmy', today)).toEqual({ day: today / 1440, minute: 1020 });
    expect(parseDateText('31/2/26', 'dmy', today)).toBeNull();
    // US entries and mixed orders
    const D = (s: string) => T(s) / 1440;
    expect(parseDateText('11/20/2026', 'dmy', today)!.day).toBe(D('2026-11-20')); // month 20 impossible -> m/d
    expect(parseDateText('10/13/26', 'nmdy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText("Oct 13 '26", 'dmy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText("Tue Oct 13 '26 8:00 AM", 'mdy', today)).toEqual({ day: D('2026-10-13'), minute: 480 });
    expect(parseDateText('October 13, 2026', 'dmy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText('13-Oct-2026', 'dmy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText('13.10.2026', 'dmy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText('2026/10/13', 'dmy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText('Oct 13th', 'dmy', today)!.day).toBe(D('2026-10-13'));
    expect(parseDateText('13 Oct 26 5pm', 'dmy', today)).toEqual({ day: D('2026-10-13'), minute: 1020 });
    expect(parseDateText('Mon 13 Oct 26 08:00', 'dmy', today)!.minute).toBe(480);
    expect(parseDateText('soon', 'dmy', today)).toBeNull();
  });
  it('formats dates', () => {
    expect(fmtDate(T('2026-01-05T08:00'))).toBe('Mon 5 Jan 26');
    expect(fmtDate(T('2026-01-05T08:00'), { time: true })).toBe('Mon 5 Jan 26 08:00');
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(T('2026-10-13T08:00'), { format: 'mdy' })).toBe("Tue Oct 13 '26");
    expect(fmtDate(T('2026-10-13T08:00'), { format: 'nmdy' })).toBe('Tue 10/13/26');
    expect(fmtDate(T('2026-10-13T08:00'), { format: 'ndmy' })).toBe('Tue 13/10/26');
    // Every display format reads back to the same date and time.
    for (const f of ['dmy', 'mdy', 'ndmy', 'nmdy', 'iso'] as const) {
      const t = T('2026-03-04T13:30');
      const p = parseDateText(fmtDate(t, { format: f, time: true }), f, today)!;
      expect(p.day * 1440 + p.minute!).toBe(t);
    }
  });
});

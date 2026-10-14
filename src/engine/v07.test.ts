// Tests for the version 0.7 engine features: split tasks, scheduling from the finish date, driving links,
// multiple critical paths, recurring tasks and calendar exceptions, WBS codes, moving rows, tracking edits,
// filters and groups, timephased data, rate tables, availability and leveling options.
import { describe, expect, it } from 'vitest';
import { blankProject, newTask, normalizeProject, type Project, type Recurrence } from './model';
import { schedule, wbsCode } from './schedule';
import { addResources, copyInterim, editCell, insertRecurring, moveBlock, moveSegment, reassign, rescheduleUncompleted, splitTask, updateAssignment, autolinkInserted, insertTasks } from './ops';
import { isoDateTime, parseIso, dayOf, unitStart, unitNext, formatUnitLabel } from './time';
import { occurrences } from './recur';
import { BUILTIN_FILTERS, testFilter } from './filters';
import { buckets, contourAt, phasedResource, phasedTask } from './timephase';
import { levelResources } from './level';
import { CalendarSet, standardCalendar } from './calendar';

const T = (s: string) => parseIso(s)!;
const S = (t: number) => isoDateTime(t).slice(0, 16);

function plan(rows: [string, string, string?, number?][], tweak?: (p: Project) => void) {
  let p = blankProject('Test');
  p.start = T('2026-01-05T08:00');
  rows.forEach(([name, , , level]) => p.tasks.push(newTask(p, { name, level: level ?? 1, estimated: false })));
  let s = schedule(p);
  rows.forEach(([, dur], i) => { const r = editCell(p, s, p.tasks[i].uid, 'duration', dur); p = r.p; });
  s = schedule(p);
  rows.forEach(([, , preds], i) => { if (preds) { const r = editCell(p, s, p.tasks[i].uid, 'preds', preds); if (r.error) throw new Error(r.error); p = r.p; } });
  if (tweak) tweak(p);
  return { p, s: schedule(p) };
}
const row = (s: ReturnType<typeof schedule>, name: string) => s.rows.find(r => r.task.name === name)!;
const uid = (p: Project, name: string) => p.tasks.find(t => t.name === name)!.uid;

describe('split tasks', () => {
  it('a split adds the pause to the finish, keeps the duration, and successors follow', () => {
    const { p, s } = plan([['A', '5d'], ['B', '1d', '1']]);
    const r = splitTask(p, s, uid(p, 'A'), T('2026-01-07T08:00'), 2 * 480);
    expect(r.error).toBeUndefined();
    const s2 = schedule(r.p);
    const a = row(s2, 'A');
    expect(a.duration).toBe(5 * 480);
    expect(a.segments!.map(x => [S(x[0]), S(x[1])])).toEqual([['2026-01-05T08:00', '2026-01-06T17:00'], ['2026-01-09T08:00', '2026-01-13T17:00']]);
    expect(S(a.finish)).toBe('2026-01-13T17:00');
    expect(S(row(s2, 'B').start)).toBe('2026-01-14T08:00');
  });
  it('dragging the second part changes the pause; no pause joins the parts', () => {
    const { p, s } = plan([['A', '5d']]);
    const p2 = splitTask(p, s, uid(p, 'A'), T('2026-01-07T08:00'), 480).p;
    const p3 = moveSegment(p2, uid(p, 'A'), 1, -480).p;
    expect(p3.tasks[0].splits).toBeUndefined();
    expect(S(schedule(p3).rows[0].finish)).toBe('2026-01-09T17:00');
  });
  it('complete-through follows the parts of a split task', () => {
    const { p, s } = plan([['A', '4d']]);
    let p2 = splitTask(p, s, uid(p, 'A'), T('2026-01-07T08:00'), 480).p;
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'percent', '75').p;
    const a = schedule(p2).rows[0];
    expect(S(a.completeThrough)).toBe('2026-01-08T17:00');
  });
});

describe('schedule from the project finish date', () => {
  it('places tasks as late as possible so the plan ends on the finish date', () => {
    const { s } = plan([['A', '2d'], ['B', '3d', '1'], ['C', '1d']], p => { p.scheduleFrom = 'finish'; p.finish = T('2026-01-30T17:00'); });
    expect(S(s.finish)).toBe('2026-01-30T17:00');
    expect(S(row(s, 'B').finish)).toBe('2026-01-30T17:00');
    expect(S(row(s, 'A').start)).toBe('2026-01-26T08:00');
    expect(S(row(s, 'C').start)).toBe('2026-01-30T08:00');
    expect(S(s.start)).toBe('2026-01-26T08:00');
  });
});

describe('driving links and multiple critical paths', () => {
  it('marks the link that sets the start as driving', () => {
    const { s } = plan([['A', '2d'], ['B', '5d'], ['C', '1d', '1,2']]);
    const into = s.edges.filter(e => s.rows[e.to].task.name === 'C');
    expect(into.find(e => s.rows[e.from].task.name === 'B')!.driving).toBe(true);
    expect(into.find(e => s.rows[e.from].task.name === 'A')!.driving).toBe(false);
  });
  it('with multiple critical paths each chain end is critical', () => {
    const base = plan([['A', '2d'], ['B', '5d']]);
    expect(row(base.s, 'A').critical).toBe(false);
    const multi = plan([['A', '2d'], ['B', '5d']], p => { p.settings.multipleCritical = true; });
    expect(row(multi.s, 'A').critical).toBe(true);
    expect(row(multi.s, 'B').critical).toBe(true);
  });
});

describe('recurrence', () => {
  it('weekly on Monday and Thursday', () => {
    const start = dayOf(T('2026-01-05T00:00'));
    const days = occurrences({ pattern: 'weekly', every: 1, days: [1, 4], monthDay: 0, nth: 1, weekday: 1, month: 1 }, start, null, 4);
    expect(days.map(d => S(d * 1440).slice(0, 10))).toEqual(['2026-01-05', '2026-01-08', '2026-01-12', '2026-01-15']);
  });
  it('monthly on the last Friday, and yearly on 25 December', () => {
    const start = dayOf(T('2026-01-01T00:00'));
    const last = occurrences({ pattern: 'monthly', every: 1, days: [], monthDay: 0, nth: 5, weekday: 5, month: 1 }, start, null, 3);
    expect(last.map(d => S(d * 1440).slice(0, 10))).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
    const xmas = occurrences({ pattern: 'yearly', every: 1, days: [], monthDay: 25, nth: 1, weekday: 0, month: 12 }, start, null, 2);
    expect(xmas.map(d => S(d * 1440).slice(0, 10))).toEqual(['2026-12-25', '2027-12-25']);
  });
  it('a recurring calendar exception makes every 25 December non-working', () => {
    const c = standardCalendar();
    c.exceptions.push({ name: 'Christmas', start: '2026-12-25', finish: '2026-12-25', times: [], recur: { pattern: 'yearly', every: 1, days: [], monthDay: 25, nth: 1, weekday: 0, month: 12, count: 5 } });
    const cal = new CalendarSet([c]).get('standard');
    expect(cal.isWorkingDay(dayOf(T('2026-12-25T00:00')))).toBe(false);
    expect(cal.isWorkingDay(dayOf(T('2028-12-25T00:00')))).toBe(false);
    expect(cal.isWorkingDay(dayOf(T('2026-12-24T00:00')))).toBe(true);
  });
  it('a recurring task is a summary with one subtask per occurrence', () => {
    const p = blankProject('R'); p.start = T('2026-01-05T08:00');
    const rec: Recurrence = { pattern: 'weekly', every: 1, days: [1], monthDay: 0, nth: 1, weekday: 1, month: 1, from: T('2026-01-05T08:00'), until: null, count: 6, duration: 60, durUnit: 'h', workdaysOnly: true };
    const out = insertRecurring(p, schedule(p), 0, 'Team meeting', rec);
    if ('error' in out) throw new Error(out.error);
    const s = schedule(out.p);
    expect(out.count).toBe(6);
    expect(s.rows[0].summary).toBe(true);
    expect(s.rows[0].task.recurrence?.count).toBe(6);
    expect(S(s.rows[6].start)).toBe('2026-02-09T08:00');
    expect(S(s.rows[6].finish)).toBe('2026-02-09T09:00');
  });
});

describe('WBS codes and outline numbers', () => {
  it('formats a code mask with prefix, letters and padding', () => {
    expect(wbsCode({ prefix: 'PC-', levels: [{ seq: 'num', length: 2, sep: '.' }, { seq: 'upper', length: 0, sep: '-' }, { seq: 'lower', length: 0, sep: '.' }] }, [3, 2, 28])).toBe('PC-03.B-ab');
  });
  it('keeps the outline number separate from a WBS code typed by hand', () => {
    const { p, s } = plan([['P', '', '', 1], ['A', '1d', '', 2]]);
    const p2 = editCell(p, s, uid(p, 'A'), 'wbs', 'X-9').p;
    const r = row(schedule(p2), 'A');
    expect(r.wbs).toBe('X-9');
    expect(r.outline).toBe('1.1');
  });
});

describe('moving rows by dragging', () => {
  it('moves a summary with its subtasks and takes the level of the drop place', () => {
    const { p } = plan([['P1', '', '', 1], ['a', '1d', '', 2], ['P2', '', '', 1], ['b', '1d', '', 2], ['c', '1d', '', 2]]);
    const out = moveBlock(p, [uid(p, 'P2')], uid(p, 'P1')).p;
    expect(out.tasks.map(t => t.name + t.level)).toEqual(['P21', 'b2', 'c2', 'P11', 'a2']);
    const out2 = moveBlock(p, [uid(p, 'c')], uid(p, 'a')).p;
    expect(out2.tasks.map(t => t.name + t.level)).toEqual(['P11', 'c2', 'a2', 'P21', 'b2']);
  });
  it('autolinks a task inserted between two linked tasks', () => {
    const { p } = plan([['A', '1d'], ['B', '1d', '1']]);
    const ins = insertTasks(p, 1, 1, { name: 'N' });
    const out = autolinkInserted(ins.p, ins.uids[0]);
    const s = schedule(out);
    expect(row(s, 'B').task.preds.map(l => l.pred)).toEqual([ins.uids[0]]);
    expect(row(s, 'N').task.preds.map(l => l.pred)).toEqual([uid(p, 'A')]);
  });
});

describe('tracking edits', () => {
  it('actual and remaining duration set % complete and duration', () => {
    const { p, s } = plan([['A', '4d']]);
    let p2 = editCell(p, s, uid(p, 'A'), 'actualDuration', '1d').p;
    expect(p2.tasks[0].percent).toBe(25);
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'remainingDuration', '5d').p;
    expect(p2.tasks[0].duration).toBe(6 * 480);
    expect(p2.tasks[0].percent).toBe(17);
  });
  it('actual work sets % complete', () => {
    const { p } = plan([['A', '4d']]);
    const r1 = addResources(p, 1, { name: 'Ann', stdRate: 50 });
    let p2 = editCell(r1.p, schedule(r1.p), uid(p, 'A'), 'resources', 'Ann').p;
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'actualWork', '16h').p;
    expect(p2.tasks[0].percent).toBe(50);
  });
  it('reschedules uncompleted work after the status date by splitting tasks in progress', () => {
    const { p, s } = plan([['A', '4d'], ['B', '2d']]);
    let p2 = editCell(p, s, uid(p, 'A'), 'percent', '25').p;
    p2 = rescheduleUncompleted(p2, schedule(p2), T('2026-01-08T08:00')).p;
    const s2 = schedule(p2);
    expect(S(row(s2, 'A').segments![1][0])).toBe('2026-01-08T08:00');
    expect(S(row(s2, 'A').finish)).toBe('2026-01-10T17:00'.replace('10', '12'));
    expect(row(s2, 'B').task.constraint).toBe('SNET');
    expect(S(row(s2, 'B').start)).toBe('2026-01-08T08:00');
  });
  it('copies current dates into an interim plan', () => {
    const { p, s } = plan([['A', '2d']]);
    const p2 = copyInterim(p, s, 'current', 3);
    expect(S(p2.tasks[0].custom.Start3 as number)).toBe('2026-01-05T08:00');
    expect(S(p2.tasks[0].custom.Finish3 as number)).toBe('2026-01-06T17:00');
  });
});

describe('costs: rate tables, overtime, accrual', () => {
  it('uses the assignment\'s cost rate table and overtime rate', () => {
    const { p } = plan([['A', '1d']]);
    const r1 = addResources(p, 1, { name: 'Ann', stdRate: 50, ovtRate: 80, tables: [{ std: 100, ovt: 150, perUse: 10, changes: [] }, { std: 0, ovt: 0, perUse: 0, changes: [] }, { std: 0, ovt: 0, perUse: 0, changes: [] }, { std: 0, ovt: 0, perUse: 0, changes: [] }] });
    let p2 = editCell(r1.p, schedule(r1.p), uid(p, 'A'), 'resources', 'Ann').p;
    expect(schedule(p2).rows[0].cost).toBe(400);
    p2 = updateAssignment(p2, uid(p, 'A'), r1.uids[0], { rateTable: 1 }).p;
    expect(schedule(p2).rows[0].cost).toBe(810);
    p2 = updateAssignment(p2, uid(p, 'A'), r1.uids[0], { ovt: 120 }).p;
    expect(schedule(p2).rows[0].cost).toBe(10 + 6 * 100 + 2 * 150);
  });
  it('fixed cost accrues at the start, prorated or at the end', () => {
    const { p, s } = plan([['A', '2d']]);
    let p2 = editCell(p, s, uid(p, 'A'), 'fixedCost', '1000').p;
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'percent', '50').p;
    expect(schedule(p2).rows[0].actualCost).toBe(500);
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'accrual', 'Start').p;
    expect(schedule(p2).rows[0].actualCost).toBe(1000);
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'accrual', 'End').p;
    expect(schedule(p2).rows[0].actualCost).toBe(0);
  });
});

describe('resource availability and leveling options', () => {
  it('availability that drops makes a resource overallocated only in that period', () => {
    const { p } = plan([['A', '10d']]);
    const r1 = addResources(p, 1, { name: 'Ann', availability: [{ from: null, to: T('2026-01-12T00:00'), units: 1 }, { from: T('2026-01-12T00:00'), to: null, units: 0.5 }] });
    const p2 = editCell(r1.p, schedule(r1.p), uid(p, 'A'), 'resources', 'Ann').p;
    const s2 = schedule(p2);
    expect(s2.overallocated.has(r1.uids[0])).toBe(true);
    expect(S(s2.overTimes.get(r1.uids[0])![0][0])).toBe('2026-01-12T00:00');
  });
  it('level within available slack leaves critical tasks in place', () => {
    const { p } = plan([['A', '3d'], ['B', '3d']]);
    const r1 = addResources(p, 1, { name: 'Ann' });
    let p2 = editCell(r1.p, schedule(r1.p), uid(p, 'A'), 'resources', 'Ann').p;
    p2 = editCell(p2, schedule(p2), uid(p, 'B'), 'resources', 'Ann').p;
    const free = levelResources(p2);
    expect(free.moved).toBe(1);
    const tight = levelResources(p2, { options: { ...p2.leveling, withinSlack: true } });
    expect(tight.moved).toBe(0);
    expect(tight.unresolved).toEqual(['Ann']);
  });
  it('reassigns a task from one resource to another', () => {
    const { p } = plan([['A', '2d']]);
    const r1 = addResources(p, 2, {});
    let p2 = editCell(r1.p, schedule(r1.p), uid(p, 'A'), 'resources', 'Resource').p;
    const first = p2.tasks[0].assignments[0].res;
    p2 = reassign(p2, uid(p, 'A'), first, r1.uids[1]).p;
    expect(p2.tasks[0].assignments.map(a => a.res)).toEqual([r1.uids[1]]);
  });
});

describe('filters and groups', () => {
  it('built-in and custom filters', () => {
    const { p, s } = plan([['A', '2d'], ['B', '0d', '1'], ['C', '5d']]);
    const c = { p, s };
    const ms = BUILTIN_FILTERS.find(f => f.id === 'milestones')!;
    expect(s.rows.filter(r => ms.test(r, c, [])).map(r => r.task.name)).toEqual(['B']);
    const custom = { id: 'x', name: 'Long or B', summaries: false, criteria: [{ join: 'and' as const, field: 'duration', test: 'ge' as const, value: '3d', value2: '' }, { join: 'or' as const, field: 'name', test: 'eq' as const, value: '?Name', value2: '' }] };
    const args = new Map([['?Name', 'b']]);
    expect(s.rows.filter(r => testFilter(r, c, custom, args)).map(r => r.task.name)).toEqual(['B', 'C']);
    const range = BUILTIN_FILTERS.find(f => f.id === 'dateRange')!;
    expect(s.rows.filter(r => range.test(r, c, ['8 Jan 26', '12 Jan 26'])).map(r => r.task.name)).toEqual(['C']);
  });
});

describe('timephased data and timescale units', () => {
  it('contours spread work in tenths', () => {
    expect(contourAt('flat', 0.5)).toBeCloseTo(0.5);
    expect(contourAt('backLoaded', 0.5)).toBeLessThan(0.3);
    expect(contourAt('frontLoaded', 0.5)).toBeGreaterThan(0.7);
  });
  it('spreads work and cost per day and per week', () => {
    const { p } = plan([['A', '5d']]);
    const r1 = addResources(p, 1, { name: 'Ann', stdRate: 10 });
    const p2 = editCell(r1.p, schedule(r1.p), uid(p, 'A'), 'resources', 'Ann').p;
    const s2 = schedule(p2);
    const days = buckets('day', T('2026-01-05T00:00'), T('2026-01-12T00:00'));
    const tp = phasedTask(s2.rows[0], s2, p2, days);
    expect(tp.work.map(w => Math.round(w / 60 * 1000) / 1000)).toEqual([8, 8, 8, 8, 8, 0, 0]);
    expect(tp.cost.reduce((a, b) => a + b, 0)).toBeCloseTo(400);
    const rp = phasedResource(r1.uids[0], s2, p2, buckets('week', T('2026-01-04T00:00'), T('2026-01-18T00:00')));
    expect(rp.work.map(w => Math.round(w / 60 * 1000) / 1000)).toEqual([40, 0]);
    expect(rp.peak).toEqual([1, 0]);
  });
  it('timescale units and labels', () => {
    const t = T('2026-10-14T13:30');
    expect(S(unitStart('week', t, 1))).toBe('2026-10-12T00:00');
    expect(S(unitStart('quarter', t))).toBe('2026-10-01T00:00');
    expect(S(unitStart('third', t))).toBe('2026-10-11T00:00');
    expect(S(unitNext('third', unitStart('third', t)))).toBe('2026-10-21T00:00');
    expect(formatUnitLabel("ddd d MMM 'yy", t)).toBe("Wed 14 Oct '26");
    expect(formatUnitLabel('Qn yyyy', t)).toBe('Q4 2026');
    expect(formatUnitLabel('Qn yyyy', t, 7)).toBe('Q2 2027');
    expect(formatUnitLabel('h am', t)).toBe('1 pm');
  });
});

describe('saved files', () => {
  it('keeps the 0.7 fields through a save and load', () => {
    const { p, s } = plan([['A', '5d']]);
    let p2 = splitTask(p, s, uid(p, 'A'), T('2026-01-07T08:00')).p;
    p2 = editCell(p2, schedule(p2), uid(p, 'A'), 'hyperlinkAddress', 'https://example.com').p;
    p2 = { ...p2, scheduleFrom: 'finish', finish: T('2026-03-02T17:00'), wbsMask: { prefix: 'X', levels: [{ seq: 'num', length: 0, sep: '.' }] } };
    p2.gantt = { ...p2.gantt, layout: { ...p2.gantt.layout, barHeight: 16 } };
    const back = normalizeProject(JSON.parse(JSON.stringify(p2)));
    expect(back.tasks[0].splits).toEqual(p2.tasks[0].splits);
    expect(back.tasks[0].hyperlink?.address).toBe('https://example.com');
    expect(back.scheduleFrom).toBe('finish');
    expect(back.gantt.layout.barHeight).toBe(16);
    expect(back.wbsMask?.prefix).toBe('X');
  });
});

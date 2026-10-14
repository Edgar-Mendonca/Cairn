// Timephased data: work and cost spread over time, as in the Task hours, Workload and Resource Graph
// views and the burndown and cash-flow reports. Work follows the assignment's work contour; cost follows work,
// except per-use costs (at the start) and fixed costs (by their accrual).
import type { Assignment, Contour, Project, Resource } from './model';
import { accrued, maxUnitsAt, ratesAt, type Row, type Schedule } from './schedule';
import { unitNext, unitStart, type Minutes, type Unit } from './time';
import type { WorkCalendar } from './calendar';

// Share of the work in each tenth of the assignment (the standard contours).
export const CONTOURS: Record<Contour, number[]> = {
  flat: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  backLoaded: [10, 15, 25, 50, 50, 75, 75, 100, 100, 100],
  frontLoaded: [100, 100, 100, 75, 75, 50, 50, 25, 15, 10],
  doublePeak: [25, 50, 100, 50, 25, 25, 50, 100, 50, 25],
  earlyPeak: [25, 50, 100, 100, 75, 50, 50, 25, 15, 10],
  latePeak: [10, 15, 25, 50, 50, 75, 100, 100, 50, 25],
  bell: [10, 20, 40, 80, 100, 100, 80, 40, 20, 10],
  turtle: [25, 50, 75, 100, 100, 100, 100, 75, 50, 25]
};
const CUM: Record<string, number[]> = {};
for (const [k, w] of Object.entries(CONTOURS)) {
  const total = w.reduce((a, b) => a + b, 0);
  const c = [0];
  w.forEach(x => c.push(c[c.length - 1] + x / total));
  CUM[k] = c;
}
// Cumulative share of work done at position u (0–1) through the assignment.
export function contourAt(contour: Contour | undefined, u: number): number {
  const c = CUM[contour || 'flat'];
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const k = Math.floor(u * 10);
  return c[k] + (c[k + 1] - c[k]) * (u * 10 - k);
}

export interface Bucket { start: Minutes; end: Minutes }
export function buckets(unit: Unit, from: Minutes, to: Minutes, weekStart = 0, fiscal = 1, count = 1): Bucket[] {
  const out: Bucket[] = [];
  for (let t = unitStart(unit, from, weekStart, fiscal); t < to && out.length < 5000; t = unitNext(unit, t, count)) out.push({ start: t, end: unitNext(unit, t, count) });
  return out;
}

// The working periods of a task: its parts when split, otherwise start to finish.
const partsOf = (r: Row): [Minutes, Minutes][] => r.segments || [[r.start, r.finish]];

// Working time of the task between its start and t (pauses excluded).
function workedTo(r: Row, cal: WorkCalendar, t: Minutes, elapsed: boolean): number {
  let w = 0;
  for (const [a, b] of partsOf(r)) {
    if (t <= a) break;
    const e = Math.min(b, t);
    w += elapsed ? e - a : cal.workBetween(a, e);
  }
  return w;
}

export interface Spread { cal: WorkCalendar; total: number; elapsed: boolean }
export function spreadOf(r: Row, s: Schedule, p: Project): Spread {
  const cal = s.calendars.get(r.task.calendar, p.calendar);
  const elapsed = r.task.elapsed;
  return { cal, elapsed, total: workedTo(r, cal, r.finish, elapsed) };
}

// Share (0–1) of an assignment's work that falls in [a, b).
export function shareIn(r: Row, sp: Spread, as: Assignment | null, a: Minutes, b: Minutes): number {
  if (r.finish <= r.start) return a <= r.start && r.start < b ? 1 : 0;
  if (b <= r.start || a >= r.finish || sp.total <= 0) return 0;
  const u = (t: Minutes) => Math.max(0, Math.min(1, workedTo(r, sp.cal, t, sp.elapsed) / sp.total));
  return contourAt(as?.contour, u(b)) - contourAt(as?.contour, u(a));
}

export interface Phased { work: number; actualWork: number; cost: number; actualCost: number }

// Work and cost of one assignment (or the task's own fixed cost when `as` is null) in [a, b).
export function phasedAssignment(r: Row, sp: Spread, p: Project, res: Resource | undefined, as: Assignment | null, a: Minutes, b: Minutes): Phased {
  const share = shareIn(r, sp, as, a, b);
  const done = Math.max(0, Math.min(1, r.percent / 100));
  // Actual part: the share of [a, b) that lies before the "complete through" date.
  const ct = r.completeThrough;
  const actualShare = done <= 0 ? 0 : done >= 1 ? share : b <= ct ? share : a >= ct ? 0 : shareIn(r, sp, as, a, ct);
  if (!as) {
    const fc = r.task.fixedCost;
    const how = r.task.accrual;
    const c = how === 'start' ? (a <= r.start && r.start < b ? fc : 0) : how === 'end' ? (a < r.finish && r.finish <= b ? fc : 0) : fc * share;
    return { work: 0, actualWork: 0, cost: c, actualCost: done > 0 ? (how === 'prorated' || !how ? fc * actualShare : accrued(c, done, how)) : 0 };
  }
  if (!res) return { work: 0, actualWork: 0, cost: 0, actualCost: 0 };
  const startHere = a <= r.start && r.start < b;
  if (res.type === 'Cost') { const c = res.accrue === 'start' ? (startHere ? as.cost : 0) : res.accrue === 'end' ? (a < r.finish && r.finish <= b ? as.cost : 0) : as.cost * share; return { work: 0, actualWork: 0, cost: c, actualCost: done > 0 ? as.cost * actualShare : 0 }; }
  const rt = ratesAt(res, r.start, as.rateTable || 0);
  if (res.type === 'Material') { const c = as.units * rt.std * share + (startHere ? rt.perUse : 0); return { work: 0, actualWork: 0, cost: c, actualCost: as.units * rt.std * actualShare + (startHere && done > 0 ? rt.perUse : 0) }; }
  const ovt = Math.min(as.work, as.ovt || 0);
  const rate = as.work > 0 ? ((as.work - ovt) * rt.std + ovt * rt.ovt) / as.work : rt.std;
  const w = as.work * share, aw = as.work * actualShare;
  return { work: w, actualWork: aw, cost: w / 60 * rate + (startHere ? rt.perUse : 0), actualCost: aw / 60 * rate + (startHere && done > 0 ? rt.perUse : 0) };
}

export interface TaskPhased { work: number[]; actualWork: number[]; cost: number[]; actualCost: number[]; baselineWork: number[]; baselineCost: number[] }

// Timephased values of a task (phases add up their subtasks) for each bucket.
export function phasedTask(r: Row, s: Schedule, p: Project, bks: Bucket[]): TaskPhased {
  const out: TaskPhased = { work: bks.map(() => 0), actualWork: bks.map(() => 0), cost: bks.map(() => 0), actualCost: bks.map(() => 0), baselineWork: bks.map(() => 0), baselineCost: bks.map(() => 0) };
  const leaves: Row[] = [];
  const walk = (x: Row) => { if (x.summary) x.children.forEach(c => walk(s.rows[c])); else if (x.task.active) leaves.push(x); };
  if (r.i < 0) s.rows.filter(x => x.parent === -1).forEach(walk); else walk(r);
  const res = new Map(p.resources.map(x => [x.uid, x]));
  for (const x of leaves) {
    const sp = spreadOf(x, s, p);
    const lo = bks.findIndex(bk => bk.end > x.start);
    for (let k = Math.max(0, lo); k < bks.length && bks[k].start <= x.finish; k++) {
      const bk = bks[k];
      const add = (v: Phased) => { out.work[k] += v.work; out.actualWork[k] += v.actualWork; out.cost[k] += v.cost; out.actualCost[k] += v.actualCost; };
      x.task.assignments.forEach(a => add(phasedAssignment(x, sp, p, res.get(a.res), a, bk.start, bk.end)));
      add(phasedAssignment(x, sp, p, undefined, null, bk.start, bk.end));
    }
    const b = x.baseline;
    if (b) {
      for (let k = 0; k < bks.length; k++) {
        const bk = bks[k];
        let sh = 0;
        if (b.finish <= b.start) sh = bk.start <= b.start && b.start < bk.end ? 1 : 0;
        else if (bk.end > b.start && bk.start < b.finish) { const tot = s.calendar.workBetween(b.start, b.finish) || 1; sh = s.calendar.workBetween(Math.max(b.start, bk.start), Math.min(b.finish, bk.end)) / tot; }
        out.baselineWork[k] += b.work * sh; out.baselineCost[k] += b.cost * sh;
      }
    }
  }
  return out;
}

export interface ResPhased { work: number[]; cost: number[]; peak: number[]; over: boolean[]; avail: number[] }

// Timephased work, cost and peak units of a resource, with the buckets in which it is overallocated.
export function phasedResource(ruid: number, s: Schedule, p: Project, bks: Bucket[]): ResPhased {
  const res = p.resources.find(x => x.uid === ruid);
  const out: ResPhased = { work: bks.map(() => 0), cost: bks.map(() => 0), peak: bks.map(() => 0), over: bks.map(() => false), avail: bks.map(bk => (res ? maxUnitsAt(res, bk.start) : 0)) };
  if (!res) return out;
  const events: [Minutes, number][] = [];
  s.rows.forEach(r => {
    if (r.summary || !r.task.active) return;
    r.task.assignments.forEach(a => {
      if (a.res !== ruid) return;
      const sp = spreadOf(r, s, p);
      const lo = bks.findIndex(bk => bk.end > r.start);
      for (let k = Math.max(0, lo); k < bks.length && bks[k].start <= r.finish; k++) {
        const v = phasedAssignment(r, sp, p, res, a, bks[k].start, bks[k].end);
        out.work[k] += v.work; out.cost[k] += v.cost;
      }
      if (res.type === 'Work') partsOf(r).forEach(([x, y]) => { if (y > x) events.push([x, a.units], [y, -a.units]); });
    });
  });
  // Peak units in each bucket from the step function of assigned units.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let load = 0, e = 0;
  for (let k = 0; k < bks.length; k++) {
    const bk = bks[k];
    while (e < events.length && events[e][0] <= bk.start) { load += events[e][1]; e++; }
    let peak = load;
    let j = e;
    let l2 = load;
    while (j < events.length && events[j][0] < bk.end) { l2 += events[j][1]; if (j + 1 >= events.length || events[j + 1][0] !== events[j][0]) peak = Math.max(peak, l2); j++; }
    out.peak[k] = out.work[k] > 0 ? Math.max(0, peak) : 0; // no work in the bucket (a weekend, say) shows no peak
  }
  const periods = s.overTimes.get(ruid) || [];
  bks.forEach((bk, k) => { out.over[k] = periods.some(([a, b]) => a < bk.end && b > bk.start); });
  return out;
}

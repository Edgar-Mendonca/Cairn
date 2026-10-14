// Resource balancing (Plan › Balance workload), in the standard balancing order:
// tasks are placed one at a time by start date, then priority, then least slack, and each is delayed
// (a "leveling delay") until every work resource on it has capacity for the whole task.
// Tasks that have started, manually scheduled tasks and tasks with Must Start/Finish On are not moved.
import type { LevelOptions, Project, Task } from './model';
import { DEFAULT_LEVELING } from './model';
import { maxUnitsAt, schedule, type Schedule } from './schedule';
import type { Minutes } from './time';

export interface LevelResult { p: Project; moved: number; unresolved: string[] }

interface Use { a: Minutes; b: Minutes; units: number }

function fits(uses: Use[], a: Minutes, b: Minutes, units: number, max: (t: Minutes) => number): boolean {
  // Peak load inside [a, b) when this task is added, against the maximum units at each moment.
  const pts: [Minutes, number][] = [];
  for (const u of uses) if (u.a < b && u.b > a) { pts.push([Math.max(u.a, a), u.units], [Math.min(u.b, b), -u.units]); }
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let load = units;
  if (load > max(a) + 1e-6) return false;
  for (let k = 0; k < pts.length; k++) {
    load += pts[k][1];
    if (k + 1 < pts.length && pts[k + 1][0] === pts[k][0]) continue;
    if (pts[k][0] < b && load > max(pts[k][0]) + 1e-6) return false;
  }
  return true;
}

export function clearLeveling(p: Project, uids?: number[]): Project {
  const set = uids ? new Set(uids) : null;
  return { ...p, tasks: p.tasks.map(t => (t.levelDelay && (!set || set.has(t.uid)) ? { ...t, levelDelay: 0 } : t)) };
}

// A small binary heap keyed by [start, -priority, slack, id].
class Heap<T> {
  private a: [number[], T][] = [];
  private less(x: number[], y: number[]) { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; }
  push(k: number[], v: T) {
    const a = this.a; a.push([k, v]);
    for (let i = a.length - 1; i > 0;) { const pi = (i - 1) >> 1; if (!this.less(a[i][0], a[pi][0])) break; [a[i], a[pi]] = [a[pi], a[i]]; i = pi; }
  }
  pop(): [number[], T] | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.less(a[l][0], a[m][0])) m = l;
        if (r < a.length && this.less(a[r][0], a[m][0])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

export function levelResources(p0: Project, opts: { uids?: number[]; options?: LevelOptions } = {}): LevelResult {
  const o = { ...DEFAULT_LEVELING, ...(opts.options || p0.leveling || {}) };
  let p = o.clearFirst ? clearLeveling(p0, opts.uids) : p0;
  const res = new Map(p.resources.map(r => [r.uid, r]));
  const movable = (t: Task) => t.mode === 'auto' && t.active && t.actualStart == null && t.percent === 0 && t.constraint !== 'MSO' && t.constraint !== 'MFO' && (!opts.uids || opts.uids.includes(t.uid));
  const inRange = (st: Minutes, fi: Minutes) => (o.from == null || fi > o.from) && (o.to == null || st < o.to);
  const unresolved = new Set<string>();
  const movedSet = new Set<number>();
  // Each pass places tasks in balancing order (start, then priority, then least slack). When a task is delayed,
  // its successors are moved along within the same pass, so one pass usually resolves everything; a few more
  // passes catch what the approximation misses.
  for (let pass = 0; pass < 12; pass++) {
    const s: Schedule = schedule(p);
    const rowOf = new Map(s.rows.map(r => [r.task.uid, r]));
    const cur = new Map(s.rows.filter(r => !r.summary).map(r => [r.task.uid, { start: r.start, finish: r.finish }]));
    const out = new Map<number, typeof s.edges>();
    s.edges.forEach(e => { const f = s.rows[e.from].task.uid; out.set(f, (out.get(f) || []).concat(e)); });
    const calOf = (t: Task) => s.calendars.get(t.calendar, p.calendar);
    const dur = (t: Task) => (t.milestone ? 0 : t.duration);
    const addD = (t: Task, at: Minutes, d: number) => (t.elapsed ? at + d : calOf(t).add(at, d));
    const subD = (t: Task, at: Minutes, d: number) => (t.elapsed ? at - d : calOf(t).sub(at, d));
    const startAt = (t: Task, at: Minutes) => (dur(t) > 0 && !t.elapsed ? calOf(t).nextWorkStart(at) : at);
    const heap = new Heap<number>();
    // Balancing order: ID only; Standard (start, then priority, then slack); Priority, Standard.
    const key = (uid: number) => {
      const r = rowOf.get(uid)!, st = cur.get(uid)!.start;
      if (o.order === 'id') return [r.id, st];
      if (o.order === 'priority') return [-r.task.priority, st, r.totalSlack, r.id];
      return [st, -r.task.priority, r.totalSlack, r.id];
    };
    cur.forEach((_, uid) => heap.push(key(uid), uid));
    // Move successors of a task that moved, as the scheduler would.
    const push = (uid: number) => {
      const todo = [uid];
      while (todo.length) {
        const u = todo.pop()!, cu = cur.get(u)!, tu = rowOf.get(u)!.task;
        for (const e of out.get(u) || []) {
          const v = s.rows[e.to].task, cv = cur.get(v.uid);
          if (!cv || v.mode !== 'auto' || v.actualStart != null) continue;
          const lagMin = e.link.lagPercent ? dur(tu) * e.link.lag / 100 : e.link.lag;
          const lagAdd = (at: Minutes) => (!lagMin ? at : e.link.lagElapsed ? at + lagMin : lagMin > 0 ? calOf(v).add(at, lagMin) : calOf(v).sub(at, -lagMin));
          const fin = (f: Minutes) => (dur(v) > 0 ? subD(v, calOf(v).prevWorkEnd(f), dur(v)) : f);
          const cand = e.type === 'FS' ? lagAdd(cu.finish) : e.type === 'SS' ? lagAdd(cu.start) : e.type === 'FF' ? fin(lagAdd(cu.finish)) : fin(lagAdd(cu.start));
          const st = startAt(v, cand);
          if (st > cv.start) { cv.start = st; cv.finish = dur(v) > 0 ? addD(v, st, dur(v)) : st; heap.push(key(v.uid), v.uid); todo.push(v.uid); }
        }
      }
    };
    const usage = new Map<number, Use[]>();
    const placed = new Set<number>();
    const delays = new Map<number, number>();
    unresolved.clear();
    for (let item = heap.pop(); item; item = heap.pop()) {
      const uid = item[1], c = cur.get(uid)!;
      if (placed.has(uid) || (o.order === 'standard' && item[0][0] !== c.start)) continue;
      placed.add(uid);
      const r = rowOf.get(uid)!, t = r.task;
      if (dur(t) <= 0) continue;
      const work = t.assignments.filter(a => res.get(a.res)?.type === 'Work' && a.units > 0);
      if (!work.length) continue;
      const cal = calOf(t);
      const finishOf = (st: Minutes) => addD(t, st, dur(t));
      const ok = (st: Minutes) => work.every(a => { const rr = res.get(a.res)!; return fits(usage.get(a.res) || [], st, finishOf(st), a.units, at => maxUnitsAt(rr, at)); });
      if (!ok(c.start)) {
        if (movable(t) && inRange(c.start, c.finish)) {
          const ends = [...new Set(work.flatMap(a => (usage.get(a.res) || []).map(u => u.b)).filter(e => e > c.start))].sort((x, y) => x - y);
          let found: Minutes | null = null;
          for (const e of ends) { const st = cal.nextWorkStart(e); if (ok(st)) { found = st; break; } }
          // "Level only within available slack": a delay may not exceed the task's total slack.
          if (found != null && o.withinSlack && cal.workBetween(c.start, found) > r.totalSlack + 0.5) found = null;
          if (found != null) {
            delays.set(uid, cal.workBetween(c.start, found));
            c.start = found; c.finish = finishOf(found);
            push(uid);
          } else work.forEach(a => unresolved.add(res.get(a.res)!.name));
        } else work.forEach(a => unresolved.add(res.get(a.res)!.name));
      }
      work.forEach(a => { const list = usage.get(a.res) || []; list.push({ a: c.start, b: c.finish, units: a.units }); usage.set(a.res, list); });
    }
    if (!delays.size) break;
    p = { ...p, tasks: p.tasks.map(x => (delays.has(x.uid) ? { ...x, levelDelay: x.levelDelay + delays.get(x.uid)! } : x)) };
    delays.forEach((_, u) => movedSet.add(u));
  }
  const after = schedule(p);
  after.overallocated.forEach(u => unresolved.add(res.get(u)?.name || ''));
  return { p, moved: movedSet.size, unresolved: [...unresolved].filter(Boolean) };
}

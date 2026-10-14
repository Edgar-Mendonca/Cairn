// The scheduler: the critical path method in working minutes.
//
// 1. Outline: phases, WBS numbers, parent/child links.
// 2. Links on phases are expanded to their subtasks.
// 3. Forward pass (early dates) in link order, honouring lags, constraints, manual tasks and actuals.
// 4. Backward pass (late dates) from the project finish, honouring late constraints and deadlines.
// 5. Slack, critical path, as-late-as-possible tasks, roll-ups, costs, indicators and overallocation.
import { CalendarSet, type WorkCalendar } from './calendar';
import type { Assignment, BaselineEntry, Link, LinkType, Project, Resource, Task } from './model';
import type { Minutes } from './time';

export type Indicator = 'constraint' | 'conflict' | 'deadline' | 'manualWarn' | 'complete' | 'notes' | 'inactive' | 'overallocated' | 'cycle' | 'estimated';

export interface Row {
  task: Task;
  i: number;
  id: number;           // row number, 1-based
  wbs: string;          // WBS code (from the code mask, or typed by hand)
  outline: string;      // outline number (1.2.3)
  summary: boolean;
  parent: number;       // row index, -1 at top level
  children: number[];
  start: Minutes;
  finish: Minutes;
  duration: number;     // working minutes (summaries: project calendar)
  es: Minutes; ef: Minutes; ls: Minutes; lf: Minutes;
  totalSlack: number;
  freeSlack: number;
  critical: boolean;
  work: number;         // minutes
  cost: number;
  actualCost: number;
  actualWork: number;
  percent: number;
  actualStart: Minutes | null;
  actualFinish: Minutes | null;
  remaining: number;    // remaining duration (minutes)
  indicators: Indicator[];
  conflict: string;     // explanation of a constraint conflict or manual-task warning
  baseline: BaselineEntry | null;
  segments: [Minutes, Minutes][] | null;  // working parts of a split task
  completeThrough: Minutes;               // the date up to which the task is complete
  preStart: Minutes; preFinish: Minutes;  // dates before resource balancing
  group?: { label: string; level: number; key: string }; // group header rows (View › Group By)
}

export interface Edge { from: number; to: number; type: LinkType; link: Link; driving: boolean }

export interface Schedule {
  rows: Row[];
  byUid: Map<number, Row>;
  edges: Edge[];
  start: Minutes;
  finish: Minutes;
  duration: number;
  work: number;
  cost: number;
  actualCost: number;
  percent: number;
  cycle: number[];          // row ids on a dependency loop
  calendars: CalendarSet;
  calendar: WorkCalendar;   // project calendar
  overallocated: Set<number>; // resource uids
  overTimes: Map<number, [Minutes, Minutes][]>; // periods when each resource is overallocated
  target: Minutes | null;     // project finish date when scheduling from the finish
}

const INF = Number.POSITIVE_INFINITY;

export interface Rates { std: number; ovt: number; perUse: number }
// Rates of cost rate table `table` (0–4 = A–E) in effect at time t.
export function ratesAt(r: Resource, t: Minutes, table = 0): Rates {
  const tb = table > 0 ? r.tables?.[table - 1] : undefined;
  const out: Rates = tb ? { std: tb.std, ovt: tb.ovt, perUse: tb.perUse } : { std: r.stdRate, ovt: r.ovtRate, perUse: r.costPerUse };
  for (const x of tb ? tb.changes : r.rates) if (x.from <= t) { out.std = x.rate; if (x.ovt != null) out.ovt = x.ovt; if (x.perUse != null) out.perUse = x.perUse; }
  return out;
}
export const rateAt = (r: Resource, t: Minutes, table = 0) => ratesAt(r, t, table).std;

// Maximum units of a resource at time t, from its availability table (Person details › General).
export function maxUnitsAt(r: Resource, t: Minutes): number {
  if (!r.availability?.length) return r.maxUnits;
  for (const a of r.availability) if ((a.from == null || a.from <= t) && (a.to == null || t < a.to)) return a.units;
  return r.maxUnits;
}

// Cost incurred so far for a cost that accrues at the start, prorated, or at the end.
export const accrued = (cost: number, pct: number, how: 'start' | 'prorated' | 'end' | undefined) =>
  how === 'start' ? (pct > 0 ? cost : 0) : how === 'end' ? (pct >= 1 ? cost : 0) : cost * pct;

export function schedule(p: Project, opts: { baselineIndex?: number } = {}): Schedule {
  const tasks = p.tasks, n = tasks.length, s = p.settings;
  const calendars = new CalendarSet(p.calendars);
  const pcal = calendars.get(p.calendar);
  const calOf = (t: Task) => (t.calendar ? calendars.get(t.calendar, p.calendar) : pcal);
  const resByUid = new Map(p.resources.map(r => [r.uid, r]));
  const target = p.scheduleFrom === 'finish' && p.finish != null ? pcal.prevWorkEnd(p.finish) : null;
  const projectStart0 = pcal.nextWorkStart(target != null ? p.start : p.start);
  const baseline = p.baselines[opts.baselineIndex ?? 0] || null;

  // 1. Outline
  const rows: Row[] = tasks.map((t, i) => ({
    task: t, i, id: i + 1, wbs: '', outline: '', summary: i + 1 < n && tasks[i + 1].level > t.level, parent: -1, children: [],
    start: 0, finish: 0, duration: 0, es: 0, ef: 0, ls: 0, lf: 0, totalSlack: 0, freeSlack: 0, critical: false,
    work: 0, cost: 0, actualCost: 0, actualWork: 0, percent: 0, actualStart: null, actualFinish: null, remaining: 0,
    indicators: [], conflict: '', baseline: baseline ? baseline.tasks[t.uid] || null : null,
    segments: null, completeThrough: 0, preStart: 0, preFinish: 0
  }));
  const stack: number[] = [], counters: number[] = [];
  rows.forEach(r => {
    const lv = r.task.level;
    while (stack.length && tasks[stack[stack.length - 1]].level >= lv) stack.pop();
    r.parent = stack.length ? stack[stack.length - 1] : -1;
    if (r.parent >= 0) rows[r.parent].children.push(r.i);
    counters.length = lv;
    counters[lv - 1] = (counters[lv - 1] || 0) + 1;
    r.outline = counters.slice(0, lv).map(c => c || 1).join('.');
    r.wbs = r.task.wbsCode || (p.wbsMask ? wbsCode(p.wbsMask, counters.slice(0, lv).map(c => c || 1)) : r.outline);
    stack.push(r.i);
  });
  const byUid = new Map(rows.map(r => [r.task.uid, r]));
  // A task is active only if it and all its phases are active.
  const active = rows.map(r => { let ok = r.task.active; for (let q = r.parent; ok && q >= 0; q = rows[q].parent) ok = rows[q].task.active; return ok; });
  const leavesOf: number[][] = Array.from({ length: n }, () => []);
  for (let i = n - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r.summary) { if (active[i]) leavesOf[i] = [i]; }
    else r.children.forEach(c => { leavesOf[i] = leavesOf[i].concat(leavesOf[c]); });
  }
  const isAncestor = (a: number, b: number) => { for (let q = rows[b].parent; q >= 0; q = rows[q].parent) if (q === a) return true; return false; };

  // 2. Links, expanded to leaf tasks
  const edges: Edge[] = [];
  rows.forEach(r => {
    r.task.preds.forEach(l => {
      const pr = byUid.get(l.pred);
      if (!pr || pr.i === r.i || isAncestor(pr.i, r.i) || isAncestor(r.i, pr.i)) return;
      for (const a of leavesOf[pr.i]) for (const b of leavesOf[r.i]) if (a !== b) edges.push({ from: a, to: b, type: l.type, link: l, driving: false });
    });
  });
  const leaves = rows.filter(r => !r.summary && active[r.i]).map(r => r.i);
  const preds: Edge[][] = Array.from({ length: n }, () => []), succs: Edge[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  edges.forEach(e => { preds[e.to].push(e); succs[e.from].push(e); indeg[e.to]++; });
  const order: number[] = [];
  const queue = leaves.filter(i => indeg[i] === 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    order.push(v);
    for (const e of succs[v]) if (--indeg[e.to] === 0) queue.push(e.to);
  }
  const stuck = leaves.filter(i => indeg[i] > 0);
  const cyclic = new Set(stuck);
  stuck.forEach(i => order.push(i));
  // Keep only tasks actually on a loop (not merely downstream of one).
  const onLoop = new Set(stuck);
  for (let changed = true; changed;) {
    changed = false;
    for (const i of onLoop) if (!succs[i].some(e => onLoop.has(e.to))) { onLoop.delete(i); changed = true; }
  }

  // Duration helpers
  const dur = (i: number) => {
    const t = tasks[i];
    return t.milestone ? 0 : Math.max(0, t.duration);
  };
  // Split tasks: working time from start to finish includes the pauses.
  const gaps = (i: number) => {
    const t = tasks[i];
    if (!t.splits?.length || t.elapsed) return 0;
    const d = dur(i);
    let g = 0;
    for (const x of t.splits) if (x.after > 0 && x.after < d) g += x.gap;
    return g;
  };
  const span = (i: number) => dur(i) + gaps(i);
  const addD = (i: number, t: Minutes, d: number) => (tasks[i].elapsed ? t + d : calOf(tasks[i]).add(t, d));
  const subD = (i: number, t: Minutes, d: number) => (tasks[i].elapsed ? t - d : calOf(tasks[i]).sub(t, d));
  const lagMinutes = (e: Edge) => (e.link.lagPercent ? dur(e.from) * e.link.lag / 100 : e.link.lag);
  // Lag is applied on the successor's calendar (clock time for elapsed lag).
  const lagAdd = (e: Edge, t: Minutes, sign: 1 | -1) => {
    const lag = lagMinutes(e) * sign;
    if (!lag) return t;
    if (e.link.lagElapsed) return t + lag;
    const c = calOf(tasks[e.to]);
    return lag > 0 ? c.add(t, lag) : c.sub(t, -lag);
  };
  const startAt = (i: number, t: Minutes) => (dur(i) > 0 && !tasks[i].elapsed ? calOf(tasks[i]).nextWorkStart(t) : t);
  const finishAt = (i: number, t: Minutes) => (dur(i) > 0 && !tasks[i].elapsed ? calOf(tasks[i]).prevWorkEnd(t) : t);
  const startForFinish = (i: number, f: Minutes) => (dur(i) > 0 ? subD(i, finishAt(i, f), span(i)) : f);

  // 3. Forward pass. `alapFloor` holds the late starts of as-late-as-possible tasks on the second run.
  const ES = new Array(n).fill(0), EF = new Array(n).fill(0), PRE = new Array(n).fill(0);
  const conflict: string[] = new Array(n).fill('');
  const manualWarn: string[] = new Array(n).fill('');
  let projectStart = projectStart0;
  const forward = (alapFloor: Map<number, Minutes> | null) => {
    for (const i of order) {
      const t = tasks[i], d = dur(i);
      let linkStart = projectStart;
      const cands: [Edge, Minutes][] = [];
      for (const e of preds[i]) {
        e.driving = false;
        if (cyclic.has(i) && cyclic.has(e.from)) continue;
        let cand: Minutes;
        if (e.type === 'FS') cand = lagAdd(e, EF[e.from], 1);
        else if (e.type === 'SS') cand = lagAdd(e, ES[e.from], 1);
        else if (e.type === 'FF') cand = startForFinish(i, lagAdd(e, EF[e.from], 1));
        else cand = startForFinish(i, lagAdd(e, ES[e.from], 1));
        cands.push([e, cand]);
        if (cand > linkStart) linkStart = cand;
      }
      // A Start No Earlier Than (or Must Start On) date on a phase holds back all its subtasks.
      for (let q = rows[i].parent; q >= 0; q = rows[q].parent) {
        const st = tasks[q];
        if (st.constraintDate != null && (st.constraint === 'SNET' || st.constraint === 'MSO') && st.constraintDate > linkStart) linkStart = st.constraintDate;
      }
      let es: Minutes;
      conflict[i] = ''; manualWarn[i] = '';
      if (t.mode === 'manual') {
        es = t.start ?? projectStart;
        if (startAt(i, linkStart) > es + 0.5 && preds[i].length) manualWarn[i] = 'This manually scheduled task starts before its predecessors allow.';
      } else {
        es = linkStart;
        const c = t.constraintDate, honor = s.honorConstraints;
        if (c != null) {
          switch (t.constraint) {
            case 'SNET': es = Math.max(es, c); break;
            case 'FNET': es = Math.max(es, startForFinish(i, c)); break;
            case 'MSO': es = honor ? c : Math.max(es, c); break;
            case 'MFO': es = honor ? startForFinish(i, c) : Math.max(es, startForFinish(i, c)); break;
            case 'SNLT': if (honor && startAt(i, es) > c) es = c; break;
            case 'FNLT': if (honor && addD(i, startAt(i, es), span(i)) > c) es = startForFinish(i, c); break;
          }
          if (startAt(i, es) < startAt(i, linkStart) - 0.5) conflict[i] = 'The ' + t.constraint + ' constraint date is earlier than its predecessors allow.';
        }
        const floor = alapFloor?.get(i);
        if (floor != null && floor > es) es = floor;
        PRE[i] = startAt(i, es);
        // Resource balancing delays the start by working time.
        if (t.levelDelay > 0 && t.actualStart == null) es = calOf(t).add(startAt(i, es), t.levelDelay);
      }
      // Manually scheduled tasks keep the start the user typed; others start at the next working moment.
      if (t.actualStart != null) es = t.actualStart;
      else if (t.mode !== 'manual') es = startAt(i, es);
      if (t.mode === 'manual' || t.actualStart != null) PRE[i] = es;
      ES[i] = es;
      EF[i] = d > 0 ? addD(i, es, span(i)) : es;
      if (t.actualFinish != null) EF[i] = Math.max(es, t.actualFinish);
      // Driving predecessors: the links that set the start (View › Task Path).
      if (t.mode === 'auto' && t.actualStart == null) for (const [e, c] of cands) if (Math.abs(startAt(i, c) - PRE[i]) < 0.5) e.driving = true;
    }
  };

  // 4. Backward pass
  const LS = new Array(n).fill(0), LF = new Array(n).fill(0);
  let projFinish = projectStart;
  const backward = () => {
    projFinish = projectStart;
    for (const i of leaves) if (EF[i] > projFinish) projFinish = EF[i];
    if (target != null) projFinish = Math.max(projFinish, target);
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k], t = tasks[i], d = dur(i), sp = span(i);
      // With "Calculate multiple critical paths", a task without successors is critical at its own early finish.
      let lf = s.multipleCritical && !succs[i].length && target == null ? EF[i] : projFinish;
      for (const e of succs[i]) {
        if (cyclic.has(i) && cyclic.has(e.to)) continue;
        let c: Minutes;
        if (e.type === 'FS') c = lagAdd(e, LS[e.to], -1);
        else if (e.type === 'SS') c = d > 0 ? addD(i, lagAdd(e, LS[e.to], -1), sp) : lagAdd(e, LS[e.to], -1);
        else if (e.type === 'FF') c = lagAdd(e, LF[e.to], -1);
        else c = d > 0 ? addD(i, lagAdd(e, LF[e.to], -1), sp) : lagAdd(e, LF[e.to], -1);
        if (c < lf) lf = c;
      }
      const cd = t.constraintDate;
      if (cd != null && t.mode === 'auto') {
        if (t.constraint === 'SNLT' || t.constraint === 'MSO') lf = Math.min(lf, d > 0 ? addD(i, startAt(i, cd), sp) : cd);
        if (t.constraint === 'FNLT' || t.constraint === 'MFO') lf = Math.min(lf, cd);
      }
      if (t.deadline != null) lf = Math.min(lf, t.deadline);
      lf = finishAt(i, lf);
      LF[i] = lf;
      LS[i] = d > 0 ? subD(i, lf, sp) : lf;
    }
  };

  // Scheduling from the project finish date: the project start is found so the plan ends on the finish date,
  // and tasks are placed as late as possible.
  if (target != null) {
    for (let k = 0; k < 4; k++) {
      forward(null);
      let f = projectStart;
      for (const i of leaves) if (EF[i] > f) f = EF[i];
      if (Math.abs(f - target) < 0.5) break;
      projectStart = f < target ? pcal.add(projectStart, pcal.workBetween(f, target)) : pcal.sub(projectStart, pcal.workBetween(target, f));
      projectStart = pcal.nextWorkStart(projectStart);
    }
  }

  forward(null);
  backward();
  // As late as possible: such tasks are placed at their late dates, then the schedule is recalculated around them.
  const alap = new Map<number, Minutes>();
  for (const i of order) {
    const t = tasks[i];
    const late = t.constraint === 'ALAP' || (target != null && t.constraint === 'ASAP');
    if (late && t.mode === 'auto' && t.actualStart == null && !cyclic.has(i) && LS[i] > ES[i]) alap.set(i, LS[i]);
  }
  if (alap.size) { forward(alap); backward(); }

  // 5. Slack and critical path (working time on the task's calendar)
  // Slack is working time on the task's calendar, also for elapsed tasks.
  const work = (i: number, a: Minutes, b: Minutes) => calOf(tasks[i]).workBetween(a, b);
  const FSL = new Array(n).fill(0);
  for (const i of leaves) {
    let fs = work(i, EF[i], projFinish);
    for (const e of succs[i]) {
      let c: number;
      if (e.type === 'FS') c = work(i, lagAdd(e, EF[i], 1), ES[e.to]);
      else if (e.type === 'SS') c = work(i, lagAdd(e, ES[i], 1), ES[e.to]);
      else if (e.type === 'FF') c = work(i, lagAdd(e, EF[i], 1), EF[e.to]);
      else c = work(i, lagAdd(e, ES[i], 1), EF[e.to]);
      fs = Math.min(fs, c);
    }
    FSL[i] = Math.max(0, fs);
  }

  // Costs and work per leaf task
  rows.forEach(r => {
    const i = r.i, t = r.task;
    r.es = ES[i]; r.ef = EF[i]; r.ls = LS[i]; r.lf = LF[i];
    if (r.summary) return;
    if (!active[i]) {
      // Inactive tasks keep a position for display but take no part in the schedule.
      const st = t.mode === 'manual' && t.start != null ? t.start : projectStart;
      r.es = r.ls = startAt(i, st); r.ef = r.lf = dur(i) > 0 ? addD(i, r.es, dur(i)) : r.es;
    }
    r.start = r.es; r.finish = r.ef; r.duration = dur(i);
    r.totalSlack = active[i] ? Math.min(work(i, r.es, r.ls), work(i, r.ef, r.lf)) : 0;
    r.freeSlack = FSL[i];
    r.critical = active[i] && r.totalSlack <= s.criticalSlack;
    const pct = Math.max(0, Math.min(100, t.percent)) / 100;
    r.percent = t.percent;
    r.actualStart = t.actualStart ?? (pct > 0 ? r.start : null);
    r.actualFinish = t.actualFinish ?? (pct >= 1 ? r.finish : null);
    r.remaining = r.duration * (1 - pct);
    r.preStart = Math.min(r.start, PRE[i] || r.start);
    r.preFinish = r.duration > 0 ? addD(i, r.preStart, span(i)) : r.preStart;
    // Working parts of a split task, and how far the work is done.
    const g = gaps(i);
    if (g > 0 && active[i]) {
      const segs: [Minutes, Minutes][] = [];
      let cur = r.start, done = 0;
      for (const x of t.splits!) {
        if (x.after <= done || x.after >= r.duration) continue;
        const e = addD(i, cur, x.after - done);
        segs.push([cur, e]);
        cur = startAt(i, addD(i, e, x.gap));
        done = x.after;
      }
      segs.push([cur, addD(i, cur, r.duration - done)]);
      r.segments = segs;
      let need = r.duration * pct;
      r.completeThrough = r.start;
      for (const [a, b] of segs) {
        const w = work(i, a, b);
        if (need <= w + 0.001) { r.completeThrough = need > 0 ? addD(i, a, need) : (r.completeThrough === r.start ? a : r.completeThrough); break; }
        need -= w; r.completeThrough = b;
      }
    } else r.completeThrough = pct <= 0 ? r.start : pct >= 1 ? r.finish : addD(i, r.start, r.duration * pct);
    let cost = t.fixedCost, wk = 0, acost = accrued(t.fixedCost, pct, t.accrual);
    t.assignments.forEach((a: Assignment) => {
      const res = resByUid.get(a.res);
      if (!res) return;
      let c = 0;
      if (res.type === 'Cost') c = a.cost;
      else {
        const rt = ratesAt(res, r.start, a.rateTable || 0);
        c = rt.perUse;
        if (res.type === 'Material') c += a.units * rt.std;
        else {
          const ovt = Math.min(a.work, a.ovt || 0);
          wk += a.work;
          c += (a.work - ovt) / 60 * rt.std + ovt / 60 * rt.ovt;
        }
      }
      cost += c;
      acost += accrued(c, pct, res.accrue);
    });
    r.work = active[i] ? wk : 0;
    r.cost = active[i] ? cost : 0;
    r.actualWork = r.work * pct;
    r.actualCost = active[i] ? acost : 0;
    // Indicators
    const ind: Indicator[] = [];
    if (!active[i]) ind.push('inactive');
    if (pct >= 1) ind.push('complete');
    else if (conflict[i]) ind.push('conflict');
    else if (t.mode === 'auto' && t.constraint !== 'ASAP' && t.constraint !== 'ALAP' && t.constraintDate != null) ind.push('constraint');
    if (manualWarn[i]) ind.push('manualWarn');
    if (t.deadline != null && r.finish > t.deadline && pct < 1) ind.push('deadline');
    if (onLoop.has(i)) ind.push('cycle');
    if (t.notes) ind.push('notes');
    r.indicators = ind;
    r.conflict = conflict[i] || manualWarn[i] || (onLoop.has(i) ? 'This task is part of a dependency loop.' : '');
  });

  // Roll up summaries (children come after their parent, so walk backwards).
  for (let i = n - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r.summary) continue;
    let st = INF, fi = -INF, es = INF, ef = -INF, ls = INF, lf = -INF, wk = 0, cost = r.task.fixedCost, aw = 0, ac = 0, ts = INF, durSum = 0, doneSum = 0;
    let aStart: number | null = null, allDone = true;
    r.children.forEach(c => {
      const cr = rows[c];
      if (!active[c] && !cr.summary) return;
      if (cr.summary && !leavesOf[c].length) return;
      st = Math.min(st, cr.start); fi = Math.max(fi, cr.finish);
      es = Math.min(es, cr.es); ef = Math.max(ef, cr.ef); ls = Math.min(ls, cr.ls); lf = Math.max(lf, cr.lf);
      wk += cr.work; cost += cr.cost; aw += cr.actualWork; ac += cr.actualCost; ts = Math.min(ts, cr.totalSlack);
      durSum += cr.summary ? cr.duration : cr.duration; doneSum += cr.duration * cr.percent / 100;
      if (cr.actualStart != null) aStart = aStart == null ? cr.actualStart : Math.min(aStart, cr.actualStart);
      if (cr.actualFinish == null) allDone = false;
    });
    if (st === INF) { st = fi = es = ef = ls = lf = projectStart; ts = 0; allDone = false; }
    r.start = st; r.finish = fi; r.es = es; r.ef = ef; r.ls = ls; r.lf = lf;
    r.duration = pcal.workBetween(st, fi);
    r.work = wk; r.cost = cost; r.actualWork = aw; r.actualCost = ac;
    r.totalSlack = ts === INF ? 0 : ts;
    r.critical = active[i] && r.totalSlack <= s.criticalSlack;
    r.percent = durSum > 0 ? Math.round(doneSum / durSum * 100) : (allDone ? 100 : 0);
    r.actualStart = aStart;
    r.actualFinish = allDone ? fi : null;
    r.remaining = r.duration * (1 - r.percent / 100);
    r.preStart = r.start; r.preFinish = r.finish;
    r.completeThrough = r.percent <= 0 ? r.start : r.percent >= 100 ? r.finish : pcal.add(r.start, r.duration * r.percent / 100);
    const ind: Indicator[] = [];
    if (!active[i]) ind.push('inactive');
    if (r.percent >= 100) ind.push('complete');
    else if (r.task.constraintDate != null && (r.task.constraint === 'SNET' || r.task.constraint === 'MSO')) ind.push('constraint');
    if (r.task.deadline != null && r.finish > r.task.deadline && r.percent < 100) ind.push('deadline');
    if (r.task.notes) ind.push('notes');
    r.indicators = ind;
  }

  // Overallocation: at some moment the units assigned to a resource exceed its maximum units (or its availability then).
  const overallocated = new Set<number>();
  const overTimes = new Map<number, [Minutes, Minutes][]>();
  const pts = new Map<number, { t: Minutes; d: number; i: number }[]>();
  rows.forEach(r => {
    if (r.summary || !active[r.i] || r.finish <= r.start) return;
    r.task.assignments.forEach(a => {
      const res = resByUid.get(a.res);
      if (!res || res.type !== 'Work' || a.units <= 0) return;
      const list = pts.get(a.res) || [];
      const parts = r.segments || [[r.start, r.finish]];
      parts.forEach(([x, y]) => list.push({ t: x, d: a.units, i: r.i }, { t: y, d: -a.units, i: r.i }));
      pts.set(a.res, list);
    });
  });
  pts.forEach((list, ruid) => {
    const res = resByUid.get(ruid)!;
    (res.availability || []).forEach(av => { if (av.from != null) list.push({ t: av.from, d: 0, i: -1 }); if (av.to != null) list.push({ t: av.to, d: 0, i: -1 }); });
    list.sort((a, b) => a.t - b.t || a.d - b.d);
    let load = 0, overFrom: Minutes | null = null;
    const open = new Map<number, number>();
    const periods: [Minutes, Minutes][] = [];
    for (let k = 0; k < list.length; k++) {
      const x = list[k];
      load += x.d;
      if (x.i >= 0) { const c = (open.get(x.i) || 0) + (x.d > 0 ? 1 : -1); if (c > 0) open.set(x.i, c); else open.delete(x.i); }
      // Check once all changes at this moment are applied.
      if (k + 1 < list.length && list[k + 1].t === x.t) continue;
      const over = load > maxUnitsAt(res, x.t) + 1e-6;
      if (over) {
        overallocated.add(ruid);
        open.forEach((_, i) => { if (!rows[i].indicators.includes('overallocated')) rows[i].indicators.push('overallocated'); });
        if (overFrom == null) overFrom = x.t;
      } else if (overFrom != null) { periods.push([overFrom, x.t]); overFrom = null; }
    }
    if (periods.length) overTimes.set(ruid, periods);
  });

  // Project totals
  let pStart = INF, pFinish = -INF, pWork = 0, pCost = 0, pAc = 0, durSum = 0, doneSum = 0;
  rows.forEach(r => {
    if (r.parent !== -1 || (!r.summary && !active[r.i])) return;
    if (r.summary && !leavesOf[r.i].length) return;
    pStart = Math.min(pStart, r.start); pFinish = Math.max(pFinish, r.finish);
    pWork += r.work; pCost += r.cost; pAc += r.actualCost; durSum += r.duration; doneSum += r.duration * r.percent / 100;
  });
  if (pStart === INF) { pStart = pFinish = projectStart; }
  return {
    rows, byUid, edges, start: pStart, finish: pFinish, duration: pcal.workBetween(pStart, pFinish), work: pWork, cost: pCost, actualCost: pAc,
    percent: durSum ? Math.round(doneSum / durSum * 100) : 0,
    cycle: [...onLoop].map(i => i + 1), calendars, calendar: pcal, overallocated, overTimes, target
  };
}

// Formats outline counters with a WBS code mask: prefix, then each level's code and separator.
export function wbsCode(mask: NonNullable<Project['wbsMask']>, counters: number[]): string {
  const letters = (n: number, base: number) => { let out = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) out = String.fromCharCode(base + (x - 1) % 26) + out; return out; };
  let out = mask.prefix;
  counters.forEach((c, k) => {
    const lv = mask.levels[k];
    let code: string;
    if (!lv) code = String(c);
    else if (lv.seq === 'upper') code = letters(c, 65);
    else if (lv.seq === 'lower') code = letters(c, 97);
    else code = lv.length > 0 ? String(c).padStart(lv.length, '0') : String(c);
    if (k > 0) out += (mask.levels[k - 1]?.sep ?? '.');
    out += code;
  });
  return out;
}

// Baseline n stores start, finish, duration, work and cost of every task (Plan › Set Baseline).
export function baselineFrom(s: Schedule): Record<number, BaselineEntry> {
  const out: Record<number, BaselineEntry> = {};
  s.rows.forEach(r => { out[r.task.uid] = { start: r.start, finish: r.finish, duration: r.duration, work: r.work, cost: r.cost }; });
  return out;
}

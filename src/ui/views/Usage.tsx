// Task hours and Workload: tasks (or resources) with their assignments on the left, and their work, cost
// and other values spread over time on the right. Overallocated resources show in red.
import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Assignment, Resource } from '../../engine/model';
import type { Row } from '../../engine/schedule';
import { buckets, phasedAssignment, phasedResource, phasedTask, spreadOf, type Bucket } from '../../engine/timephase';
import { formatDuration } from '../../engine/duration';
import { fmtDate, formatUnitLabel, todayMinutes, unitStart, type Unit } from '../../engine/time';
import { S, useStore } from '../store';
import { ctxOf, visibleRows } from '../actions';
import { money } from '../columns';
import { chartRange } from '../Gantt';
import Icon from '../Icon';

type URow = { key: string; kind: 'task' | 'assign' | 'res' | 'none'; level: number; label: string; row?: Row; res?: Resource; a?: Assignment; summary?: boolean; over?: boolean };

export const DETAIL_FIELDS: [string, string, boolean][] = [
  ['work', 'Work', true], ['actualWork', 'Act. Work', true], ['baselineWork', 'Baseline Work', true], ['cost', 'Cost', true], ['actualCost', 'Act. Cost', true],
  ['baselineCost', 'Baseline Cost', true], ['peak', 'Peak Units', false], ['overalloc', 'Overallocation', false], ['remaining', 'Remaining Availability', false]
];
const UNIT_W: Record<string, number> = { day: 46, week: 64, month: 72, quarter: 80, year: 80 };
const UNIT_TOP: Record<string, [Unit, string]> = { day: ['week', "MMM d, 'yy"], week: ['month', 'MMMM yyyy'], month: ['quarter', 'Qn yyyy'], quarter: ['year', 'yyyy'], year: ['year', 'yyyy'] };
const UNIT_LABEL: Record<string, string> = { day: 'ddd d', week: 'd MMM', month: 'MMM', quarter: 'Qn', year: 'yyyy' };
const ROW = 22;

function UsageGrid({ resource }: { resource: boolean }) {
  const st = useStore();
  const { p, s, ui } = st;
  const ctx = ctxOf(st);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [size, setSize] = useState({ w: 800, h: 500 });
  const ref = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const unit = ui.usageUnit;
  const [from, to] = useMemo(() => chartRange(s, p), [s, p]);
  const bks = useMemo(() => buckets(unit, from, to, p.gantt.timescale.weekStart, p.gantt.timescale.fiscalStart), [unit, from, to, p.gantt.timescale.weekStart, p.gantt.timescale.fiscalStart]);
  const fields = ui.usageFields.filter(f => DETAIL_FIELDS.some(d => d[0] === f && (resource || d[2])));
  if (!fields.length) fields.push('work');
  const resMap = useMemo(() => new Map(p.resources.map(r => [r.uid, r])), [p.resources]);

  // Rows: tasks with their assignments, or resources with theirs.
  const rows = useMemo(() => {
    const out: URow[] = [];
    if (!resource) {
      visibleRows(st).forEach(r => {
        if (r.group) { out.push({ key: 'g' + r.task.uid, kind: 'task', level: 0, label: r.group.label, row: r, summary: true }); return; }
        out.push({ key: 't' + r.task.uid, kind: 'task', level: r.task.level, label: r.task.name, row: r, summary: r.summary });
        if (!r.summary && !collapsed['t' + r.task.uid]) r.task.assignments.forEach(a => { const res = resMap.get(a.res); if (res) out.push({ key: 'a' + r.task.uid + '-' + a.res, kind: 'assign', level: r.task.level + 1, label: res.name, row: r, res, a }); });
      });
    } else {
      const byRes = new Map<number, Row[]>();
      const none: Row[] = [];
      s.rows.forEach(r => { if (r.summary || !r.task.active) return; if (!r.task.assignments.length) none.push(r); r.task.assignments.forEach(a => { const l = byRes.get(a.res) || []; l.push(r); byRes.set(a.res, l); }); });
      if (none.length) {
        out.push({ key: 'none', kind: 'none', level: 1, label: 'Unassigned', summary: true });
        if (!collapsed.none) none.forEach(r => out.push({ key: 'n' + r.task.uid, kind: 'assign', level: 2, label: r.task.name, row: r }));
      }
      p.resources.forEach(res => {
        out.push({ key: 'r' + res.uid, kind: 'res', level: 1, label: res.name, res, summary: true, over: s.overallocated.has(res.uid) });
        if (!collapsed['r' + res.uid]) (byRes.get(res.uid) || []).forEach(r => { const a = r.task.assignments.find(x => x.res === res.uid)!; out.push({ key: 'ra' + res.uid + '-' + r.task.uid, kind: 'assign', level: 2, label: r.task.name, row: r, res, a }); });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, st.s, st.p, st.ui, collapsed]);

  const bw = UNIT_W[unit];
  // Open at the project start (and again when the unit changes) rather than at the padded left edge.
  useLayoutEffect(() => {
    const el = rightRef.current; if (!el) return;
    const k = Math.max(0, bks.findIndex(b => b.end > s.start));
    el.scrollLeft = Math.max(0, (k - 1) * bw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);
  const leftW = 380;
  const lineH = ROW * fields.length;
  const firstRow = Math.max(0, Math.floor(scroll.top / lineH) - 2), lastRow = Math.min(rows.length, Math.ceil((scroll.top + size.h) / lineH) + 2);
  const firstB = Math.max(0, Math.floor(scroll.left / bw) - 1), lastB = Math.min(bks.length, Math.ceil((scroll.left + size.w - leftW) / bw) + 1);
  const vb: Bucket[] = bks.slice(firstB, lastB);

  // Values for one row and the visible buckets.
  const values = (u: URow): Record<string, number[]> & { over?: boolean[] } => {
    const out: Record<string, number[]> & { over?: boolean[] } = {};
    if (u.kind === 'task' && u.row) {
      const tp = phasedTask(u.row.group ? { ...u.row, i: -1 } as Row : u.row, s, p, vb);
      if (u.row.group) { const kids = groupLeaves(rows, u.key); const sum = (f: keyof typeof tp) => vb.map((_, k) => kids.reduce((t, r) => t + phasedTask(r, s, p, [vb[k]])[f][0], 0)); Object.assign(out, { work: sum('work'), actualWork: sum('actualWork'), cost: sum('cost'), actualCost: sum('actualCost'), baselineWork: sum('baselineWork'), baselineCost: sum('baselineCost') }); return out; }
      Object.assign(out, tp);
    } else if (u.kind === 'assign' && u.row) {
      const sp = spreadOf(u.row, s, p);
      const ph = vb.map(b => (u.a ? phasedAssignment(u.row!, sp, p, u.res, u.a, b.start, b.end) : phasedAssignment(u.row!, sp, p, undefined, null, b.start, b.end)));
      out.work = ph.map(x => x.work); out.actualWork = ph.map(x => x.actualWork); out.cost = ph.map(x => x.cost); out.actualCost = ph.map(x => x.actualCost);
      out.baselineWork = vb.map(() => 0); out.baselineCost = vb.map(() => 0);
    } else if (u.kind === 'res' && u.res) {
      const rp = phasedResource(u.res.uid, s, p, vb);
      out.work = rp.work; out.cost = rp.cost; out.peak = rp.peak.map(v => v * 100); out.over = rp.over;
      out.overalloc = vb.map((b, k) => Math.max(0, rp.work[k] - rp.avail[k] * s.calendars.get(u.res!.calendar, p.calendar).workBetween(b.start, b.end)));
      out.remaining = vb.map((b, k) => Math.max(0, rp.avail[k] * s.calendars.get(u.res!.calendar, p.calendar).workBetween(b.start, b.end) - rp.work[k]));
    } else if (u.kind === 'none') {
      const list = rows.filter(r => r.kind === 'assign' && r.key.startsWith('n') && !!r.row);
      out.work = vb.map(() => 0); out.cost = vb.map((_, k) => list.reduce((t, r) => t + phasedTask(r.row!, s, p, [vb[k]]).cost[0], 0));
    }
    return out;
  };
  const fmtV = (f: string, v: number) => {
    if (!v || Math.abs(v) < 0.005) return '';
    if (f === 'cost' || f === 'actualCost' || f === 'baselineCost') return money(ctx, v).replace(/\.00$/, '');
    if (f === 'peak') return Math.round(v) + '%';
    return formatDuration({ minutes: v, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings).replace(' hrs', 'h').replace(' hr', 'h').replace(' days', 'd').replace(' day', 'd');
  };
  const totalOf = (u: URow): string => {
    if (u.kind === 'task' && u.row) return formatDuration({ minutes: u.row.work, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings);
    if (u.kind === 'assign' && u.a) return formatDuration({ minutes: u.a.work, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings);
    if (u.kind === 'res' && u.res) { const w = rows.filter(r => r.res === u.res && r.kind === 'assign').reduce((t, r) => t + (r.a?.work || 0), 0); return formatDuration({ minutes: w, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings); }
    return '';
  };

  const left: ReactElement[] = [], right: ReactElement[] = [];
  const sel = new Set(st.sel);
  for (let i = firstRow; i < lastRow; i++) {
    const u = rows[i];
    const top = i * lineH;
    const isSel = (u.row && sel.has(u.row.task.uid) && u.kind === 'task') || (u.res && st.resSel.includes(u.res.uid) && u.kind === 'res');
    const cls = 'u-row ' + u.kind + (u.summary ? ' sum' : '') + (u.over ? ' over' : '') + (isSel ? ' sel' : '');
    const canCollapse = (u.kind === 'task' && u.row && !u.row.summary && u.row.task.assignments.length > 0) || u.kind === 'res' || u.kind === 'none';
    const click = () => { if (u.kind === 'res' && u.res) S().set({ resSel: [u.res.uid] }); else if (u.row && !u.row.group) S().set({ sel: [u.row.task.uid] }); };
    const dbl = () => {
      if (u.kind === 'assign' && u.row && u.a) S().open('assignmentInfo', { uid: u.row.task.uid, res: u.a.res });
      else if (u.kind === 'res' && u.res) S().open('resource', { uid: u.res.uid });
      else if (u.row && !u.row.group) (S().set({ sel: [u.row.task.uid] }), S().setUI({ inspector: true }));
    };
    left.push(
      <div key={u.key} className={cls} style={{ top, height: lineH }} onMouseDown={click} onDoubleClick={dbl}>
        <span className="u-id">{u.kind === 'task' && u.row && !u.row.group ? u.row.id : u.kind === 'res' && u.res ? p.resources.indexOf(u.res) + 1 : ''}</span>
        <span className="u-name" style={{ paddingLeft: 6 + (u.level - 1) * 14 }}>
          {canCollapse ? <button className="tog" onMouseDown={e => { e.stopPropagation(); setCollapsed({ ...collapsed, [u.key]: !collapsed[u.key] }); }}><Icon name={collapsed[u.key] ? 'chevR' : 'chevD'} /></button> : <span className="tog-sp" />}
          {u.over && <span className="u-warn" title="Overallocated"><Icon name="alert" /></span>}
          <span className="nm">{u.label}</span>
        </span>
        <span className="u-work">{totalOf(u)}</span>
        <span className="u-details">{fields.map(f => <span key={f}>{DETAIL_FIELDS.find(d => d[0] === f)![1]}</span>)}</span>
      </div>
    );
    const vals = values(u);
    right.push(
      <div key={u.key} className={cls} style={{ top, height: lineH, left: firstB * bw, width: vb.length * bw }}>
        {fields.map((f, fi) => (
          <div key={f} className="u-line" style={{ height: ROW }}>
            {vb.map((b, k) => { const v = vals[f]?.[k] ?? 0; const over = f === 'work' && vals.over?.[k] && v > 0; return <span key={k} className={'u-cell' + (over ? ' over' : '') + (fi === fields.length - 1 ? ' last' : '')} style={{ width: bw }}>{fmtV(f, v)}</span>; })}
          </div>
        ))}
      </div>
    );
  }
  // Timescale header
  const [topUnit, topFmt] = UNIT_TOP[unit];
  const topCells: ReactElement[] = [];
  let curTop = '';
  let startK = firstB;
  for (let k = firstB; k <= lastB; k++) {
    const label = k < lastB ? formatUnitLabel(topFmt, unitStart(topUnit, bks[k].start, p.gantt.timescale.weekStart, p.gantt.timescale.fiscalStart), p.gantt.timescale.fiscalStart) : '';
    if (k === lastB || (label !== curTop && k > firstB)) { topCells.push(<div key={'t' + startK} className="u-top" style={{ left: startK * bw, width: (k - startK) * bw }}>{curTop}</div>); startK = k; }
    if (k < lastB) curTop = label;
  }
  const today = todayMinutes();
  return (
    <div className="usage" ref={ref}>
      <div className="u-left" style={{ width: leftW }}>
        <div className="u-head"><span className="u-id" /><span className="u-name">{resource ? 'Resource Name' : 'Task Name'}</span><span className="u-work">Work</span><span className="u-details">Details</span></div>
        <div className="u-body" ref={leftRef} onScroll={e => { const t = e.currentTarget.scrollTop; if (rightRef.current && Math.abs(rightRef.current.scrollTop - t) > 1) rightRef.current.scrollTop = t; }}>
          <div style={{ height: rows.length * lineH + 200, position: 'relative' }}>{left}</div>
        </div>
      </div>
      <div className="u-right">
        <div className="u-head ts">
          <div style={{ position: 'relative', transform: `translateX(${-scroll.left}px)`, width: bks.length * bw, height: '100%' }}>
            {topCells}
            {vb.map((b, k) => <div key={k} className={'u-bot' + (b.start <= today && today < b.end ? ' today' : '')} style={{ left: (firstB + k) * bw, width: bw }}>{formatUnitLabel(UNIT_LABEL[unit], b.start)}</div>)}
          </div>
        </div>
        <div className="u-body" ref={rightRef} onScroll={e => { const t = e.currentTarget; setScroll({ top: t.scrollTop, left: t.scrollLeft }); if (leftRef.current && Math.abs(leftRef.current.scrollTop - t.scrollTop) > 1) leftRef.current.scrollTop = t.scrollTop; }}>
          <div style={{ height: rows.length * lineH + 200, width: bks.length * bw, position: 'relative' }}>
            {vb.map((b, k) => (s.calendar.isWorkingDay(Math.floor(b.start / 1440)) || unit !== 'day' ? null : <div key={'nw' + k} className="u-nw" style={{ left: (firstB + k) * bw, width: bw }} />))}
            {right}
          </div>
        </div>
      </div>
      <UsageToolbar resource={resource} first={bks[firstB]?.start} />
    </div>
  );
}

function groupLeaves(rows: URow[], key: string): Row[] {
  const i = rows.findIndex(r => r.key === key);
  const out: Row[] = [];
  for (let k = i + 1; k < rows.length && rows[k].key[0] !== 'g'; k++) if (rows[k].kind === 'task' && rows[k].row && !rows[k].row!.summary) out.push(rows[k].row!);
  return out;
}

function UsageToolbar({ resource, first }: { resource: boolean; first?: number }) {
  const ui = useStore(s => s.ui);
  const p = useStore(s => s.p);
  const toggle = (f: string) => { const has = ui.usageFields.includes(f); const next = has ? ui.usageFields.filter(x => x !== f) : ui.usageFields.concat(f); S().setUI({ usageFields: next.length ? next : ['work'] }); };
  return (
    <div className="u-tools">
      <span className="u-tlabel">Details</span>
      {DETAIL_FIELDS.filter(d => resource || d[2]).map(([k, l]) => <button key={k} className={'chip' + (ui.usageFields.includes(k) ? ' on' : '')} onClick={() => toggle(k)}>{l}</button>)}
      <span className="sp" />
      <span className="u-tlabel">Timescale</span>
      {(['day', 'week', 'month', 'quarter', 'year'] as const).map(u => <button key={u} className={'chip' + (ui.usageUnit === u ? ' on' : '')} onClick={() => S().setUI({ usageUnit: u })}>{u[0].toUpperCase() + u.slice(1) + 's'}</button>)}
      {first != null && <span className="u-tlabel muted">from {fmtDate(first, { weekday: false, format: p.settings.dateFormat })}</span>}
    </div>
  );
}

export function TaskUsage() { return <UsageGrid resource={false} />; }
export function ResourceUsage() { return <UsageGrid resource />; }

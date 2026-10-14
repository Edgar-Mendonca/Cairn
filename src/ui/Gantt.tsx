// The Gantt chart (right side of the Gantt views): timescale, bars drawn from bar styles, links, gridlines,
// task paths, progress lines, drawings, and dragging bars to move, stretch, link, split or set progress.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RME, type ReactElement } from 'react';
import type { Row, Schedule } from '../engine/schedule';
import type { GridLine, Project } from '../engine/model';
import { formatPredecessors, moveSegment, setPercent, splitTask } from '../engine/ops';
import { formatDuration } from '../engine/duration';
import { atDay, dayOf, fmtDate, minuteOfDay, todayMinutes, weekday, type Minutes } from '../engine/time';
import { stylesFor } from '../engine/gantt';
import { S, useStore } from './store';
import { ROW_H, type Layout } from './layout';
import { editTask, GROUP_COLORS, highlighted } from './actions';
import { activeTiers, pxPerDay, tierCells, tierHeight } from './gantt/timescale';
import { barDate, blockHeight, drawRow, maxBarRow, patternDefs, type DrawCtx } from './gantt/draw';

// Visible time range of the chart.
export function chartRange(s: Schedule, p: Project): [Minutes, Minutes] {
  const today = todayMinutes();
  let a = Math.min(s.start, p.statusDate ?? s.start), b = Math.max(s.finish, p.statusDate ?? s.finish);
  // Include today when it is within a year of the plan.
  if (today > a - 365 * 1440 && today < b + 365 * 1440) { a = Math.min(a, today); b = Math.max(b, today); }
  b = Math.max(b, a + 60 * 1440);
  let d0 = dayOf(a) - 14;
  while (weekday(d0) !== 0) d0--;
  return [atDay(d0), atDay(dayOf(b) + 60)];
}

export const dash = (g: GridLine) => (g.type === 'dotted' ? '1 3' : g.type === 'dashed' ? '4 3' : g.type === 'long' ? '9 4' : undefined);
export const toggleSet = (ui: { critical: boolean; slack: boolean; baselineBars: boolean; lateTasks: boolean }) => ({ critical: ui.critical, slack: ui.slack, baseline: ui.baselineBars, late: ui.lateTasks });

type DragState = { uid: number; mode: 'move' | 'resize' | 'progress' | 'link' | 'pending' | 'segment' | 'drawing'; x0: number; y0: number; dx: number; dy: number; row: number; seg?: number; id?: number; cx?: number; cy?: number };

// Task Path (Format › Task Path): predecessors, driving predecessors, successors and driven successors of a task.
function taskPaths(s: Schedule, uid: number | undefined, want: { preds: boolean; driving: boolean; succs: boolean; driven: boolean }) {
  const out = new Map<number, string>();
  const r = uid != null ? s.byUid.get(uid) : undefined;
  if (!r || !(want.preds || want.driving || want.succs || want.driven)) return out;
  const leaves = r.summary ? [] : [r.i];
  const walk = (start: number[], back: boolean, driving: boolean, cls: string) => {
    const seen = new Set<number>(start), todo = start.slice();
    while (todo.length) {
      const i = todo.pop()!;
      for (const e of s.edges) {
        if (driving && !e.driving) continue;
        const from = back ? e.to : e.from, to = back ? e.from : e.to;
        if (from !== i || seen.has(to)) continue;
        seen.add(to); todo.push(to);
        const u = s.rows[to].task.uid;
        if (!out.has(u) || cls.startsWith('drv')) out.set(u, cls);
      }
    }
  };
  if (want.preds) walk(leaves, true, false, 'pred');
  if (want.succs) walk(leaves, false, false, 'succ');
  if (want.driving) walk(leaves, true, true, 'drvpred');
  if (want.driven) walk(leaves, false, true, 'drvsucc');
  return out;
}

export default function Gantt({ rows, layout, scrollTop, height, onScroll, view, headH }: { rows: Row[]; layout: Layout; scrollTop: number; height: number; onScroll: (top: number) => void; view: string; headH: number }) {
  const st = useStore();
  const { p, s, ui } = st;
  const g = p.gantt, ts = g.timescale, L = g.layout, grid = g.gridlines;
  const px = pxPerDay(ts);
  const [from, to] = useMemo(() => chartRange(s, p), [s, p]);
  const x = (t: Minutes) => (t - from) / 1440 * px;
  const width = Math.max(200, x(to));
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; r: Row } | null>(null);
  const [editDrawing, setEditDrawing] = useState<number | null>(null);
  const first = Math.max(0, layout.indexAt(scrollTop) - 3);
  const last = Math.min(rows.length, layout.indexAt(scrollTop + height) + 4);
  const totalH = layout.total;
  const styles = stylesFor(g, view);
  const toggles = toggleSet(ui);
  const H = L.barHeight;
  const block = blockHeight(maxBarRow(styles, toggles), H);
  const blockTop = (i: number) => layout.top(i) + Math.max(2, (Math.min(layout.height(i), Math.max(ROW_H, block + 6)) - block) / 2);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.task.uid, i])), [rows]);
  const sel = new Set(st.sel);
  const hl = highlighted(st);
  const status = p.statusDate ?? todayMinutes();
  const ctx: DrawCtx = { p, s, x, layout: L, toggles, status, barText: p.textStyles.barText || {}, dark: S().ui.theme === 'dark' };
  const paths = useMemo(() => taskPaths(s, st.sel[0], ui.taskPath), [s, st.sel, ui.taskPath]);

  useEffect(() => { const b = bodyRef.current; if (b && Math.abs(b.scrollTop - scrollTop) > 1) b.scrollTop = scrollTop; }, [scrollTop]);

  // Scroll to Task (Task › Scroll to Task, or after Find / Go To).
  useEffect(() => {
    const go = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const b = bodyRef.current;
      if (!b) return;
      if (d && typeof d === 'object' && 'date' in d) { b.scrollLeft = Math.max(0, x(d.date) - 60); return; }
      const i = indexOf.get(d as number), r = i != null ? rows[i] : null;
      if (!r) return;
      b.scrollLeft = Math.max(0, x(r.start) - 60);
      onScroll(Math.max(0, layout.top(i!) - height / 3));
    };
    window.addEventListener('pc:scrollto', go);
    return () => window.removeEventListener('pc:scrollto', go);
  });

  // Keep the date at the left edge when the zoom changes; show the project start when a plan opens.
  const anchor = useRef<{ t: Minutes; plan: string } | null>(null);
  useLayoutEffect(() => {
    const b = bodyRef.current;
    if (!b) return;
    if (anchor.current && anchor.current.plan === st.planId) b.scrollLeft = Math.max(0, x(anchor.current.t));
    else b.scrollLeft = Math.max(0, x(s.start) - 40);
    const h = headRef.current?.firstElementChild as SVGElement | null;
    if (h) h.style.transform = `translateX(${-b.scrollLeft}px)`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, st.planId]);
  const remember = () => {
    const b = bodyRef.current;
    if (!b) return;
    const a = from + b.scrollLeft / px * 1440;
    anchor.current = { t: a, plan: st.planId };
    window.dispatchEvent(new CustomEvent('pc:visrange', { detail: [a, a + b.clientWidth / px * 1440] }));
  };
  useEffect(() => { const h = requestAnimationFrame(remember); return () => cancelAnimationFrame(h); });

  const tiers = useMemo(() => activeTiers(ts).map(t => tierCells(t, ts, from, to, x)), [ts, from, to, px]);
  const tierH = headH / tiers.length;

  // Non-working time on the chosen calendar: whole days, and the hours between working times when zoomed in.
  const shading = useMemo(() => {
    if (ts.shade === 'none' || px < 2.5) return [] as ReactElement[];
    const out: ReactElement[] = [];
    const cal = ts.shadeCal ? s.calendars.get(ts.shadeCal, p.calendar) : s.calendar;
    for (let d = dayOf(from); atDay(d) < to; d++) {
      if (!cal.isWorkingDay(d)) out.push(<rect key={d} x={x(atDay(d))} y={0} width={px} height={totalH} fill={ts.shadeColor} className="nw" />);
      else if (px >= 120) {
        let at = 0;
        for (const w of cal.times(d)) { if (w.from > at) out.push(<rect key={d + '-' + at} x={x(atDay(d, at))} y={0} width={(w.from - at) / 1440 * px} height={totalH} fill={ts.shadeColor} className="nw" />); at = w.to; }
        if (at < 1440) out.push(<rect key={d + '-e'} x={x(atDay(d, at))} y={0} width={(1440 - at) / 1440 * px} height={totalH} fill={ts.shadeColor} className="nw" />);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, px, from, to, s.calendars, totalH]);

  // Mouse interaction on bars and drawings
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      setDrag(d => {
        if (!d) return d;
        const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
        let mode = d.mode;
        if (mode === 'pending' && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) mode = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8 ? 'link' : 'move';
        const rect = bodyRef.current!.getBoundingClientRect();
        return { ...d, mode, dx, dy, cx: e.clientX - rect.left + bodyRef.current!.scrollLeft, cy: e.clientY - rect.top + bodyRef.current!.scrollTop };
      });
    };
    const up = () => {
      const d = drag;
      setDrag(null);
      if (!d || d.mode === 'pending') return;
      const st2 = S();
      if (d.mode === 'drawing') {
        const dr = st2.p.gantt.drawings.find(q => q.id === d.id);
        if (dr && (d.dx || d.dy)) st2.commit({ ...st2.p, gantt: { ...st2.p.gantt, drawings: st2.p.gantt.drawings.map(q => (q.id === d.id ? { ...q, at: q.at + d.dx / px * 1440, dy: q.dy + d.dy } : q)) } });
        return;
      }
      const r = rows[d.row];
      if (!r) return;
      const snap = L.roundToDays && px < 100 ? 1440 : px >= 100 ? 60 : 15;
      const deltaMin = Math.round(d.dx / px * 1440 / snap) * snap;
      const cal = st2.s.calendars.get(r.task.calendar, st2.p.calendar);
      if (d.mode === 'move' && deltaMin) {
        const ns = snap >= 1440 ? atDay(dayOf(r.start + deltaMin), minuteOfDay(r.start) || st2.p.settings.defaultStart) : r.start + deltaMin;
        editTask(r.task.uid, 'start', fmtDate(ns, { time: true, format: 'iso' }));
      } else if (d.mode === 'segment' && deltaMin && d.seg) {
        const seg = r.segments![d.seg];
        const target = seg[0] + deltaMin;
        const work = target > seg[0] ? cal.workBetween(seg[0], target) : -cal.workBetween(target, seg[0]);
        const out = moveSegment(st2.p, r.task.uid, d.seg, Math.round(work / 60) * 60);
        if (out.p !== st2.p) st2.commit(out.p);
      } else if (d.mode === 'resize') {
        const nf = snap >= 1440 ? atDay(dayOf(r.finish + deltaMin), st2.p.settings.defaultFinish) : r.finish + deltaMin;
        const gaps = (r.segments ? r.segments.slice(1).reduce((a, sg, k) => a + cal.workBetween(r.segments![k][1], sg[0]), 0) : 0);
        const minutes = Math.max(0, (r.task.elapsed ? nf - r.start : cal.workBetween(r.start, nf)) - gaps);
        const text = formatDuration({ minutes, unit: r.task.durUnit, elapsed: r.task.elapsed, estimated: false }, st2.p.settings);
        editTask(r.task.uid, 'duration', text);
      } else if (d.mode === 'progress' && d.cx != null) {
        const w = Math.max(1, x(r.finish) - x(r.start));
        const pct = Math.max(0, Math.min(100, Math.round((d.cx! - x(r.start)) / w * 100)));
        st2.commit(setPercent(st2.p, st2.s, [r.task.uid], pct).p);
      } else if (d.mode === 'link') {
        // Dragging from one bar to another links them: the dragged task becomes the predecessor.
        const target = rows[layout.indexAt(d.cy!)];
        if (!target || target.group || target.id <= 0 || target.task.uid === r.task.uid || target.task.preds.some(l => l.pred === r.task.uid)) return;
        editTask(target.task.uid, 'preds', [formatPredecessors(st2.p, st2.s, target.task), String(r.id)].filter(Boolean).join(','));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  });

  const pat = patternDefs('g');
  const bars: ReactElement[] = [];
  const backs: ReactElement[] = [];
  const links: ReactElement[] = [];
  const mid = (i: number) => blockTop(i) + H / 2;
  const lo = Math.max(0, first - 60), hi = Math.min(rows.length, last + 60);
  // Links between visible tasks
  if (L.links !== 'none') for (let i = lo; i < hi; i++) {
    const r = rows[i];
    if (r.group) continue;
    r.task.preds.forEach(l => {
      const j = indexOf.get(l.pred);
      if (j == null) return;
      if ((j < first && i < first) || (j > last && i > last)) return;
      const pr = rows[j];
      const crit = (ui.critical || view === 'tracking' || view === 'detail') && pr.critical && r.critical;
      const isMs = (row: Row) => !row.summary && row.duration === 0;
      const y1 = mid(j), y2 = mid(i), down = y2 > y1 ? 1 : -1;
      const fromX = l.type === 'FS' || l.type === 'FF' ? x(pr.finish) + (isMs(pr) ? 6 : 0) : x(pr.start) - (isMs(pr) ? 6 : 0);
      const toX = l.type === 'FS' || l.type === 'SS' ? x(r.start) - (isMs(r) ? 6 : 0) : x(r.finish) + (isMs(r) ? 6 : 0);
      let d = '', arrow = '';
      if (L.links === 'straight') { d = `M${fromX} ${y1}L${toX} ${y2}`; arrow = toX >= fromX ? 'r' : 'l'; }
      else if (l.type === 'FS') {
        if (toX >= fromX + 6) { d = `M${fromX} ${y1}H${toX + 3}V${y2 - down * (isMs(r) ? 7 : H / 2)}`; arrow = down > 0 ? 'd' : 'u'; }
        else { const ym = layout.top(j < i ? i : i + 1); d = `M${fromX} ${y1}h6V${ym}H${toX - 8}V${y2}H${toX}`; arrow = 'r'; }
      } else if (l.type === 'SS') { const xl = Math.min(fromX, toX) - 8; d = `M${fromX} ${y1}H${xl}V${y2}H${toX}`; arrow = 'r'; }
      else if (l.type === 'FF') { const xr = Math.max(fromX, toX) + 8; d = `M${fromX} ${y1}H${xr}V${y2}H${toX}`; arrow = 'l'; }
      else { const xl = fromX - 8; d = `M${fromX} ${y1}H${xl}V${layout.top(j < i ? i : i + 1)}H${toX + 8}V${y2}H${toX}`; arrow = 'l'; }
      const path = paths.size && (paths.has(r.task.uid) || r.task.uid === st.sel[0]) && (paths.has(pr.task.uid) || pr.task.uid === st.sel[0]);
      links.push(<path key={'l' + r.task.uid + '-' + l.pred} d={d} className={'lnk' + (crit ? ' crit' : '') + (path ? ' path' : '')} markerEnd={`url(#ah-${arrow}${crit ? 'c' : ''})`} />);
    });
  }
  // Rows: backgrounds, bars and hit areas
  for (let i = first; i < last; i++) {
    const r = rows[i];
    const t = r.task, top = layout.top(i), h = layout.height(i), bt = blockTop(i);
    if (r.group) backs.push(<rect key={'gb' + t.uid} x={0} y={top} width={width} height={h} fill={GROUP_COLORS[r.group.level % GROUP_COLORS.length]} opacity={0.55} />);
    else if (sel.has(t.uid)) backs.push(<rect key={'sr' + t.uid} x={0} y={top} width={width} height={h} className="selrow" />);
    else if (hl?.has(t.uid)) backs.push(<rect key={'hl' + t.uid} x={0} y={top} width={width} height={h} className="hlrow" />);
    if (grid.ganttRows.type !== 'none' && (!grid.ganttRows.every || (i + 1) % grid.ganttRows.every === 0)) backs.push(<line key={'gr' + i} x1={0} x2={width} y1={top + h - 0.5} y2={top + h - 0.5} stroke={grid.ganttRows.color} strokeDasharray={dash(grid.ganttRows)} />);
    const pathCls = paths.get(t.uid);
    const rolled = r.summary && !r.group && r.id > 0 ? r.children.map(c => s.rows[c]).filter(k => !k.summary && (k.task.rollup || L.rollupAll)) : undefined;
    const { els, hits } = drawRow(r, styles, ctx, bt, H, pat, { rolledFrom: rolled?.length ? rolled : undefined });
    if (pathCls && hits.length) { const hb = hits[0]; backs.push(<rect key={'tp' + t.uid} x={Math.min(...hits.map(q => q.x1)) - 3} y={hb.t - 3} width={Math.max(...hits.map(q => q.x2)) - Math.min(...hits.map(q => q.x1)) + 6} height={hb.h + 6} rx={4} className={'tpath ' + pathCls} />); }
    const dragging = drag && drag.uid === t.uid && (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'segment') ? drag : null;
    const shift = dragging ? dragging.dx : 0;
    const cls = 'bar' + (sel.has(t.uid) ? ' sel' : '') + (r.summary ? ' sum' : '') + (dragging ? ' dragging' : '');
    const transform = dragging && dragging.mode === 'move' ? `translate(${shift} 0)` : undefined;
    const interact = !r.group && r.id !== 0;
    bars.push(
      <g key={'b' + t.uid} className={cls} transform={transform}
        onMouseEnter={e => { const b = bodyRef.current!.getBoundingClientRect(); setTip({ x: e.clientX - b.left + bodyRef.current!.scrollLeft, y: top + h, r }); }}
        onMouseLeave={() => setTip(null)}
        onDoubleClick={e => { e.stopPropagation(); if (interact) (S().set({ sel: [t.uid] }), S().setUI({ inspector: true })); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (!interact) return; S().set({ sel: [t.uid] }); window.dispatchEvent(new CustomEvent('pc:menu', { detail: { x: e.clientX, y: e.clientY, uid: t.uid, chart: true } })); }}>
        {els}
        {interact && hits.map((hb, k) => {
          const onDown = (e: RME, mode: DragState['mode']) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const st2 = S();
            if (st2.splitMode) {
              const rect = bodyRef.current!.getBoundingClientRect();
              const at = from + (e.clientX - rect.left + bodyRef.current!.scrollLeft) / px * 1440;
              const out = splitTask(st2.p, st2.s, t.uid, at);
              st2.set({ splitMode: false });
              if (out.error) st2.notify(out.error, true); else st2.commit(out.p);
              return;
            }
            S().set({ sel: [t.uid] });
            if (r.summary) return;
            setDrag({ uid: t.uid, mode, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, row: i, seg: hb.seg });
          };
          const w = Math.max(6, hb.x2 - hb.x1);
          return (
            <g key={'h' + k}>
              <rect x={hb.x1} y={hb.t - 2} width={w} height={hb.h + 4} className="hit" onMouseDown={e => onDown(e, hb.kind === 'segment' && (hb.seg || 0) > 0 ? 'segment' : 'pending')} />
              {r.duration > 0 && !r.summary && (hb.kind === 'bar' || hb.seg === (r.segments?.length ?? 1) - 1) && <rect x={hb.x2 - 4} y={hb.t - 2} width={7} height={hb.h + 4} className="hit grip" onMouseDown={e => onDown(e, 'resize')} />}
              {r.duration > 0 && !r.summary && (hb.seg ?? 0) === 0 && <rect x={hb.x1 - 2} y={hb.t - 2} width={5} height={hb.h + 4} className="hit pgrip" onMouseDown={e => onDown(e, 'progress')} />}
            </g>
          );
        })}
      </g>
    );
  }
  // Outline of a bar being stretched or a part being moved.
  if (drag && (drag.mode === 'resize' || drag.mode === 'segment')) {
    const i = drag.row, r = rows[i];
    if (r) {
      const bt = blockTop(i);
      if (drag.mode === 'resize') bars.push(<rect key="pv" x={x(r.start)} y={bt - 1} width={Math.max(2, x(r.finish) - x(r.start) + drag.dx)} height={H + 2} className="drag-preview" />);
      else if (r.segments && drag.seg) { const sg = r.segments[drag.seg]; bars.push(<rect key="pv" x={x(sg[0]) + drag.dx} y={bt - 1} width={Math.max(2, x(sg[1]) - x(sg[0]))} height={H + 2} className="drag-preview" />); }
    }
  }
  // Link being drawn
  let linking: ReactElement | null = null;
  if (drag && drag.mode === 'link') {
    const r = rows[drag.row];
    linking = <path d={`M${x(r.finish)} ${mid(drag.row)}L${drag.cx} ${drag.cy}`} className="lnk drawing" />;
  }
  const now = todayMinutes() + (new Date().getHours() * 60 + new Date().getMinutes());
  // Gridlines: major and minor columns, and lines at the current date, status date, project start and finish.
  const verticals: ReactElement[] = [];
  const vline = (k: string, xx: number, gl: GridLine) => { if (gl.type !== 'none') verticals.push(<line key={k} x1={xx} x2={xx} y1={0} y2={totalH} stroke={gl.color} strokeDasharray={dash(gl)} strokeWidth={k === 'cur' || k === 'st' ? 1.4 : 1} />); };
  if (grid.minor.type !== 'none') tiers[tiers.length - 1].forEach((c, k) => vline('mi' + k, c.x, grid.minor));
  if (grid.major.type !== 'none' && tiers.length > 1) tiers[tiers.length - 2].forEach((c, k) => vline('ma' + k, c.x, grid.major));
  vline('ps', x(s.start), grid.projStart);
  vline('pf', x(s.finish), grid.projFinish);
  if (p.statusDate != null) vline('st', x(p.statusDate), grid.status);
  vline('cur', x(now), grid.current);

  // Progress lines (Format › Gridlines › Progress Lines): from the status date through each task's progress point.
  let progress: ReactElement | null = null;
  if (g.progress.show) {
    const at = g.progress.at === 'status' ? status : now;
    const pts: string[] = [];
    for (let i = first; i < last; i++) {
      const r = rows[i];
      if (r.group || r.summary) continue;
      const y = mid(i);
      let px2 = x(at);
      if (r.start < at && r.percent < 100) px2 = x(r.percent > 0 ? r.completeThrough : r.start);
      else if (r.percent > 0 && r.start >= at) px2 = x(r.completeThrough);
      pts.push(`${x(at)},${y - ROW_H / 2 + 1}`, `${px2},${y}`, `${x(at)},${y + ROW_H / 2 - 1}`);
    }
    if (pts.length) progress = <polyline points={pts.join(' ')} fill="none" stroke={g.progress.color} strokeWidth={1.5} className="progline" />;
  }

  // Drawings (Format › Drawing): text boxes and shapes attached to a date and a task row.
  const drawings: ReactElement[] = [];
  if (L.showDrawings) g.drawings.forEach(dr => {
    const i = dr.uid != null ? indexOf.get(dr.uid) : undefined;
    const baseY = i != null ? layout.top(i) : dr.row * ROW_H;
    const moving = drag?.mode === 'drawing' && drag.id === dr.id ? drag : null;
    const dx = x(dr.at) + dr.dx + (moving?.dx || 0), dy = baseY + dr.dy + (moving?.dy || 0);
    const down = (e: RME) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); setDrag({ uid: -1, mode: 'drawing', id: dr.id, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, row: 0 }); };
    const common = { onMouseDown: down, onDoubleClick: (e: RME) => { e.stopPropagation(); if (dr.kind === 'text' || dr.kind === 'rect' || dr.kind === 'oval') setEditDrawing(dr.id); }, onContextMenu: (e: RME) => { e.preventDefault(); e.stopPropagation(); S().open('confirm', { title: 'Delete drawing', message: 'Delete this drawing?', okLabel: 'Delete', onOk: () => { const st2 = S(); st2.commit({ ...st2.p, gantt: { ...st2.p.gantt, drawings: st2.p.gantt.drawings.filter(q => q.id !== dr.id) } }); } }); } };
    if (dr.kind === 'line' || dr.kind === 'arrow') drawings.push(<g key={'dr' + dr.id} className="drawing" {...common}><line x1={dx} y1={dy} x2={dx + dr.w} y2={dy + dr.h} stroke={dr.color} strokeWidth={1.8} markerEnd={dr.kind === 'arrow' ? 'url(#ah-free)' : undefined} /><line x1={dx} y1={dy} x2={dx + dr.w} y2={dy + dr.h} stroke="transparent" strokeWidth={10} /></g>);
    else drawings.push(
      <g key={'dr' + dr.id} className="drawing" {...common}>
        {dr.kind === 'oval' ? <ellipse cx={dx + dr.w / 2} cy={dy + dr.h / 2} rx={dr.w / 2} ry={dr.h / 2} fill={dr.fill} stroke={dr.color} /> : <rect x={dx} y={dy} width={dr.w} height={dr.h} rx={dr.kind === 'text' ? 3 : 0} fill={dr.fill} stroke={dr.kind === 'text' ? 'rgba(0,0,0,.18)' : dr.color} />}
        {dr.text && <text x={dx + 6} y={dy + 16} className="dr-text" fill={dr.color}>{dr.text.split('\n').map((ln, k) => <tspan key={k} x={dx + 6} dy={k ? 14 : 0}>{ln}</tspan>)}</text>}
      </g>
    );
  });
  const editing = editDrawing != null ? g.drawings.find(d => d.id === editDrawing) : null;

  // The timescale header only changes with the zoom, range or format, so it is built once per change, not per edit.
  const header = useMemo(() => (
        <svg width={width} height={headH}>
          {tiers.map((cells, ti) => (
            <g key={ti} className={'tier-row t' + ti} style={p.textStyles.tiers ? { fontFamily: p.textStyles.tiers.font ? '"' + p.textStyles.tiers.font + '"' : undefined } : undefined}>
              <rect x={0} y={ti * tierH} width={width} height={tierH} className="tier-bg" />
              {cells.map((c, k) => {
                const tier = activeTiers(ts)[ti];
                const tx = tier.align === 'center' ? c.x + c.w / 2 : tier.align === 'right' ? c.x + c.w - 4 : c.x + 4;
                return <g key={k}>{tier.ticks && <line x1={c.x} x2={c.x} y1={ti * tierH} y2={(ti + 1) * tierH} className="tick" stroke={ti === tiers.length - 1 ? grid.bottomTier.color : grid.topTier.color} />}<text x={tx} y={ti * tierH + tierH / 2 + 4} className="tl" textAnchor={tier.align === 'center' ? 'middle' : tier.align === 'right' ? 'end' : 'start'} style={{ fill: p.textStyles.tiers?.color, fontSize: p.textStyles.tiers?.size ? p.textStyles.tiers.size * 4 / 3 : undefined }}>{c.label}</text></g>;
              })}
              <line x1={0} x2={width} y1={(ti + 1) * tierH - 0.5} y2={(ti + 1) * tierH - 0.5} className="tick" />
            </g>
          ))}
        </svg>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [tiers, width, headH, grid, p.textStyles.tiers, ts]);
  useLayoutEffect(() => { const h = headRef.current?.firstElementChild as SVGElement | null; if (h) h.style.transform = `translateX(${-(bodyRef.current?.scrollLeft || 0)}px)`; });

  return (
    <div className={'gantt' + (st.splitMode ? ' splitting' : '')}>
      <div className="ghead" ref={headRef} style={{ height: headH }}>
        {header}
      </div>
      <div className="gbody" ref={bodyRef} onScroll={e => { onScroll(e.currentTarget.scrollTop); remember(); const h = headRef.current?.firstElementChild as SVGElement | null; if (h) h.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`; }}
        onMouseDown={e => { if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('nw')) S().set({ sel: [], splitMode: false }); }}
        onWheel={e => { if (e.ctrlKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('pc:zoom', { detail: e.deltaY < 0 ? 1 : -1 })); } }}>
        <svg width={width} height={totalH} className="gsvg">
          <defs>
            {(['d', 'u', 'r', 'l'] as const).flatMap(dir => [false, true].map(c => (
              <marker key={dir + c} id={'ah-' + dir + (c ? 'c' : '')} viewBox="0 0 10 10" refX={dir === 'd' || dir === 'u' ? 5 : 9} refY="5" markerWidth="6" markerHeight="6"
                orient={dir === 'd' ? 90 : dir === 'u' ? 270 : dir === 'r' ? 0 : 180}>
                <path d="M0 0L10 5L0 10z" className={'ah' + (c ? ' crit' : '')} />
              </marker>
            )))}
            <marker id="ah-free" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#273142" /></marker>
            {pat.list}
          </defs>
          {ts.shade === 'behind' && shading}
          {backs}
          {verticals}
          <g>{links}</g>
          <g>{bars}</g>
          {ts.shade === 'front' && <g opacity={0.6} pointerEvents="none">{shading}</g>}
          {progress}
          {drawings}
          {linking}
        </svg>
        {editing && (() => {
          const i = editing.uid != null ? indexOf.get(editing.uid) : undefined;
          const top = (i != null ? layout.top(i) : editing.row * ROW_H) + editing.dy;
          return <textarea className="dr-edit" autoFocus defaultValue={editing.text} style={{ left: x(editing.at) + editing.dx, top, width: Math.max(140, editing.w), height: Math.max(40, editing.h) }}
            onBlur={e => { const v = e.target.value; setEditDrawing(null); const st2 = S(); st2.commit({ ...st2.p, gantt: { ...st2.p.gantt, drawings: st2.p.gantt.drawings.map(q => (q.id === editing.id ? { ...q, text: v, h: Math.max(q.h, 12 + v.split('\n').length * 14) } : q)) } }); }}
            onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); e.stopPropagation(); }} />;
        })()}
        {tip && !drag && !tip.r.group && (
          <div className="gtip" style={{ left: tip.x + 12, top: tip.y + 4 }}>
            <b>{tip.r.task.name || '(no name)'}</b>
            <span className="gtip-kind">{tip.r.id === 0 ? 'Project summary' : tip.r.summary ? 'Summary task' : tip.r.duration === 0 ? 'Milestone' : tip.r.task.mode === 'manual' ? 'Manually scheduled task' : 'Task'}{tip.r.critical && !tip.r.summary ? ' · critical' : ''}</span>
            <span>Start <em>{fmtDate(tip.r.start, { time: true, format: p.settings.dateFormat })}</em></span>
            <span>Finish <em>{fmtDate(tip.r.finish, { time: true, format: p.settings.dateFormat })}</em></span>
            <span>Duration <em>{formatDuration({ minutes: tip.r.duration, unit: tip.r.summary ? p.settings.durationUnit : tip.r.task.durUnit, elapsed: tip.r.task.elapsed, estimated: tip.r.task.estimated }, p.settings)}</em></span>
            {tip.r.percent > 0 && <span>Complete <em>{Math.round(tip.r.percent)}%</em></span>}
            {tip.r.segments && <span>Split into <em>{tip.r.segments.length} parts</em></span>}
            {barDate(tip.r, 'baselineStart', ctx) != null && <span>Baseline <em>{fmtDate(barDate(tip.r, 'baselineStart', ctx)!, { format: p.settings.dateFormat })} – {fmtDate(barDate(tip.r, 'baselineFinish', ctx)!, { format: p.settings.dateFormat })}</em></span>}
          </div>
        )}
      </div>
    </div>
  );
}

// The timescale scroll position for a date (used by Go To).
export function scrollToDate(t: Minutes) { window.dispatchEvent(new CustomEvent('pc:scrollto', { detail: { date: t } })); }
export { tierHeight };

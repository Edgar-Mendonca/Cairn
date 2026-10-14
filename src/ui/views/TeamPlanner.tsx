// Team board: one row per resource with its tasks as blocks over time, and the unassigned tasks below.
// Drag a task to another resource to reassign it, or sideways to move it; overallocation shows in red.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Row } from '../../engine/schedule';
import { reassign } from '../../engine/ops';
import { atDay, dayOf, fmtDate, minuteOfDay, todayMinutes, type Minutes } from '../../engine/time';
import { S, useStore } from '../store';
import { chartRange } from '../Gantt';
import { editTask } from '../actions';
import { activeTiers, pxPerDay, tierCells } from '../gantt/timescale';
import Icon from '../Icon';

const LANE = 26, NAME_W = 210;
type Drag = { uid: number; from: number | null; x0: number; y0: number; dx: number; dy: number; active: boolean };

export function TeamPlanner() {
  const st = useStore();
  const { p, s } = st;
  const ts = p.gantt.timescale;
  const px = Math.max(8, pxPerDay(ts));
  const [from, to] = useMemo(() => chartRange(s, p), [s, p]);
  const x = (t: Minutes) => (t - from) / 1440 * px;
  const width = x(to);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [vw, setVw] = useState(900);
  useLayoutEffect(() => { const el = bodyRef.current; if (!el) return; const ro = new ResizeObserver(() => setVw(el.clientWidth)); ro.observe(el); el.scrollLeft = Math.max(0, x(s.start) - 40); return () => ro.disconnect(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Swimlanes: tasks of each resource packed so overlapping tasks sit in separate lanes.
  const groups = useMemo(() => {
    const leaves = s.rows.filter(r => !r.summary && r.task.active && r.duration > 0 || (!r.summary && r.task.active && r.duration === 0 && r.task.assignments.length));
    const pack = (list: Row[]) => {
      const lanes: Minutes[] = [];
      const placed = list.slice().sort((a, b) => a.start - b.start).map(r => { let lane = lanes.findIndex(e => e <= r.start); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = Math.max(r.finish, r.start + 1); return { r, lane }; });
      return { placed, lanes: Math.max(1, lanes.length) };
    };
    const out = p.resources.filter(r => r.type === 'Work').map(res => ({ key: res.uid as number | null, name: res.name, res, ...pack(leaves.filter(r => r.task.assignments.some(a => a.res === res.uid))) }));
    out.push({ key: null, name: 'Unassigned Tasks', res: undefined as never, ...pack(leaves.filter(r => !r.task.assignments.some(a => p.resources.find(x2 => x2.uid === a.res)?.type === 'Work'))) });
    return out;
  }, [s, p]);
  let y = 0;
  const tops = groups.map(g => { const t = y; y += g.lanes * LANE + 8; return t; });
  const totalH = y + 40;

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => setDrag(d => (d ? { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0, active: d.active || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 5 } : d));
    const up = (e: MouseEvent) => {
      const d = drag;
      setDrag(null);
      if (!d?.active) return;
      const b = bodyRef.current!.getBoundingClientRect();
      const yy = e.clientY - b.top + bodyRef.current!.scrollTop;
      const gi = tops.findIndex((t, k) => yy >= t && yy < t + groups[k].lanes * LANE + 8);
      const st2 = S();
      const r = st2.s.byUid.get(d.uid);
      if (!r) return;
      const target = gi >= 0 ? groups[gi].key : d.from;
      if (target !== d.from) {
        const out = reassign(st2.p, d.uid, d.from, target);
        if (out.error) st2.notify(out.error, true); else { st2.commit(out.p); st2.notify('Reassigned “' + r.task.name + '” to ' + (target == null ? 'nobody' : st2.p.resources.find(q => q.uid === target)?.name)); }
      }
      const days = Math.round(d.dx / px);
      if (Math.abs(d.dx) > px / 2 && days) {
        const r2 = S().s.byUid.get(d.uid)!;
        editTask(d.uid, 'start', fmtDate(atDay(dayOf(r2.start) + days, minuteOfDay(r2.start) || st2.p.settings.defaultStart), { time: true, format: 'iso' }));
      }
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  });

  const tiers = useMemo(() => activeTiers(ts).map(t => tierCells(t, ts, from, to, x)), [ts, from, to, px]);
  const sel = new Set(st.sel);
  const blocks: ReactElement[] = [], lanesBg: ReactElement[] = [], names: ReactElement[] = [];
  groups.forEach((g, gi) => {
    const top = tops[gi], h = g.lanes * LANE + 8;
    const over = g.res ? s.overTimes.get(g.res.uid) || [] : [];
    lanesBg.push(<rect key={'bg' + gi} x={0} y={top} width={width} height={h} className={'tp-lane' + (g.key == null ? ' none' : '') + (gi % 2 ? ' alt' : '')} />);
    over.forEach(([a, b], k) => lanesBg.push(<rect key={'ov' + gi + '-' + k} x={x(a)} y={top + h - 4} width={Math.max(2, x(b) - x(a))} height={3} className="tp-over" />));
    names.push(
      <div key={'n' + gi} className={'tp-name' + (g.key == null ? ' none' : '') + (g.res && st.resSel.includes(g.res.uid) ? ' sel' : '')} style={{ top, height: h }} onMouseDown={() => g.res && S().set({ resSel: [g.res.uid] })} onDoubleClick={() => g.res && S().open('resource', { uid: g.res.uid })}>
        {g.res ? <span className="tp-avatar">{(g.res.initials || g.res.name).slice(0, 2).toUpperCase()}</span> : <Icon name="resources" />}
        <span className="tp-n">{g.name}{g.res && <small>{Math.round(g.res.maxUnits * 100)}% · {g.placed.length} task{g.placed.length === 1 ? '' : 's'}</small>}</span>
        {over.length > 0 && <span className="tp-warn" title="Overallocated"><Icon name="alert" /></span>}
      </div>
    );
    g.placed.forEach(({ r, lane }) => {
      const x1 = x(r.start), w = Math.max(r.duration === 0 ? 12 : 6, x(r.finish) - x1);
      const dragging = drag?.active && drag.uid === r.task.uid && drag.from === g.key;
      const yy = top + 4 + lane * LANE;
      const late = r.percent < 100 && r.finish > (r.baseline?.finish ?? Infinity);
      blocks.push(
        <div key={g.key + '-' + r.task.uid} className={'tp-task' + (sel.has(r.task.uid) ? ' sel' : '') + (r.critical ? ' crit' : '') + (r.percent >= 100 ? ' done' : '') + (late ? ' late' : '') + (dragging ? ' dragging' : '') + (r.task.mode === 'manual' ? ' manual' : '')}
          style={{ left: x1, top: yy, width: w, transform: dragging ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined }}
          title={r.task.name + '\n' + fmtDate(r.start, { format: p.settings.dateFormat }) + ' – ' + fmtDate(r.finish, { format: p.settings.dateFormat }) + (r.percent ? '\n' + r.percent + '% complete' : '')}
          onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); S().set({ sel: [r.task.uid] }); setDrag({ uid: r.task.uid, from: g.key, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false }); }}
          onDoubleClick={() => (S().set({ sel: [r.task.uid] }), S().setUI({ inspector: true }))}>
          {r.percent > 0 && <i className="tp-prog" style={{ width: Math.min(100, r.percent) + '%' }} />}
          <span>{r.task.name}</span>
        </div>
      );
    });
  });
  const today = todayMinutes();
  const tierH = 44 / tiers.length;
  return (
    <div className="tplanner">
      <div className="tp-head">
        <div className="tp-corner" style={{ width: NAME_W }}>Resource Name</div>
        <div className="tp-ts" ref={headRef}>
          <svg width={width} height={44} style={{ transform: `translateX(${-(bodyRef.current?.scrollLeft || 0)}px)` }}>
            {tiers.map((cells, ti) => <g key={ti}>{cells.map((c, k) => <g key={k}><line x1={c.x} x2={c.x} y1={ti * tierH} y2={(ti + 1) * tierH} className="tick" /><text x={c.x + 4} y={ti * tierH + tierH / 2 + 4} className="tl">{c.label}</text></g>)}<line x1={0} x2={width} y1={(ti + 1) * tierH - 0.5} y2={(ti + 1) * tierH - 0.5} className="tick" /></g>)}
          </svg>
        </div>
      </div>
      <div className="tp-main">
        <div className="tp-names" style={{ width: NAME_W }}>
          <div style={{ position: 'relative', height: totalH, transform: `translateY(${-(bodyRef.current?.scrollTop || 0)}px)` }}>{names}</div>
        </div>
        <div className="tp-body" ref={bodyRef} onScroll={e => { const t = e.currentTarget; const h = headRef.current?.firstElementChild as SVGElement | null; if (h) h.style.transform = `translateX(${-t.scrollLeft}px)`; const n = t.previousElementSibling?.firstElementChild as HTMLElement | null; if (n) n.style.transform = `translateY(${-t.scrollTop}px)`; }}>
          <div style={{ position: 'relative', width, height: totalH }}>
            <svg width={width} height={totalH} className="tp-svg">
              {lanesBg}
              {(() => { const out: ReactElement[] = []; if (px >= 3) for (let d = dayOf(from); atDay(d) < to; d++) if (!s.calendar.isWorkingDay(d)) out.push(<rect key={d} x={x(atDay(d))} y={0} width={px} height={totalH} className="nw" style={{ fill: "var(--nw)" }} />); return out; })()}
              <line x1={x(today)} x2={x(today)} y1={0} y2={totalH} className="today-line" />
            </svg>
            {blocks}
          </div>
        </div>
      </div>
      <div className="tp-foot muted">Drag a task to another resource to reassign it, or sideways to move it. Red marks show when a resource is overallocated; use Plan › Balance workload to resolve them. {vw < 0 ? '' : ''}</div>
    </div>
  );
}

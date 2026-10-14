// The Timeline: the whole project at a glance, with tasks added via "Add to Timeline" shown as bars, callouts
// or milestones, the part of the plan visible in the Gantt chart as a window you can drag, and today's date.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDate, MONTHS, todayMinutes, ymd, type Minutes } from '../engine/time';
import { updateTask } from '../engine/ops';
import { S, useStore } from './store';
import { scrollToDate } from './Gantt';

export default function Timeline({ big }: { big?: boolean }) {
  const { p, s, sel } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  const [vis, setVis] = useState<[Minutes, Minutes] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; uid: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; a: Minutes } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = (e: Event) => setVis((e as CustomEvent).detail);
    window.addEventListener('pc:visrange', on);
    return () => window.removeEventListener('pc:visrange', on);
  }, []);
  const pad = 96;
  const a = s.start, b = Math.max(s.finish, s.start + 1440);
  const span = Math.max(100, w - pad * 2);
  const x = (t: Minutes) => pad + (t - a) / (b - a) * span;
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => { const t = drag.a + (e.clientX - drag.x0) / span * (b - a); scrollToDate(t); };
    const up = () => setDrag(null);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [drag, span, a, b]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);
  const items = s.rows.filter(r => r.task.timeline);
  const callouts = items.filter(r => r.task.tlCallout && r.duration > 0);
  const bars = items.filter(r => (r.duration > 0 || r.summary) && !r.task.tlCallout);
  const miles = items.filter(r => !r.summary && r.duration === 0);
  // Pack bars into lanes so they do not overlap; callouts go above the band.
  const pack = (list: typeof items) => {
    const lanes: Minutes[] = [];
    return { placed: list.map(r => { let lane = lanes.findIndex(end => end <= r.start); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = r.finish; return { r, lane }; }), lanes: lanes.length };
  };
  const bp = pack(bars), cp = pack(callouts);
  const laneH = big ? 30 : 22;
  const calloutTop = 10 + (miles.length ? 34 : 0);
  const top = calloutTop + cp.lanes * 20 + 6;
  const h = big ? undefined : Math.max(76, top + Math.max(1, bp.lanes) * laneH + 22);
  const bandH = Math.max(1, bp.lanes) * laneH;
  // Month ticks
  const ticks: { x: number; label: string }[] = [];
  const [y0, m0] = ymd(Math.floor(a / 1440));
  for (let k = 0; k < 240; k++) {
    const d = Math.round(Date.UTC(y0, m0 - 1 + k, 1) / 864e5) * 1440;
    if (d > b) break;
    if (d >= a) { const dt = new Date(d * 60000); ticks.push({ x: x(d), label: MONTHS[dt.getUTCMonth()] + (dt.getUTCMonth() === 0 || !ticks.length ? ' ' + dt.getUTCFullYear() : '') }); }
  }
  const step = Math.ceil(ticks.length / Math.max(1, Math.floor(span / 64)));
  const today = todayMinutes();
  const fmt = (t: Minutes) => fmtDate(t, { weekday: false, format: p.settings.dateFormat });
  const pick = (uid: number) => S().set({ sel: [uid] });
  const ctx = (e: React.MouseEvent, uid: number) => { e.preventDefault(); e.stopPropagation(); pick(uid); setMenu({ x: e.clientX, y: e.clientY, uid }); };
  const color = (r: (typeof items)[number]) => (r.summary ? 'var(--tl-sum)' : r.critical ? 'var(--tl-crit)' : 'var(--tl-bar)');
  return (
    <div className={'timeline' + (big ? ' big' : '')} ref={ref} style={{ height: h }}>
      <svg width={w} height={big ? Math.max(260, top + bandH + 60) : h}>
        <text x={10} y={top + 14} className="tl-edge">Start</text>
        <text x={10} y={top + 29} className="tl-date">{fmt(s.start)}</text>
        <text x={w - 10} y={top + 14} className="tl-edge end">Finish</text>
        <text x={w - 10} y={top + 29} className="tl-date end">{fmt(s.finish)}</text>
        {ticks.filter((_, i) => i % step === 0).map(t => <g key={t.x}><line x1={t.x} x2={t.x} y1={top} y2={top + bandH + 16} className="tl-grid" /><text x={t.x + 4} y={top + bandH + 14} className="tl-tick">{t.label}</text></g>)}
        <rect x={pad} y={top} width={Math.max(0, x(b) - pad)} height={bandH} rx={4} className="tl-band" />
        {vis && <rect x={Math.max(pad, x(vis[0]))} y={top - 4} width={Math.max(6, Math.min(x(b), x(vis[1])) - Math.max(pad, x(vis[0])))} height={bandH + 8} rx={3} className="tl-window" onMouseDown={e => { e.preventDefault(); setDrag({ x0: e.clientX, a: vis[0] }); }} />}
        {bp.placed.map(({ r, lane }) => {
          const x1 = x(r.start), bw = Math.max(3, x(r.finish) - x1);
          return (
            <g key={r.task.uid} className={'tl-bar' + (sel.includes(r.task.uid) ? ' sel' : '')} onMouseDown={() => pick(r.task.uid)} onDoubleClick={() => (S().set({ sel: [r.task.uid] }), S().setUI({ inspector: true }))} onContextMenu={e => ctx(e, r.task.uid)}>
              <rect x={x1} y={top + lane * laneH + 3} width={bw} height={laneH - 6} rx={3} style={{ fill: color(r) }} />
              <clipPath id={'tlc' + r.task.uid}><rect x={x1} y={top + lane * laneH} width={bw} height={laneH} /></clipPath>
              <g clipPath={'url(#tlc' + r.task.uid + ')'}>
                <text x={x1 + 5} y={top + lane * laneH + laneH / 2 + (big ? -1 : 4)}>{r.task.name}</text>
                {big && <text x={x1 + 5} y={top + lane * laneH + laneH / 2 + 10} className="tl-sub">{fmt(r.start)} – {fmt(r.finish)}</text>}
              </g>
            </g>
          );
        })}
        {cp.placed.map(({ r, lane }) => {
          const x1 = x(r.start), x2 = x(r.finish), y = calloutTop + lane * 20;
          return (
            <g key={'c' + r.task.uid} className={'tl-call' + (sel.includes(r.task.uid) ? ' sel' : '')} onMouseDown={() => pick(r.task.uid)} onDoubleClick={() => (S().set({ sel: [r.task.uid] }), S().setUI({ inspector: true }))} onContextMenu={e => ctx(e, r.task.uid)}>
              <path d={`M${x1} ${top}V${y + 8}H${x2}V${top}`} />
              <text x={x1 + 4} y={y + 4}>{r.task.name} <tspan className="tl-sub">{fmt(r.start)} – {fmt(r.finish)}</tspan></text>
            </g>
          );
        })}
        {miles.map((r, k) => {
          const mx = x(r.start), right = mx > w - 200;
          return (
            <g key={r.task.uid} className={'tl-ms' + (sel.includes(r.task.uid) ? ' sel' : '')} onMouseDown={() => pick(r.task.uid)} onDoubleClick={() => (S().set({ sel: [r.task.uid] }), S().setUI({ inspector: true }))} onContextMenu={e => ctx(e, r.task.uid)}>
              <line x1={mx} x2={mx} y1={calloutTop - 34 + 14 + (k % 2) * 13} y2={top} className="tl-stem" />
              <path d={`M${mx} ${top - 6}l6 6-6 6-6-6z`} />
              <text x={mx + (right ? -6 : 6)} y={calloutTop - 34 + 16 + (k % 2) * 13} textAnchor={right ? 'end' : 'start'}>{r.task.name} <tspan className="tl-sub">{fmt(r.start)}</tspan></text>
            </g>
          );
        })}
        {today >= a && today <= b && <><line x1={x(today)} x2={x(today)} y1={top - 6} y2={top + bandH + 6} className="tl-today" /><text x={x(today) - 4} y={top - 8} textAnchor="end" className="tl-tick today">Today</text></>}
        {!items.length && <text x={w / 2} y={top + 16} className="tl-hint">Right-click a task and choose Add to Timeline</text>}
      </svg>
      {menu && (
        <div className="cmenu" style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.stopPropagation()}>
          {(() => {
            const t = p.tasks.find(q => q.uid === menu.uid);
            if (!t) return null;
            const act = (f: () => void) => () => { setMenu(null); f(); };
            return <>
              <button className="cm-item" onClick={act(() => S().commit(updateTask(S().p, t.uid, { tlCallout: !t.tlCallout })))}>{t.tlCallout ? 'Display as Bar' : 'Display as Callout'}</button>
              <button className="cm-item" onClick={act(() => S().commit(updateTask(S().p, t.uid, { timeline: false })))}>Remove from Timeline</button>
              <button className="cm-item" onClick={act(() => (S().set({ sel: [t.uid] }), S().setUI({ inspector: true })))}>Task details…</button>
            </>;
          })()}
        </div>
      )}
    </div>
  );
}

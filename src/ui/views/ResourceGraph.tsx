// Resource Graph: the load of one resource over time against its availability. Bars above the maximum units
// are overallocated and shown in red.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buckets, phasedResource } from '../../engine/timephase';
import { formatDuration } from '../../engine/duration';
import { formatUnitLabel, todayMinutes } from '../../engine/time';
import { S, useStore } from '../store';
import { money } from '../columns';
import { chartRange } from '../Gantt';
import Icon from '../Icon';

const FIELDS: [string, string][] = [['peak', 'Peak Units'], ['work', 'Work'], ['overalloc', 'Overallocation'], ['percent', 'Percent Allocation'], ['remaining', 'Remaining Availability'], ['cost', 'Cost']];
const UNIT_W: Record<string, number> = { day: 34, week: 54, month: 70, quarter: 84, year: 90 };
const LABEL: Record<string, string> = { day: 'ddd d', week: 'd MMM', month: "MMM 'yy", quarter: 'Qn yyyy', year: 'yyyy' };

export function ResourceGraph() {
  const st = useStore();
  const { p, s, ui } = st;
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(420);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setH(el.clientHeight)); ro.observe(el); return () => ro.disconnect(); }, []);
  const scrolledFor = useRef('');
  const work = p.resources.filter(r => r.type === 'Work');
  const res = p.resources.find(r => r.uid === st.resSel[0] && r.type === 'Work') || work[0];
  const unit = ui.usageUnit;
  const field = ui.graphField;
  const [from, to] = useMemo(() => chartRange(s, p), [s, p]);
  const bks = useMemo(() => buckets(unit, from, to, p.gantt.timescale.weekStart), [unit, from, to, p.gantt.timescale.weekStart]);
  const data = useMemo(() => (res ? phasedResource(res.uid, s, p, bks) : null), [res, s, p, bks]);
  if (!res || !data) return <div className="empty-view"><Icon name="graph" size={40} /><p>Add work resources in the People view to see their load over time.</p></div>;
  const cal = s.calendars.get(res.calendar, p.calendar);
  const cap = bks.map((b, k) => data.avail[k] * cal.workBetween(b.start, b.end));
  const series = bks.map((_, k) => {
    switch (field) {
      case 'work': return data.work[k];
      case 'overalloc': return Math.max(0, data.work[k] - cap[k]);
      case 'remaining': return Math.max(0, cap[k] - data.work[k]);
      case 'cost': return data.cost[k];
      case 'percent': return cap[k] ? data.work[k] / cap[k] * 100 : 0;
      default: return data.peak[k] * 100;
    }
  });
  const limit = bks.map((_, k) => (field === 'peak' || field === 'percent' ? data.avail[k] * 100 : field === 'work' ? cap[k] : null));
  const bw = UNIT_W[unit];
  const chartH = Math.max(200, h - 80);
  const maxV = Math.max(1, ...series, ...limit.map(v => v ?? 0)) * 1.15;
  const y = (v: number) => chartH - v / maxV * (chartH - 20);
  const fmt = (v: number) => (field === 'cost' ? money({ p }, v).replace(/\.00$/, '') : field === 'peak' || field === 'percent' ? Math.round(v) + '%' : formatDuration({ minutes: v, unit: 'h', elapsed: false, estimated: false }, p.settings).replace(' hrs', 'h').replace(' hr', 'h'));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => maxV / 1.15 * f);
  const today = todayMinutes();
  let path = '';
  limit.forEach((v, k) => { if (v == null) return; path += (k === 0 || limit[k - 1] == null ? 'M' : 'L') + (k * bw) + ' ' + y(v) + 'H' + ((k + 1) * bw); });
  return (
    <div className="rgraph" ref={ref}>
      <div className="rg-side">
        <h3>Resources</h3>
        <ul>{work.map(r => <li key={r.uid}><button className={r.uid === res.uid ? 'on' : ''} onClick={() => S().set({ resSel: [r.uid] })}>{s.overallocated.has(r.uid) && <Icon name="alert" />}{r.name}<small>{Math.round(r.maxUnits * 100)}%</small></button></li>)}</ul>
        <h3>Show</h3>
        <div className="chips">{FIELDS.map(([k, l]) => <button key={k} className={'chip' + (field === k ? ' on' : '')} onClick={() => S().setUI({ graphField: k })}>{l}</button>)}</div>
        <h3>Timescale</h3>
        <div className="chips">{(['day', 'week', 'month', 'quarter'] as const).map(u => <button key={u} className={'chip' + (unit === u ? ' on' : '')} onClick={() => S().setUI({ usageUnit: u })}>{u[0].toUpperCase() + u.slice(1) + 's'}</button>)}</div>
        <div className="rg-legend"><span className="sw ok" />Allocated <span className="sw over" />Overallocated {limit.some(v => v != null) && <><span className="sw line" />Available</>}</div>
      </div>
      <div className="rg-chart">
        <div className="rg-axis" style={{ height: chartH }}>{ticks.map((t, k) => <span key={k} style={{ top: y(t) - 7 }}>{fmt(t)}</span>)}</div>
        <div className="rg-scroll" ref={(el: HTMLDivElement | null) => { if (el && scrolledFor.current !== unit) { scrolledFor.current = unit; el.scrollLeft = Math.max(0, (Math.max(0, bks.findIndex(b => b.end > s.start)) - 1) * bw); } }}>
          <svg width={bks.length * bw} height={chartH + 40}>
            {ticks.map((t, k) => <line key={k} x1={0} x2={bks.length * bw} y1={y(t)} y2={y(t)} className="rg-grid" />)}
            {bks.map((b, k) => {
              const v = series[k], lim = limit[k];
              if (b.start <= today && today < b.end) return <g key={k}><rect x={k * bw} y={0} width={bw} height={chartH} className="rg-today" />{bar(k, v, lim)}</g>;
              return <g key={k}>{bar(k, v, lim)}</g>;
            })}
            {path && <path d={path} className="rg-limit" />}
            {bks.map((b, k) => (k % Math.max(1, Math.round(60 / bw)) === 0 ? <text key={'l' + k} x={k * bw + 3} y={chartH + 16} className="rg-lbl">{formatUnitLabel(LABEL[unit], b.start)}</text> : null))}
          </svg>
        </div>
        <div className="rg-title"><b>{res.name}</b> · {field === 'peak' ? 'Peak units' : FIELDS.find(f => f[0] === field)?.[1]} by {unit}</div>
      </div>
    </div>
  );
  function bar(k: number, v: number, lim: number | null) {
    if (!v) return null;
    const x = k * bw + 4, w = bw - 8;
    if (lim == null || v <= lim + 1e-6 || field === 'overalloc') return <rect x={x} y={y(v)} width={w} height={chartH - y(v)} rx={2} className={field === 'overalloc' ? 'rg-over' : 'rg-ok'}><title>{fmt(v)}</title></rect>;
    return <g><rect x={x} y={y(lim)} width={w} height={chartH - y(lim)} rx={2} className="rg-ok" /><rect x={x} y={y(v)} width={w} height={y(lim) - y(v)} rx={2} className="rg-over"><title>{fmt(v)}</title></rect></g>;
  }
}

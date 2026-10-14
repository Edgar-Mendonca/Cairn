// Flow diagram: each task is a box (name, ID, start, finish, duration, resources) placed in columns by its
// position in the chain of links, with link lines between boxes. Critical tasks are red, milestones are
// drawn as hexagons, phases as slanted boxes; finished tasks are crossed out, started ones half crossed.
import { useMemo, type ReactElement } from 'react';
import type { Row } from '../../engine/schedule';
import { formatDuration, formatShort } from '../../engine/duration';
import { fmtDate } from '../../engine/time';
import { S, useStore } from '../store';
import { formatResourceNames } from '../../engine/ops';
import { matchesFilter } from '../actions';
import Icon from '../Icon';

const W = 196, H = 92, GX = 64, GY = 26;

export function NetworkDiagram() {
  const st = useStore();
  const { p, s, ui } = st;
  const z = ui.netZoom;
  const layout = useMemo(() => {
    const show = (r: Row) => (ui.netSummaries || !r.summary) && r.task.active && (ui.filter === 'all' || matchesFilter(r, ui.filter, st));
    const nodes = s.rows.filter(show);
    const idx = new Map(nodes.map((r, k) => [r.i, k]));
    // Links between shown tasks, at the level they were drawn (summary links stay on the summary).
    const links: { a: number; b: number; label: string; crit: boolean; driving: boolean }[] = [];
    nodes.forEach(r => r.task.preds.forEach(l => {
      const pr = s.byUid.get(l.pred);
      if (!pr || !idx.has(pr.i)) return;
      const lag = l.lag ? (l.lag > 0 ? '+' : '-') + (l.lagPercent ? Math.abs(l.lag) + '%' : formatShort(Math.abs(l.lag), l.lagUnit, l.lagElapsed, p.settings)) : '';
      links.push({ a: idx.get(pr.i)!, b: idx.get(r.i)!, label: l.type !== 'FS' || lag ? l.type + lag : '', crit: pr.critical && r.critical && !r.summary && !pr.summary, driving: false });
    }));
    // Summary tasks sit before their first subtask.
    const col = new Array(nodes.length).fill(0);
    const order = nodes.map((_, k) => k).sort((a, b) => nodes[a].es - nodes[b].es || nodes[a].id - nodes[b].id);
    for (let pass = 0; pass < nodes.length + 2; pass++) {
      let changed = false;
      for (const l of links) if (col[l.b] < col[l.a] + 1 && col[l.a] + 1 < 400) { col[l.b] = col[l.a] + 1; changed = true; }
      if (!changed) break;
    }
    if (ui.netSummaries) nodes.forEach((r, k) => { if (r.summary) { const kids = r.children.map(c => idx.get(c)).filter((v): v is number => v != null); if (kids.length) col[k] = Math.max(0, Math.min(...kids.map(c => col[c])) - (kids.some(c => col[c] === 0) ? 0 : 1)); } });
    // Rows within each column: barycentre of predecessors, then early start.
    const byCol = new Map<number, number[]>();
    order.forEach(k => { const l = byCol.get(col[k]) || []; l.push(k); byCol.set(col[k], l); });
    const row = new Array(nodes.length).fill(0);
    [...byCol.keys()].sort((a, b) => a - b).forEach(c => {
      const list = byCol.get(c)!;
      const bary = (k: number) => { const ps = links.filter(l => l.b === k).map(l => row[l.a]); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 1e6 + nodes[k].es / 1e6; };
      list.sort((a, b) => bary(a) - bary(b) || nodes[a].es - nodes[b].es);
      const used = new Set<number>();
      list.forEach(k => { let r0 = Math.max(0, Math.round(bary(k) >= 1e6 ? 0 : bary(k))); while (used.has(r0)) r0++; used.add(r0); row[k] = r0; });
    });
    const maxCol = Math.max(0, ...col), maxRow = Math.max(0, ...row);
    return { nodes, links, col, row, w: (maxCol + 1) * (W + GX) + GX, h: (maxRow + 1) * (H + GY) + GY * 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, p, ui.netSummaries, ui.filter, ui.filterArgs]);
  const { nodes, links, col, row } = layout;
  const pos = (k: number) => ({ x: GX / 2 + col[k] * (W + GX), y: GY + row[k] * (H + GY) });
  const sel = new Set(st.sel);
  const fmt = (t: number) => fmtDate(t, { weekday: false, format: p.settings.dateFormat });
  const els: ReactElement[] = [];
  links.forEach((l, k) => {
    const a = pos(l.a), b = pos(l.b);
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    const mx = x1 + GX / 2;
    const d = Math.abs(y1 - y2) < 1 ? `M${x1} ${y1}H${x2 - 2}` : `M${x1} ${y1}H${mx - 6}Q${mx} ${y1} ${mx} ${y1 + Math.sign(y2 - y1) * 6}V${y2 - Math.sign(y2 - y1) * 6}Q${mx} ${y2} ${mx + 6} ${y2}H${x2 - 2}`;
    els.push(<path key={'l' + k} d={d} className={'net-link' + (l.crit ? ' crit' : '')} markerEnd={l.crit ? 'url(#net-ahc)' : 'url(#net-ah)'} />);
    if (l.label) els.push(<text key={'lt' + k} x={mx + 4} y={(y1 + y2) / 2 - 3} className="net-lag">{l.label}</text>);
  });
  nodes.forEach((r, k) => {
    const { x, y } = pos(k);
    const ms = !r.summary && r.duration === 0;
    const cls = 'net-node' + (r.critical && !r.summary ? ' crit' : '') + (ms ? ' ms' : '') + (r.summary ? ' sum' : '') + (sel.has(r.task.uid) ? ' sel' : '') + (r.task.mode === 'manual' ? ' manual' : '');
    const shape = ms ? `M${x + 10} ${y}H${x + W - 10}L${x + W} ${y + H / 2}L${x + W - 10} ${y + H}H${x + 10}L${x} ${y + H / 2}z`
      : r.summary ? `M${x + 8} ${y}H${x + W}L${x + W - 8} ${y + H}H${x}z` : `M${x + 4} ${y}H${x + W - 4}Q${x + W} ${y} ${x + W} ${y + 4}V${y + H - 4}Q${x + W} ${y + H} ${x + W - 4} ${y + H}H${x + 4}Q${x} ${y + H} ${x} ${y + H - 4}V${y + 4}Q${x} ${y} ${x + 4} ${y}z`;
    const res = formatResourceNames(p, r.task);
    const name = r.task.name || '(no name)';
    const lines = wrap(name, 27).slice(0, 2);
    els.push(
      <g key={'n' + r.task.uid} className={cls} onMouseDown={e => { e.stopPropagation(); S().set({ sel: [r.task.uid] }); }} onDoubleClick={() => (S().set({ sel: [r.task.uid] }), S().setUI({ inspector: true }))}>
        <path d={shape} className="net-box" />
        <path d={`M${x + (r.summary ? 7 : 0)} ${y + 5}h4v${H - 10}h-4z`} className="net-flag" />
        {lines.map((ln, j) => <text key={j} x={x + 14} y={y + 17 + j * 14} className="net-name">{ln}</text>)}
        <line x1={x + 8} x2={x + W - 8} y1={y + 44} y2={y + 44} className="net-sep" />
        <text x={x + 14} y={y + 58} className="net-f">Start: {fmt(r.start)}</text>
        <text x={x + W - 10} y={y + 58} className="net-f r">ID: {r.id}</text>
        <text x={x + 14} y={y + 72} className="net-f">Finish: {fmt(r.finish)}</text>
        <text x={x + W - 10} y={y + 72} className="net-f r">Dur: {formatDuration({ minutes: r.duration, unit: r.summary ? p.settings.durationUnit : r.task.durUnit, elapsed: r.task.elapsed, estimated: r.task.estimated }, p.settings).replace(' days', 'd').replace(' day', 'd')}</text>
        <text x={x + 14} y={y + 86} className="net-f res">{res ? 'Res: ' + (res.length > 30 ? res.slice(0, 29) + '…' : res) : ''}</text>
        {r.percent >= 100 && <path d={`M${x + 2} ${y + 2}L${x + W - 2} ${y + H - 2}M${x + W - 2} ${y + 2}L${x + 2} ${y + H - 2}`} className="net-x" />}
        {r.percent > 0 && r.percent < 100 && <path d={`M${x + 2} ${y + H - 2}L${x + W - 2} ${y + 2}`} className="net-x" />}
      </g>
    );
  });
  return (
    <div className="network">
      <div className="net-tools">
        <button className="chip" onClick={() => S().setUI({ netZoom: Math.max(0.3, z / 1.25) })}><Icon name="zoomout" />Zoom out</button>
        <button className="chip" onClick={() => S().setUI({ netZoom: Math.min(2, z * 1.25) })}><Icon name="zoomin" />Zoom in</button>
        <button className="chip" onClick={() => S().setUI({ netZoom: 1 })}>100%</button>
        <label className="chk"><input type="checkbox" checked={ui.netSummaries} onChange={e => S().setUI({ netSummaries: e.target.checked })} />Summary tasks</label>
        <span className="sp" />
        <span className="net-legend"><i className="lg crit" />Critical <i className="lg" />Noncritical <i className="lg ms" />Milestone <i className="lg sum" />Summary · ✕ complete, ╱ in progress</span>
      </div>
      <div className="net-scroll" onMouseDown={() => S().set({ sel: [] })}>
        <svg width={layout.w * z} height={layout.h * z} viewBox={`0 0 ${layout.w} ${layout.h}`}>
          <defs>
            <marker id="net-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" className="net-ahp" /></marker>
            <marker id="net-ahc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" className="net-ahp crit" /></marker>
          </defs>
          {els}
        </svg>
        {!nodes.length && <div className="empty-view"><Icon name="network" size={40} /><p>No tasks to show.</p></div>}
      </div>
    </div>
  );
}

function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  text.split(/\s+/).forEach(w => { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
  if (cur) out.push(cur);
  if (out.length > 2) out[1] = out[1].slice(0, n - 1) + '…';
  return out;
}

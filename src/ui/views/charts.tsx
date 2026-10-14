// Small SVG chart kit for reports: line and bar charts with hover tooltips, a progress ring and data tables.
// Colours follow a validated categorical order; text stays in ink colours; one value axis per chart.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
export interface Series { name: string; values: number[]; color?: string; dash?: boolean }

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return <div className="ch-legend">{series.map((s, k) => <span key={s.name}><i style={{ background: s.color || SERIES[k] }} className={s.dash ? 'dash' : ''} />{s.name}</span>)}</div>;
}

export function LineChart({ labels, series, fmt, height = 220 }: { labels: string[]; series: Series[]; fmt: (v: number) => string; height?: number }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const L = 56, R = 12, T = 10, B = 26;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap(s => s.values).filter(Number.isFinite)));
  const x = (i: number) => L + (n <= 1 ? 0 : i / (n - 1) * (w - L - R));
  const y = (v: number) => T + (1 - v / max) * (height - T - B);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - L - R) / 70))));
  return (
    <div className="chart" ref={ref}>
      <Legend series={series} />
      <svg width={w} height={height} onMouseLeave={() => setHover(null)}
        onMouseMove={e => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); const i = Math.round((e.clientX - r.left - L) / Math.max(1, w - L - R) * (n - 1)); setHover(i >= 0 && i < n ? i : null); }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line x1={L} x2={w - R} y1={y(max * f)} y2={y(max * f)} className="ch-grid" /><text x={L - 6} y={y(max * f) + 4} className="ch-axis" textAnchor="end">{fmt(max * f)}</text></g>)}
        {labels.map((l, i) => (i % step === 0 ? <text key={i} x={x(i)} y={height - 8} className="ch-axis" textAnchor="middle">{l}</text> : null))}
        {series.map((s, k) => <path key={s.name} d={s.values.map((v, i) => (Number.isFinite(v) ? (i && Number.isFinite(s.values[i - 1]) ? 'L' : 'M') + x(i) + ' ' + y(v) : '')).join('')} fill="none" stroke={s.color || SERIES[k]} strokeWidth={2} strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" />)}
        {hover != null && <g>
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={height - B} className="ch-cross" />
          {series.filter(s => Number.isFinite(s.values[hover])).map(s => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color || SERIES[series.indexOf(s)]} stroke="var(--panel)" strokeWidth={2} />)}
        </g>}
      </svg>
      {hover != null && <div className="ch-tip" style={{ left: Math.min(w - 170, x(hover) + 10) }}><b>{labels[hover]}</b>{series.map((s, k) => (Number.isFinite(s.values[hover]) ? <span key={s.name}><i style={{ background: s.color || SERIES[k] }} />{s.name}<em>{fmt(s.values[hover])}</em></span> : null))}</div>}
    </div>
  );
}

export function BarChart({ labels, series, fmt, stacked, horizontal, height }: { labels: string[]; series: Series[]; fmt: (v: number) => string; stacked?: boolean; horizontal?: boolean; height?: number }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const tot = (i: number) => (stacked ? series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0) : Math.max(0, ...series.map(s => s.values[i] || 0)));
  const minV = Math.min(0, ...series.flatMap(s => s.values));
  const max = niceMax(Math.max(0, ...labels.map((_, i) => tot(i))));
  if (horizontal) {
    const rowH = stacked || series.length === 1 ? 26 : 12 * series.length + 10;
    const L = Math.min(220, Math.max(90, Math.max(...labels.map(l => l.length)) * 6.6 + 12)), R = 70;
    const H = height || n * rowH + 24;
    const lo = Math.min(0, minV), span = max - lo || 1;
    const x = (v: number) => L + (v - lo) / span * (w - L - R);
    return (
      <div className="chart" ref={ref}>
        <Legend series={series} />
        <svg width={w} height={H} onMouseLeave={() => setHover(null)}>
          {lo < 0 && <line x1={x(0)} x2={x(0)} y1={0} y2={H - 20} className="ch-zero" />}
          {labels.map((l, i) => {
            const y0 = i * rowH + 4;
            let acc = 0;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={0} y={y0 - 2} width={w} height={rowH} fill="transparent" />
                <text x={L - 8} y={y0 + rowH / 2 + 2} className="ch-label" textAnchor="end">{l.length > 32 ? l.slice(0, 31) + '…' : l}</text>
                {series.map((s, k) => {
                  const v = s.values[i] || 0;
                  const bh = stacked || series.length === 1 ? rowH - 10 : 10;
                  const by = stacked || series.length === 1 ? y0 + 2 : y0 + k * 12;
                  const a = stacked ? x(acc) : x(Math.min(0, v)), b = stacked ? x(acc + Math.max(0, v)) : x(Math.max(0, v));
                  if (stacked) acc += Math.max(0, v);
                  return <rect key={k} x={a} y={by} width={Math.max(0, b - a - (stacked ? 2 : 0))} height={bh} rx={3} fill={s.color || SERIES[k]} />;
                })}
                <text x={x(stacked ? tot(i) : Math.max(0, ...series.map(s => s.values[i] || 0))) + 6} y={y0 + rowH / 2 + 2} className="ch-value">{fmt(stacked ? tot(i) : series[0].values[i] || 0)}</text>
              </g>
            );
          })}
        </svg>
        {hover != null && <div className="ch-tip" style={{ left: L + 10, top: hover * rowH + 30 }}><b>{labels[hover]}</b>{series.map((s, k) => <span key={s.name}><i style={{ background: s.color || SERIES[k] }} />{s.name}<em>{fmt(s.values[hover] || 0)}</em></span>)}</div>}
      </div>
    );
  }
  const H = height || 220, L = 56, R = 10, T = 10, B = 28;
  const slot = (w - L - R) / Math.max(1, n);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - L - R) / 64))));
  return (
    <div className="chart" ref={ref}>
      <Legend series={series} />
      <svg width={w} height={H} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line x1={L} x2={w - R} y1={y(max * f)} y2={y(max * f)} className="ch-grid" /><text x={L - 6} y={y(max * f) + 4} className="ch-axis" textAnchor="end">{fmt(max * f)}</text></g>)}
        {labels.map((l, i) => {
          let acc = 0;
          const bw = stacked ? Math.max(2, slot * 0.62) : Math.max(2, slot * 0.7 / series.length);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill={hover === i ? 'var(--hover)' : 'transparent'} opacity={0.5} />
              {series.map((s, k) => {
                const v = Math.max(0, s.values[i] || 0);
                const x0 = stacked ? L + i * slot + (slot - bw) / 2 : L + i * slot + slot * 0.15 + k * bw;
                const top = stacked ? y(acc + v) : y(v), bot = stacked ? y(acc) : y(0);
                if (stacked) acc += v;
                return <rect key={k} x={x0} y={top} width={bw - 1} height={Math.max(0, bot - top - (stacked && acc > v ? 2 : 0))} rx={Math.min(3, bw / 3)} fill={s.color || SERIES[k]} />;
              })}
              {i % step === 0 && <text x={L + i * slot + slot / 2} y={H - 10} className="ch-axis" textAnchor="middle">{l}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && <div className="ch-tip" style={{ left: Math.min(w - 170, L + hover * slot + slot) }}><b>{labels[hover]}</b>{series.map((s, k) => <span key={s.name}><i style={{ background: s.color || SERIES[k] }} />{s.name}<em>{fmt(s.values[hover] || 0)}</em></span>)}</div>}
    </div>
  );
}

export function Ring({ value, label, size = 120 }: { value: number; label: string; size?: number }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <div className="ring" style={{ width: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" strokeWidth={12} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--series-1)" strokeWidth={12} fill="none" strokeDasharray={`${c * v / 100} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x={size / 2} y={size / 2 + 8} textAnchor="middle" className="ring-v">{Math.round(v)}%</text>
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function Tiles({ items }: { items: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }[] }) {
  return <div className="tiles">{items.map(t => <div key={t.label} className={'tile' + (t.tone ? ' ' + t.tone : '')}><span>{t.label}</span><b>{t.value}</b>{t.note && <small>{t.note}</small>}</div>)}</div>;
}

export function DataTable({ cols, rows, empty = 'Nothing to show.' }: { cols: { label: string; right?: boolean }[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <table className="rtable">
      <thead><tr>{cols.map(c => <th key={c.label} className={c.right ? 'r' : ''}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((v, k) => <td key={k} className={cols[k]?.right ? 'r' : ''}>{v}</td>)}</tr>) : <tr><td colSpan={cols.length} className="muted">{empty}</td></tr>}</tbody>
    </table>
  );
}

export const Card = ({ title, children, wide, note }: { title: string; children: ReactNode; wide?: boolean; note?: string }) => (
  <section className={'rcard' + (wide ? ' wide' : '')}><h3>{title}</h3>{note && <p className="rnote">{note}</p>}{children}</section>
);

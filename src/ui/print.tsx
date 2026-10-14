// Printing (File › Print with Page Setup) and Copy Picture. A view is laid out on pages as self-contained SVG:
// the table on the left, the Gantt chart with its timescale on the right, a header, a footer and a legend.
// Wide or long plans continue across and down pages.
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Row } from '../engine/schedule';
import type { Project } from '../engine/model';
import { stylesFor, timescaleForPx } from '../engine/gantt';
import { fmtDate, todayMinutes, type Minutes } from '../engine/time';
import { S, VIEW_LABELS, GANTT_VIEWS, type Store } from './store';
import { cellFormat, ctxOf, currentColumns, fontPx, visibleRows } from './actions';
import { makeColumn, type Column } from './columns';
import { activeTiers, pxPerDay, tierCells } from './gantt/timescale';
import { drawRow, endShape, maxBarRow, blockHeight, patternDefs, type DrawCtx } from './gantt/draw';
import { toggleSet } from './Gantt';

export interface PageSetup {
  paper: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  orientation: 'landscape' | 'portrait';
  scale: number;              // % of the screen timescale
  fitWide: number;            // 0 = use scale; otherwise fit the timescale on this many pages across
  margin: number;             // mm
  header: [string, string, string];
  footer: [string, string, string];
  legend: 'every' | 'none';
  columns: 'shown' | 'all' | 'name';
  range: 'all' | 'dates';
  from: Minutes | null; to: Minutes | null;
  repeatName: boolean;        // repeat ID and name on pages across
  gridlines: boolean;
}

export const DEFAULT_SETUP: PageSetup = {
  paper: 'A4', orientation: 'landscape', scale: 100, fitWide: 1, margin: 10,
  header: ['', '&[Project Title]', ''], footer: ['Printed &[Date]', '', 'Page &[Page] of &[Pages]'], legend: 'every', columns: 'shown', range: 'all', from: null, to: null, repeatName: true, gridlines: true
};

const PAPER: Record<PageSetup['paper'], [number, number]> = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] };
export const MM = 96 / 25.4;
export const pageSize = (o: PageSetup): [number, number] => { const [a, b] = PAPER[o.paper]; return o.orientation === 'landscape' ? [b * MM, a * MM] : [a * MM, b * MM]; };

const ROW = 22, HEAD = 40, TOP = 40, FOOT = 30, LEG = 46;

interface Plan { pages: { rows: [number, number]; time: [Minutes, Minutes]; first: boolean; col: number }[]; rows: Row[]; cols: Column[]; tableW: number; nameW: number; px: number; W: number; H: number; across: number; down: number }

export function layoutPages(st: Store, o: PageSetup): Plan {
  const [W, H] = pageSize(o);
  const rows = visibleRows(st);
  const gantt = GANTT_VIEWS.has(st.ui.view);
  let cols = currentColumns(st).filter(c => c.field !== 'indicators').map(c => makeColumn(c, st.p)).filter((c): c is Column => !!c);
  if (o.columns === 'name') cols = cols.filter(c => c.key === 'name' || c.key === 'id');
  else if (o.columns === 'shown' && gantt) {
    // The columns left of the divider.
    let w = 40; cols = cols.filter(c => { w += c.width; return w <= st.ui.gridWidth + 20 || c.key === 'name'; });
  }
  const tableW = 34 + cols.reduce((a, c) => a + Math.min(c.width, 360), 0);
  const nameW = 34 + Math.min(260, cols.find(c => c.key === 'name')?.width ?? 200);
  const inner = W - o.margin * 2 * MM;
  const bodyH = H - o.margin * 2 * MM - TOP - FOOT - (o.legend === 'every' && gantt ? LEG : 0) - HEAD;
  const perPage = Math.max(1, Math.floor(bodyH / ROW));
  const a0 = o.range === 'dates' && o.from != null ? o.from : st.s.start - 2 * 1440;
  const b0 = o.range === 'dates' && o.to != null ? o.to : st.s.finish + 3 * 1440;
  let px = pxPerDay(st.p.gantt.timescale) * o.scale / 100;
  if (!gantt) px = 0;
  const firstW = Math.max(120, inner - tableW), laterW = inner - (o.repeatName ? nameW : 0);
  if (gantt && o.fitWide > 0) {
    const days = (b0 - a0) / 1440;
    px = (firstW + laterW * (o.fitWide - 1)) / days;
  }
  // Time windows across.
  const windows: [Minutes, Minutes][] = [];
  if (gantt) {
    let t = a0, first = true;
    while (t < b0 && windows.length < 60) { const w = first ? firstW : laterW; const e = t + w / px * 1440; windows.push([t, e]); t = e; first = false; }
  } else windows.push([a0, b0]);
  const pages: Plan['pages'] = [];
  const down = Math.max(1, Math.ceil(rows.length / perPage));
  for (let d = 0; d < down; d++) windows.forEach((w, k) => pages.push({ rows: [d * perPage, Math.min(rows.length, (d + 1) * perPage)], time: w, first: k === 0, col: k }));
  return { pages, rows, cols, tableW, nameW, px, W, H, across: windows.length, down };
}

function codes(s: string, st: Store, page: number, pages: number): string {
  return s.replace(/&\[Page\]/g, String(page)).replace(/&\[Pages\]/g, String(pages)).replace(/&\[Project Title\]/g, st.p.name).replace(/&\[Date\]/g, fmtDate(todayMinutes(), { weekday: false, format: st.p.settings.dateFormat }))
    .replace(/&\[Manager\]/g, st.p.manager).replace(/&\[Company\]/g, st.p.company).replace(/&\[View\]/g, VIEW_LABELS[st.ui.view]).replace(/&\[Finish\]/g, fmtDate(st.s.finish, { weekday: false, format: st.p.settings.dateFormat })).replace(/&\[Start\]/g, fmtDate(st.s.start, { weekday: false, format: st.p.settings.dateFormat }));
}

// Styles embedded in each page so it prints and copies the same everywhere (light colours).
export const PRINT_CSS = `
text{font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;font-size:10.5px;fill:#1f2937}
.ph{font-size:11px;fill:#374151}.ph.t{font-size:13px;font-weight:600;fill:#111827}
.th{font-weight:600;fill:#374151}.sum{font-weight:600}.lbl{font-size:10px;fill:#374151}.lbl.small{font-size:9px}.lbl.inside{fill:#fff}
.tl{font-size:10px;fill:#4b5563}.grid{stroke:#e5e7eb;stroke-width:1}.tier{fill:#f6f7f9;stroke:#d9dde3}.nw{fill:#f1f3f6}
.lnk{fill:none;stroke:#4a6fa5;stroke-width:1}.lnk.crit{stroke:#c0392b}.ah{fill:#4a6fa5}.ah.crit{fill:#c0392b}
.leg{font-size:10px}.frame{fill:none;stroke:#cfd5dd}`;

function Page({ st, plan, k, o }: { st: Store; plan: Plan; k: number; o: PageSetup }) {
  const pg = plan.pages[k];
  const { p, s } = st;
  const gantt = GANTT_VIEWS.has(st.ui.view);
  const m = o.margin * MM, W = plan.W, H = plan.H;
  const left = pg.first ? plan.tableW : o.repeatName ? plan.nameW : 0;
  const x0 = m + left;
  const [ta, tb] = pg.time;
  const x = (t: Minutes) => x0 + (t - ta) / 1440 * plan.px;
  const top = m + TOP;
  const body = top + HEAD;
  const rows = plan.rows.slice(pg.rows[0], pg.rows[1]);
  const ctx = ctxOf(st);
  const els: ReactElement[] = [];
  const total = plan.pages.length;
  // Header and footer
  const hf = (txt: [string, string, string], y: number, cls: string) => txt.map((t, i) => t ? <text key={cls + i} x={i === 0 ? m : i === 1 ? W / 2 : W - m} y={y} textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'} className={'ph' + (i === 1 && cls === 'h' ? ' t' : '')}>{codes(t, st, k + 1, total)}</text> : null);
  els.push(<g key="hdr">{hf(o.header, m + 16, 'h')}</g>);
  els.push(<g key="ftr">{hf(o.footer, H - m - 8, 'f')}</g>);
  const bottom = body + rows.length * ROW;
  // Table
  const tableCols = pg.first ? plan.cols : o.repeatName ? plan.cols.filter(c => c.key === 'name') : [];
  if (tableCols.length) {
    let cx = m + 34;
    els.push(<rect key="th" x={m} y={top} width={left} height={HEAD} className="tier" />);
    els.push(<text key="thid" x={m + 4} y={top + HEAD - 8} className="th">ID</text>);
    tableCols.forEach(c => {
      const w = pg.first ? Math.min(c.width, 360) : plan.nameW - 34;
      els.push(<g key={'h' + c.key}><line x1={cx} x2={cx} y1={top} y2={bottom} className="grid" /><text x={cx + 4} y={top + HEAD - 8} className="th">{c.label.length * 6 > w ? c.label.slice(0, Math.max(1, Math.floor(w / 6) - 1)) + '…' : c.label}</text></g>);
      rows.forEach((r, i) => {
        const y = body + i * ROW + ROW / 2 + 4;
        let text = c.text(r, ctx);
        const indent = c.key === 'name' ? Math.max(0, r.task.level - 1) * 12 + 2 : 0;
        const room = w - 8 - indent;
        if (text.length * 5.8 > room) text = text.slice(0, Math.max(1, Math.floor(room / 5.8) - 1)) + '…';
        const f = cellFormat(r, c.key, p);
        const right = c.align === 'right';
        if (f.bg) els.push(<rect key={'bg' + c.key + i} x={cx} y={body + i * ROW} width={w} height={ROW} fill={f.bg} />);
        els.push(<text key={c.key + i} x={right ? cx + w - 4 : cx + 4 + indent} y={y} textAnchor={right ? 'end' : 'start'} className={r.summary ? 'sum' : ''}
          style={{ fill: f.color, fontWeight: f.b ? 700 : undefined, fontStyle: f.i ? 'italic' : undefined, textDecoration: f.u ? 'underline' : f.s ? 'line-through' : undefined, fontFamily: f.font ? '"' + f.font + '"' : undefined, fontSize: f.size ? Math.min(14, fontPx(f.size)! * 0.88) : undefined }}>{r.group ? r.group.label : text}</text>);
      });
      cx += w;
    });
    rows.forEach((r, i) => { els.push(<text key={'id' + i} x={m + 28} y={body + i * ROW + ROW / 2 + 4} textAnchor="end" className="tl">{r.id > 0 ? r.id : ''}</text>); });
  }
  if (o.gridlines) rows.forEach((_, i) => els.push(<line key={'rl' + i} x1={m} x2={W - m} y1={body + (i + 1) * ROW} y2={body + (i + 1) * ROW} className="grid" />));
  // Chart
  if (gantt && plan.px > 0) {
    // A timescale scaled well away from the screen's (fit to pages, 50%) gets tiers that suit the new width.
    const screenPx = pxPerDay(p.gantt.timescale), ratio = plan.px / screenPx;
    const ts = ratio > 0.7 && ratio < 1.4 ? p.gantt.timescale : timescaleForPx(plan.px, p.gantt.timescale);
    const tiers = activeTiers(ts);
    const th = HEAD / tiers.length;
    const cw = W - m - x0;
    els.push(<clipPath key="clip" id={'pclip' + k}><rect x={x0} y={top} width={cw} height={bottom - top + 2} /></clipPath>);
    const ch: ReactElement[] = [];
    tiers.forEach((t, ti) => {
      ch.push(<rect key={'tb' + ti} x={x0} y={top + ti * th} width={cw} height={th} className="tier" />);
      tierCells(t, ts, ta, tb, x).forEach((c, j) => ch.push(<g key={'tc' + ti + '-' + j}><line x1={c.x} x2={c.x} y1={top + ti * th} y2={top + (ti + 1) * th} stroke="#d0d5dc" /><text x={t.align === 'center' ? c.x + c.w / 2 : c.x + 3} y={top + ti * th + th / 2 + 4} textAnchor={t.align === 'center' ? 'middle' : 'start'} className="tl">{c.label}</text></g>));
    });
    if (plan.px >= 2.5 && ts.shade !== 'none') for (let d = Math.floor(ta / 1440); d * 1440 < tb; d++) if (!s.calendar.isWorkingDay(d)) ch.push(<rect key={'nw' + d} x={x(d * 1440)} y={body} width={plan.px} height={rows.length * ROW} fill={ts.shadeColor} />);
    const styles = stylesFor(p.gantt, st.ui.view);
    const toggles = toggleSet(st.ui);
    const dctx: DrawCtx = { p, s, x, layout: p.gantt.layout, toggles, status: p.statusDate ?? todayMinutes(), barText: p.textStyles.barText || {} };
    const Hb = Math.min(p.gantt.layout.barHeight, 11);
    const blk = blockHeight(maxBarRow(styles, toggles), Hb);
    const pat = patternDefs('pp' + k);
    const idx = new Map(rows.map((r, i) => [r.task.uid, i]));
    // Links within the page
    rows.forEach((r, i) => r.task.preds.forEach(l => {
      const j = idx.get(l.pred);
      if (j == null || r.group) return;
      const pr = rows[j];
      const y1 = body + j * ROW + ROW / 2, y2 = body + i * ROW + ROW / 2;
      const fx = l.type === 'FS' || l.type === 'FF' ? x(pr.finish) : x(pr.start), tx = l.type === 'FS' || l.type === 'SS' ? x(r.start) : x(r.finish);
      const crit = st.ui.critical && pr.critical && r.critical;
      const d = l.type === 'FS' && tx >= fx + 5 ? `M${fx} ${y1}H${tx + 2}V${y2 - Math.sign(y2 - y1) * Hb / 2}` : `M${fx} ${y1}h5V${(y1 + y2) / 2}H${tx - 6}V${y2}H${tx}`;
      ch.push(<path key={'lk' + i + '-' + l.pred} d={d} className={'lnk' + (crit ? ' crit' : '')} />);
    }));
    rows.forEach((r, i) => {
      const bt = body + i * ROW + (ROW - blk) / 2;
      const { els: be } = drawRow(r, styles, dctx, bt, Hb, pat, { keyPrefix: 'p' + k + '-' });
      ch.push(<g key={'r' + r.task.uid}>{be}</g>);
    });
    if (p.statusDate != null && p.statusDate >= ta && p.statusDate <= tb) ch.push(<line key="sd" x1={x(p.statusDate)} x2={x(p.statusDate)} y1={body} y2={bottom} stroke="#7a4cc2" strokeDasharray="2 2" />);
    els.push(<defs key="pd">{pat.list}</defs>);
    els.push(<g key="chart" clipPath={'url(#pclip' + k + ')'}>{ch}</g>);
    els.push(<rect key="cf" x={x0} y={top} width={cw} height={bottom - top} className="frame" />);
    // Legend
    if (o.legend === 'every') {
      const ly = H - m - FOOT - LEG + 8;
      els.push(<line key="lgl" x1={m} x2={W - m} y1={ly - 4} y2={ly - 4} stroke="#cfd5dd" />);
      els.push(<text key="lgt" x={m} y={ly + 12} className="ph t">{p.name}</text>);
      els.push(<text key="lgd" x={m} y={ly + 28} className="ph">{fmtDate(s.start, { weekday: false, format: p.settings.dateFormat })} – {fmtDate(s.finish, { weekday: false, format: p.settings.dateFormat })}</text>);
      const shown = styles.filter(sb => !sb.hidden && (!sb.toggle || (toggles as Record<string, boolean>)[sb.toggle]) && !sb.show.includes('rolledUp') && !sb.show.includes('groupBy') && !sb.show.includes('projectSummary') && !sb.show.includes('inactive'));
      const colW = 150, perCol = 3, lx0 = m + 220;
      shown.slice(0, 18).forEach((sb, j) => {
        const lx = lx0 + Math.floor(j / perCol) * colW, ly2 = ly + (j % perCol) * 13;
        if (lx + colW > W - m) return;
        const sample = sb.shape === 'line' ? <line x1={lx} x2={lx + 30} y1={ly2 + 4} y2={ly2 + 4} stroke={sb.color} strokeWidth={1.5} strokeDasharray={sb.pattern === 'dots' ? '2 2' : undefined} />
          : <rect x={lx} y={ly2 + (sb.shape === 'top' ? 0 : sb.shape === 'bottom' ? 4 : sb.shape === 'mid' || sb.shape === 'thin' ? 2 : 0)} width={30} height={sb.shape === 'full' ? 8 : 4} fill={sb.pattern === 'hollow' ? 'none' : sb.color} stroke={sb.pattern === 'hollow' ? sb.color : 'none'} rx={1.5} />;
        els.push(<g key={'lg' + j}>{sample}{endShape(sb.end, lx + 30, ly2, 8, sb.endColor, false, 'le' + j, 8)}{endShape(sb.start, lx, ly2, 8, sb.startColor, true, 'ls' + j, 8)}<text x={lx + 38} y={ly2 + 8} className="leg">{sb.name}</text></g>);
      });
    }
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="print-page">
      <style>{PRINT_CSS}</style>
      <rect width={W} height={H} fill="#fff" />
      {els}
    </svg>
  );
}

export function PrintPages({ o, scale = 1, only }: { o: PageSetup; scale?: number; only?: number }) {
  const st = S();
  const plan = layoutPages(st, o);
  const list = only != null ? [only] : plan.pages.map((_, k) => k);
  return <>{list.filter(k => k < plan.pages.length).map(k => <div key={k} className="print-sheet" style={{ width: plan.W * scale, height: plan.H * scale }}><div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}><Page st={st} plan={plan} k={k} o={o} /></div></div>)}</>;
}

// Prints the pages: renders them into a print-only container and opens the browser's print dialog.
export function printPages(o: PageSetup) {
  let host = document.getElementById('print-root');
  if (!host) { host = document.createElement('div'); host.id = 'print-root'; document.body.appendChild(host); }
  const root = createRoot(host);
  flushSync(() => root.render(<PrintPages o={o} />));
  const [W, H] = pageSize(o);
  const style = document.createElement('style');
  style.id = 'print-page-style';
  style.textContent = `@page { size: ${(W / MM).toFixed(1)}mm ${(H / MM).toFixed(1)}mm; margin: 0; }`;
  document.head.appendChild(style);
  document.body.classList.add('printing');
  setTimeout(() => {
    window.print();
    document.body.classList.remove('printing');
    style.remove();
    root.unmount();
  }, 60);
}

/* ---------- Copy Picture ---------- */

export interface PictureOpts { target: 'clipboard' | 'png' | 'svg'; rows: 'screen' | 'selected' | 'all'; from: Minutes | null; to: Minutes | null; scale: number }

// The view as one picture: all (or the selected) rows and the chosen dates, on a single page-sized SVG.
export async function copyPicture(o: PictureOpts): Promise<string> {
  const st = S();
  const rowsAll = visibleRows(st);
  const rows = o.rows === 'selected' ? rowsAll.filter(r => st.sel.includes(r.task.uid)) : rowsAll;
  if (!rows.length) throw new Error('No rows to copy. Select tasks first, or choose all rows.');
  const fake: Store = { ...st, ui: { ...st.ui } };
  const setup: PageSetup = { ...DEFAULT_SETUP, header: ['', '', ''], footer: ['', '', ''], legend: 'none', margin: 3, columns: 'shown', range: o.from != null && o.to != null ? 'dates' : 'all', from: o.from, to: o.to, scale: 100, fitWide: 0, repeatName: false };
  const plan0 = layoutPages(fake, setup);
  const gantt = GANTT_VIEWS.has(st.ui.view);
  const width = plan0.tableW + (gantt ? ((o.to ?? st.s.finish + 3 * 1440) - (o.from ?? st.s.start - 2 * 1440)) / 1440 * plan0.px : 0) + 12;
  const height = rows.length * ROW + HEAD + TOP + 10;
  const plan: Plan = { ...plan0, rows, W: width, H: height, pages: [{ rows: [0, rows.length], time: [o.from ?? st.s.start - 2 * 1440, o.to ?? st.s.finish + 3 * 1440], first: true, col: 0 }] };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<Page st={fake} plan={plan} k={0} o={setup} />));
  const svg = host.querySelector('svg')!;
  const text = new XMLSerializer().serializeToString(svg);
  root.unmount(); host.remove();
  const name = (st.p.name || 'plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  if (o.target === 'svg') { saveBlob(new Blob([text], { type: 'image/svg+xml' }), name + '.svg'); return 'Picture saved as an SVG file.'; }
  const png = await svgToPng(text, width, height, o.scale);
  if (o.target === 'clipboard' && (navigator.clipboard as any)?.write && (window as any).ClipboardItem) {
    try { await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ 'image/png': png })]); return 'Picture copied. Paste it into a document, email or slide.'; } catch { /* fall back to a download */ }
  }
  saveBlob(png, name + '.png');
  return o.target === 'clipboard' ? 'The browser did not allow copying images, so the picture was saved as a PNG file.' : 'Picture saved as a PNG file.';
}

function svgToPng(text: string, w: number, h: number, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
      const g = c.getContext('2d')!;
      g.scale(scale, scale);
      g.drawImage(img, 0, 0);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not draw the picture.'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not draw the picture.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  });
}

function saveBlob(b: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export type { Project };

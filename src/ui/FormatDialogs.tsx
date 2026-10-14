// Format dialogs: Font, Gridlines, Progress Lines, Layout, Timescale, Bar Styles and Format Bar.
import { useMemo, useState, type ReactElement } from 'react';
import type { BarOverride, BarPattern, BarShape, BarStyle, EndShape, Fmt, GanttLayout, GridLine, Gridlines, LineType, Tier, Timescale, TimeUnit } from '../engine/model';
import { GANTT_VIEWS as GV, stylesFor, TIER_LABELS, UNIT_NAMES, normalizeStyle } from '../engine/gantt';
import { FIELDS, fieldName } from '../engine/fields';
import { DATE_FORMAT_LABELS, DATE_FORMATS, formatUnitLabel, todayMinutes, DAYS_LONG, MONTHS_LONG } from '../engine/time';
import { F, Modal } from './Modal';
import Palette, { ColorField } from './Palette';
import { useStore, GANTT_VIEWS } from './store';
import { activeFormat, applyFormat, FONTS, SIZES, fontPx } from './actions';
import { endShape, patternDefs, SHADE } from './gantt/draw';
import Icon from './Icon';

/* ---------- Font ---------- */

export function FontDialog() {
  const st = useStore();
  const cur = activeFormat(st);
  const [f, setF] = useState<Fmt>({ ...cur });
  const set = (patch: Partial<Fmt>) => setF({ ...f, ...patch });
  const style = f.b && f.i ? 'Bold Italic' : f.b ? 'Bold' : f.i ? 'Italic' : 'Regular';
  return (
    <Modal title="Font" onOk={() => { const patch: Partial<Fmt> = { font: f.font, size: f.size, b: !!f.b, i: !!f.i, u: !!f.u, s: !!f.s, color: f.color, bg: f.bg }; applyFormat(patch); }}>
      <p className="hint">{st.colSel ? 'Applies to the whole column.' : st.selMode === 'rows' ? 'Applies to the selected rows.' : 'Applies to the selected cells.'}</p>
      <div className="font-grid">
        <F label="Font"><select className="inp" size={8} value={f.font || ''} onChange={e => set({ font: e.target.value || undefined })}><option value="">Segoe UI (default)</option>{FONTS.map(x => <option key={x} value={x} style={{ fontFamily: x }}>{x}</option>)}</select></F>
        <F label="Font style"><select className="inp" size={8} value={style} onChange={e => set({ b: e.target.value.includes('Bold'), i: e.target.value.includes('Italic') })}>{['Regular', 'Italic', 'Bold', 'Bold Italic'].map(x => <option key={x}>{x}</option>)}</select></F>
        <F label="Size"><select className="inp" size={8} value={String(f.size || 9)} onChange={e => set({ size: +e.target.value === 9 ? undefined : +e.target.value })}>{SIZES.map(x => <option key={x} value={x}>{x}</option>)}</select></F>
      </div>
      <div className="row-btns">
        <label className="chk"><input type="checkbox" checked={!!f.u} onChange={e => set({ u: e.target.checked })} />Underline</label>
        <label className="chk"><input type="checkbox" checked={!!f.s} onChange={e => set({ s: e.target.checked })} />Strikethrough</label>
      </div>
      <div className="grid2">
        <div><h4>Colour</h4><Palette value={f.color} onPick={c => set({ color: c })} /></div>
        <div><h4>Background colour</h4><Palette value={f.bg} onPick={c => set({ bg: c })} auto="No colour" /></div>
      </div>
      <div className="ts-preview" style={{ fontFamily: f.font ? '"' + f.font + '"' : undefined, fontSize: fontPx(f.size) ?? 12, fontWeight: f.b ? 700 : 400, fontStyle: f.i ? 'italic' : undefined, textDecoration: [f.u ? 'underline' : '', f.s ? 'line-through' : ''].join(' ').trim() || undefined, color: f.color, background: f.bg }}>AaBbYyZz · Design review · 12 Oct 26</div>
    </Modal>
  );
}

/* ---------- Gridlines ---------- */

const LINE_TYPES: [LineType, string][] = [['none', 'None'], ['solid', 'Solid'], ['dotted', 'Dotted'], ['dashed', 'Dashed'], ['long', 'Long dash']];
const GRID_ITEMS: [keyof Gridlines, string][] = [
  ['ganttRows', 'Gantt Rows'], ['sheetRows', 'Sheet Rows'], ['sheetCols', 'Sheet Columns'], ['major', 'Major Columns'], ['minor', 'Minor Columns'], ['topTier', 'Top Tier'], ['bottomTier', 'Bottom Tier'],
  ['current', 'Current Date'], ['status', 'Status date'], ['projStart', 'Project Start'], ['projFinish', 'Project Finish']
];

function LineSample({ g }: { g: GridLine }) {
  return <svg width="80" height="12"><line x1="2" x2="78" y1="6" y2="6" stroke={g.type === 'none' ? 'transparent' : g.color} strokeWidth="1.5" strokeDasharray={g.type === 'dotted' ? '1 3' : g.type === 'dashed' ? '4 3' : g.type === 'long' ? '9 4' : undefined} /></svg>;
}

export function GridlinesDialog() {
  const st = useStore();
  const [g, setG] = useState<Gridlines>(() => JSON.parse(JSON.stringify(st.p.gantt.gridlines)));
  const [item, setItem] = useState<keyof Gridlines>('ganttRows');
  const cur = g[item];
  const set = (patch: Partial<GridLine>) => setG({ ...g, [item]: { ...cur, ...patch } });
  return (
    <Modal title="Gridlines" wide onOk={() => st.commit({ ...st.p, gantt: { ...st.p.gantt, gridlines: g } })}>
      <div className="cols2">
        <div><h3>Line to change</h3><ul className="collist">{GRID_ITEMS.map(([k, l]) => <li key={k} className={k === item ? 'on' : ''} onClick={() => setItem(k)} style={{ cursor: 'pointer' }}><span>{l}</span><LineSample g={g[k]} /></li>)}</ul></div>
        <div>
          <h3>Normal</h3>
          <F label="Type"><select className="inp" value={cur.type} onChange={e => set({ type: e.target.value as LineType })}>{LINE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label="Colour"><ColorField value={cur.color} onPick={c => c && set({ color: c })} auto="Automatic" /></F>
          {(item === 'ganttRows' || item === 'sheetRows') && <>
            <h3>At interval</h3>
            <F label="Every N rows (0 = every row)"><input className="inp sm" type="number" min={0} max={50} value={cur.every || 0} onChange={e => set({ every: +e.target.value || undefined })} /></F>
          </>}
          <p className="hint">Current Date and Status Date lines go through the whole chart. Gantt Rows draws lines between task rows in the chart; Sheet Rows and Columns are the table's grid.</p>
        </div>
      </div>
    </Modal>
  );
}

export function ProgressLinesDialog() {
  const st = useStore();
  const [pl, setPl] = useState(() => ({ ...st.p.gantt.progress }));
  return (
    <Modal title="Progress lines" onOk={() => st.commit({ ...st.p, gantt: { ...st.p.gantt, progress: pl } })}>
      <label className="chk"><input type="checkbox" checked={pl.show} onChange={e => setPl({ ...pl, show: e.target.checked })} />Display progress line</label>
      <div className="row-btns">
        <label className="chk"><input type="radio" checked={pl.at === 'status'} onChange={() => setPl({ ...pl, at: 'status' })} />At project status date</label>
        <label className="chk"><input type="radio" checked={pl.at === 'current'} onChange={() => setPl({ ...pl, at: 'current' })} />At current date</label>
      </div>
      <F label="Line colour"><ColorField value={pl.color} onPick={c => c && setPl({ ...pl, color: c })} /></F>
      <p className="hint">The line runs down from the date and points to how far each task has progressed: left of the line for tasks behind schedule, right for tasks ahead. Set the status date in Plan › Status Date.</p>
    </Modal>
  );
}

/* ---------- Layout ---------- */

export function LayoutDialog() {
  const st = useStore();
  const [l, setL] = useState<GanttLayout>(() => ({ ...st.p.gantt.layout }));
  const set = (patch: Partial<GanttLayout>) => setL({ ...l, ...patch });
  return (
    <Modal title="Chart layout" onOk={() => st.commit({ ...st.p, gantt: { ...st.p.gantt, layout: l } })}>
      <h3>Links</h3>
      <div className="row-btns link-styles">
        {([['none', 'No links'], ['straight', 'Straight'], ['orth', 'Elbow (default)']] as const).map(([k, lbl]) => (
          <label key={k} className={'link-opt' + (l.links === k ? ' on' : '')}><input type="radio" checked={l.links === k} onChange={() => set({ links: k })} />
            <svg width="54" height="30"><rect x="2" y="3" width="20" height="7" rx="1.5" fill="#5b8fdc" /><rect x="30" y="20" width="20" height="7" rx="1.5" fill="#5b8fdc" />{k === 'straight' && <path d="M22 6.5L30 23.5" stroke="#2c5ea8" fill="none" />}{k === 'orth' && <path d="M22 6.5H36V20" stroke="#2c5ea8" fill="none" />}</svg>{lbl}</label>
        ))}
      </div>
      <h3>Bars</h3>
      <div className="grid2">
        <F label="Date format for bar text"><select className="inp" value={l.dateFormat} onChange={e => set({ dateFormat: e.target.value as GanttLayout['dateFormat'] })}><option value="project">As in Project Options</option>{DATE_FORMATS.map(k => <option key={k} value={k}>{DATE_FORMAT_LABELS[k]}</option>)}</select></F>
        <F label="Bar height (pixels)"><select className="inp" value={l.barHeight} onChange={e => set({ barHeight: +e.target.value })}>{[6, 8, 10, 12, 14, 16, 18, 20, 24].map(h => <option key={h}>{h}</option>)}</select></F>
      </div>
      <label className="chk"><input type="checkbox" checked={l.rounded} onChange={e => set({ rounded: e.target.checked })} />Rounded bar ends</label>
      <label className="chk"><input type="checkbox" checked={l.rollupAll} onChange={e => set({ rollupAll: e.target.checked })} />Always roll up Gantt bars (show subtasks on summary bars)</label>
      <label className="chk"><input type="checkbox" checked={l.roundToDays} onChange={e => set({ roundToDays: e.target.checked })} />Round bars to whole days when dragging</label>
      <label className="chk"><input type="checkbox" checked={l.showSplits} onChange={e => set({ showSplits: e.target.checked })} />Show bar splits</label>
      <label className="chk"><input type="checkbox" checked={l.showDrawings} onChange={e => set({ showDrawings: e.target.checked })} />Show drawings</label>
      <p className="hint">Single tasks can be rolled up with the Rollup field (Task details › General, or add the Rollup column).</p>
    </Modal>
  );
}

/* ---------- Timescale ---------- */

const UNITS: TimeUnit[] = ['year', 'half', 'quarter', 'month', 'third', 'week', 'day', 'hour', 'minute'];

function TierEditor({ t, onChange }: { t: Tier; onChange: (t: Tier) => void }) {
  const labels = TIER_LABELS[t.unit];
  const now = todayMinutes() + 10 * 60;
  return (
    <div className="grid2">
      <F label="Units"><select className="inp" value={t.unit} onChange={e => { const u = e.target.value as TimeUnit; onChange({ ...t, unit: u, label: TIER_LABELS[u][0] }); }}>{UNITS.map(u => <option key={u} value={u}>{UNIT_NAMES[u]}</option>)}</select></F>
      <F label="Count"><input className="inp sm" type="number" min={1} max={100} value={t.count} onChange={e => onChange({ ...t, count: Math.max(1, +e.target.value || 1) })} /></F>
      <F label="Label"><select className="inp" value={labels.includes(t.label) ? t.label : labels[0]} onChange={e => onChange({ ...t, label: e.target.value })}>{labels.map(l => <option key={l} value={l}>{formatUnitLabel(l, now)}  ({l})</option>)}</select></F>
      <F label="Align"><select className="inp" value={t.align} onChange={e => onChange({ ...t, align: e.target.value as Tier['align'] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></F>
      <label className="chk"><input type="checkbox" checked={t.ticks} onChange={e => onChange({ ...t, ticks: e.target.checked })} />Tick lines</label>
    </div>
  );
}

export function TimescaleDialog() {
  const st = useStore();
  const [ts, setTs] = useState<Timescale>(() => JSON.parse(JSON.stringify(st.p.gantt.timescale)));
  const [tab, setTab] = useState<'top' | 'middle' | 'bottom' | 'nonworking'>('middle');
  const set = (patch: Partial<Timescale>) => setTs({ ...ts, ...patch });
  return (
    <Modal title="Timescale" wide onOk={() => st.setGantt({ timescale: ts })}>
      <div className="tabs">{([['top', 'Top Tier'], ['middle', 'Middle Tier'], ['bottom', 'Bottom Tier'], ['nonworking', 'Non-working Time']] as const).map(([k, l]) => <button type="button" key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab !== 'nonworking' && <>
        {tab === 'top' && ts.tiers < 3 && <p className="hint">The top tier shows when you choose three tiers below.</p>}
        {tab === 'middle' && ts.tiers < 2 && <p className="hint">The middle tier shows when you choose two or three tiers below.</p>}
        <TierEditor t={ts[tab]} onChange={t => set({ [tab]: t } as Partial<Timescale>)} />
        <h3>Timescale options</h3>
        <div className="grid2">
          <F label="Show"><select className="inp" value={ts.tiers} onChange={e => set({ tiers: +e.target.value })}><option value={1}>One tier (Bottom)</option><option value={2}>Two tiers (Middle, Bottom)</option><option value={3}>Three tiers (Top, Middle, Bottom)</option></select></F>
          <F label="Size (%)"><input className="inp sm" type="number" min={10} max={1000} value={ts.size} onChange={e => set({ size: Math.max(10, Math.min(1000, +e.target.value || 100)) })} /></F>
          <F label="Week starts on"><select className="inp" value={ts.weekStart} onChange={e => set({ weekStart: +e.target.value })}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></F>
          <F label="Fiscal year starts in"><select className="inp" value={ts.fiscalStart} onChange={e => set({ fiscalStart: +e.target.value })}>{MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></F>
        </div>
      </>}
      {tab === 'nonworking' && <>
        <F label="Draw"><select className="inp" value={ts.shade} onChange={e => set({ shade: e.target.value as Timescale['shade'] })}><option value="behind">Behind task bars</option><option value="front">In front of task bars</option><option value="none">Do not draw</option></select></F>
        <F label="Calendar"><select className="inp" value={ts.shadeCal || ''} onChange={e => set({ shadeCal: e.target.value || null })}><option value="">Project calendar</option>{st.p.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        <F label="Colour"><ColorField value={ts.shadeColor} onPick={c => c && set({ shadeColor: c })} /></F>
      </>}
      <div className="ts-sample">
        {(ts.tiers === 3 ? [ts.top, ts.middle, ts.bottom] : ts.tiers === 2 ? [ts.middle, ts.bottom] : [ts.bottom]).map((t, i) => <div key={i} className="ts-row">{Array.from({ length: 6 }, (_, k) => <span key={k}>{formatUnitLabel(t.label, todayMinutes() + k * ({ year: 525600, half: 262800, quarter: 131400, month: 43800, third: 14400, week: 10080, day: 1440, hour: 60, minute: 1 }[t.unit]) * t.count, ts.fiscalStart)}</span>)}</div>)}
      </div>
    </Modal>
  );
}

/* ---------- Bar Styles ---------- */

export const SHAPES: [BarShape, string][] = [['full', 'Full height'], ['top', 'Top half'], ['mid', 'Thin middle'], ['bottom', 'Bottom half'], ['thin', 'Thin'], ['line', 'Line']];
export const PATTERNS: [BarPattern, string][] = [['solid', 'Solid'], ['light', 'Light'], ['hollow', 'Outline'], ['hatch', 'Hatched'], ['dots', 'Dotted']];
export const ENDS: [EndShape, string][] = [['none', 'None'], ['diamond', 'Diamond'], ['down', 'Down arrow'], ['up', 'Up arrow'], ['circle', 'Circle'], ['square', 'Square'], ['bracketL', 'Left bracket'], ['bracketR', 'Right bracket'], ['house', 'Summary end'], ['star', 'Star'], ['arrowR', 'Right arrow'], ['arrowL', 'Left arrow']];
const CONDITIONS: [string, string][] = [['normal', 'Normal'], ['milestone', 'Milestone'], ['summary', 'Summary'], ['projectSummary', 'Plan total'], ['critical', 'Critical'], ['noncritical', 'Noncritical'], ['manual', 'Pinned'], ['split', 'Split'], ['inProgress', 'In Progress'], ['finished', 'Finished'], ['notFinished', 'Not Finished'], ['inactive', 'Inactive'], ['active', 'Active'], ['marked', 'Marked'], ['late', 'Late'], ['rolledUp', 'Rolled Up'], ['groupBy', 'Group By Summary']];
const DATE_KEYS: [string, string][] = [['start', 'Start'], ['finish', 'Finish'], ['actualStart', 'Actual Start'], ['actualFinish', 'Actual Finish'], ['completeThrough', 'Complete Through'], ['baselineStart', 'Baseline Start'], ['baselineFinish', 'Baseline Finish'],
  ...Array.from({ length: 10 }, (_, k): [string, string][] => [['b' + (k + 1) + 'Start', 'Baseline' + (k + 1) + ' Start'], ['b' + (k + 1) + 'Finish', 'Baseline' + (k + 1) + ' Finish']]).flat(),
  ['earlyStart', 'Early Start'], ['earlyFinish', 'Early Finish'], ['lateStart', 'Late Start'], ['lateFinish', 'Late Finish'], ['preStart', 'Preleveled Start'], ['preFinish', 'Preleveled Finish'], ['freeSlackEnd', 'Free Slack End'], ['deadline', 'Deadline'], ['constraintDate', 'Constraint Date'], ['statusDate', 'Status date'], ['gaps', 'Split (pauses)'],
  ...Array.from({ length: 10 }, (_, k): [string, string][] => [['Start' + (k + 1), 'Start' + (k + 1)], ['Finish' + (k + 1), 'Finish' + (k + 1)], ['Date' + (k + 1), 'Date' + (k + 1)]]).flat()];

export function StyleSample({ st: s, w = 90 }: { st: Pick<BarStyle, 'shape' | 'pattern' | 'color' | 'start' | 'startColor' | 'end' | 'endColor'>; w?: number }) {
  const pat = patternDefs('ss');
  const H = 12, t = 3;
  const box: Record<BarShape, [number, number]> = { full: [t, H], top: [t, H / 2], bottom: [t + H / 2, H / 2], mid: [t + H * 0.32, H * 0.36], thin: [t + H * 0.3, H * 0.4], line: [t + H / 2 - 0.75, 1.5] };
  const [y, h] = box[s.shape];
  const fill = s.pattern === 'hollow' ? 'none' : s.pattern === 'hatch' || s.pattern === 'dots' ? pat.get(s.pattern, s.color) : s.color;
  const els: ReactElement[] = [];
  if (s.shape === 'line') els.push(<line key="l" x1={12} x2={w - 12} y1={y + h / 2} y2={y + h / 2} stroke={s.color} strokeWidth={1.6} strokeDasharray={s.pattern === 'dots' ? '2 2' : undefined} />);
  else els.push(<rect key="r" x={12} y={y} width={w - 24} height={h} rx={2} fill={fill} fillOpacity={s.pattern === 'light' ? 0.5 : undefined} stroke={s.pattern === 'hollow' ? s.color : SHADE(s.color, -0.28)} strokeWidth={0.8} />);
  const a = endShape(s.start, 12, y, h, s.startColor, true, 'a', H), b = endShape(s.end, w - 12, y, h, s.endColor, false, 'b', H);
  return <svg width={w} height={20} className="style-sample"><defs>{pat.list}</defs>{els}{a}{b}</svg>;
}

const textFields = () => [['', '(none)'], ['name', 'Name'], ['resources', 'Resource Names'], ['start', 'Start'], ['finish', 'Finish'], ['duration', 'Duration'], ['percent', '% Complete'], ['work', 'Work'], ['cost', 'Cost'], ['wbs', 'WBS'], ['totalSlack', 'Total Slack'], ['deadline', 'Deadline'], ['baselineFinish', 'Baseline Finish'], ['resourceInitials', 'Resource Initials'],
  ...FIELDS.filter(f => f.custom && /^(Text|Number|Date)\d$/.test(f.key)).map(f => [f.key, f.key])] as [string, string][];

export function BarStylesDialog() {
  const st = useStore();
  const view = GANTT_VIEWS.has(st.ui.view) ? st.ui.view : 'gantt';
  const [list, setList] = useState<BarStyle[]>(() => JSON.parse(JSON.stringify(stylesFor(st.p.gantt, view))));
  const [k, setK] = useState(0);
  const [tab, setTab] = useState<'bars' | 'text'>('bars');
  const cur = list[k];
  const upd = (patch: Partial<BarStyle>) => setList(list.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const tf = useMemo(textFields, []);
  const move = (d: number) => { const n = list.slice(); const [x] = n.splice(k, 1); const j = Math.max(0, Math.min(n.length, k + d)); n.splice(j, 0, x); setList(n); setK(j); };
  const conds = (c: string[]) => c.map(x => (x.startsWith('!') ? 'Not ' : '') + (CONDITIONS.find(q => q[0] === x.replace('!', ''))?.[1] || x)).join(', ');
  return (
    <Modal title={'Bar styles: ' + GV[view].label} xwide onOk={() => st.commit({ ...st.p, gantt: { ...st.p.gantt, styles: { ...st.p.gantt.styles, [view]: list.map(x => normalizeStyle(x as unknown as Record<string, unknown>)) } } })}
      extra={<><button type="button" className="btn" onClick={() => { const n = list.slice(); n.splice(k + 1, 0, { ...JSON.parse(JSON.stringify(cur || list[0])), name: 'New style' }); setList(n); setK(k + 1); }}><Icon name="plus" />Insert Row</button>
        <button type="button" className="btn" disabled={!cur} onClick={() => { setList(list.filter((_, i) => i !== k)); setK(Math.max(0, k - 1)); }}>Cut Row</button>
        <button type="button" className="btn" onClick={() => { setList(GV[view].styles()); setK(0); }}>Reset</button></>}>
      <div className="bs-table">
        <table className="mini">
          <thead><tr><th>Name</th><th>Appearance</th><th>Show For … Tasks</th><th>Row</th><th>From</th><th>To</th><th /></tr></thead>
          <tbody>{list.map((x, i) => (
            <tr key={i} className={(i === k ? 'on' : '') + (x.hidden ? ' off' : '')} onClick={() => setK(i)}>
              <td>{x.name}{x.toggle ? <small className="muted"> ({x.toggle} check box)</small> : null}</td><td><StyleSample st={x} /></td><td className="cond">{conds(x.show)}</td><td>{x.row}</td>
              <td>{DATE_KEYS.find(d => d[0] === x.from)?.[1] || x.from}</td><td>{DATE_KEYS.find(d => d[0] === x.to)?.[1] || x.to}</td>
              <td className="nowrap"><button type="button" className="icon-btn" onClick={e => { e.stopPropagation(); setK(i); move(-1); }}>↑</button><button type="button" className="icon-btn" onClick={e => { e.stopPropagation(); setK(i); move(1); }}>↓</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {cur && <div className="bs-edit">
        <div className="grid3">
          <F label="Name"><input className="inp" value={cur.name} onChange={e => upd({ name: e.target.value })} /></F>
          <F label="From"><select className="inp" value={cur.from} onChange={e => upd({ from: e.target.value })}>{DATE_KEYS.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select></F>
          <F label="To"><select className="inp" value={cur.to} onChange={e => upd({ to: e.target.value })}>{DATE_KEYS.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select></F>
          <F label="Row"><select className="inp" value={cur.row} onChange={e => upd({ row: +e.target.value })}>{[1, 2, 3, 4].map(r => <option key={r}>{r}</option>)}</select></F>
          <label className="chk"><input type="checkbox" checked={!cur.hidden} onChange={e => upd({ hidden: !e.target.checked })} />Show this style</label>
        </div>
        <F label="Show for tasks that are (all must apply)">
          <div className="cond-chips">{CONDITIONS.map(([c, l]) => {
            const on = cur.show.includes(c), not = cur.show.includes('!' + c);
            return <button type="button" key={c} className={'chip' + (on ? ' on' : not ? ' not' : '')} title="Click: must be; again: must not be; again: either" onClick={() => upd({ show: on ? cur.show.filter(x => x !== c).concat('!' + c) : not ? cur.show.filter(x => x !== '!' + c) : cur.show.concat(c) })}>{not ? 'Not ' : ''}{l}</button>;
          })}</div>
        </F>
        <div className="tabs">{([['bars', 'Bars'], ['text', 'Text']] as const).map(([kk, l]) => <button type="button" key={kk} className={'tab' + (tab === kk ? ' on' : '')} onClick={() => setTab(kk)}>{l}</button>)}</div>
        {tab === 'bars' && <div className="bar-parts">
          <fieldset><legend>Start</legend>
            <F label="Shape"><select className="inp" value={cur.start} onChange={e => upd({ start: e.target.value as EndShape })}>{ENDS.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select></F>
            <F label="Colour"><ColorField value={cur.startColor} onPick={c => c && upd({ startColor: c })} /></F>
          </fieldset>
          <fieldset><legend>Middle</legend>
            <F label="Shape"><select className="inp" value={cur.shape} onChange={e => upd({ shape: e.target.value as BarShape })}>{SHAPES.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select></F>
            <F label="Pattern"><select className="inp" value={cur.pattern} onChange={e => upd({ pattern: e.target.value as BarPattern })}>{PATTERNS.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select></F>
            <F label="Colour"><ColorField value={cur.color} onPick={c => c && upd({ color: c })} /></F>
          </fieldset>
          <fieldset><legend>End</legend>
            <F label="Shape"><select className="inp" value={cur.end} onChange={e => upd({ end: e.target.value as EndShape })}>{ENDS.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select></F>
            <F label="Colour"><ColorField value={cur.endColor} onPick={c => c && upd({ endColor: c })} /></F>
          </fieldset>
        </div>}
        {tab === 'text' && <div className="grid2">
          {(['left', 'right', 'top', 'bottom', 'inside'] as const).map(pos => <F key={pos} label={pos[0].toUpperCase() + pos.slice(1)}><select className="inp" value={cur.text[pos] || ''} onChange={e => upd({ text: { ...cur.text, [pos]: e.target.value || undefined } })}>{tf.map(([kk, l]) => <option key={kk} value={kk}>{kk && FIELDS.some(f => f.key === kk && f.custom) ? fieldName(kk, st.p, true) : l}</option>)}</select></F>)}
        </div>}
      </div>}
    </Modal>
  );
}

/* ---------- Format Bar (one task) ---------- */

export function FormatBarDialog({ uid }: { uid: number }) {
  const st = useStore();
  const t = st.p.tasks.find(x => x.uid === uid);
  const [o, setO] = useState<BarOverride>(() => ({ ...(t?.style?.barFmt || {}), color: t?.style?.barFmt?.color || t?.style?.bar }));
  const [tab, setTab] = useState<'bars' | 'text'>('bars');
  const tf = useMemo(textFields, []);
  if (!t) return <Modal title="Bar appearance" noOk cancelLabel="Close"><p>Select a task.</p></Modal>;
  const set = (patch: Partial<BarOverride>) => setO({ ...o, ...patch });
  const sel = new Set(st.sel.includes(uid) ? st.sel : [uid]);
  const ok = () => {
    const clean: BarOverride = {};
    (Object.keys(o) as (keyof BarOverride)[]).forEach(k => { if (o[k] !== undefined && o[k] !== '') (clean as Record<string, unknown>)[k] = o[k]; });
    st.commit({ ...st.p, tasks: st.p.tasks.map(x => {
      if (!sel.has(x.uid)) return x;
      const style = { ...(x.style || {}) };
      delete style.bar;
      if (Object.keys(clean).length) style.barFmt = clean; else delete style.barFmt;
      return { ...x, style: Object.keys(style).length ? style : undefined };
    }) });
  };
  return (
    <Modal title={'Bar appearance: ' + (sel.size > 1 ? sel.size + ' tasks' : t.name)} wide onOk={ok} extra={<button type="button" className="btn" onClick={() => setO({})}>Reset</button>}>
      <div className="tabs">{([['bars', 'Bar Shape'], ['text', 'Bar Text']] as const).map(([k, l]) => <button type="button" key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'bars' && <div className="bar-parts">
        <fieldset><legend>Start and end</legend>
          <F label="Start shape"><select className="inp" value={o.start || ''} onChange={e => set({ start: (e.target.value || undefined) as EndShape | undefined })}><option value="">(from the bar style)</option>{ENDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label="End shape"><select className="inp" value={o.end || ''} onChange={e => set({ end: (e.target.value || undefined) as EndShape | undefined })}><option value="">(from the bar style)</option>{ENDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label="Colour"><ColorField value={o.endColor} onPick={c => set({ endColor: c })} auto="From the bar style" /></F>
        </fieldset>
        <fieldset><legend>Middle</legend>
          <F label="Shape"><select className="inp" value={o.shape || ''} onChange={e => set({ shape: (e.target.value || undefined) as BarShape | undefined })}><option value="">(from the bar style)</option>{SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label="Pattern"><select className="inp" value={o.pattern || ''} onChange={e => set({ pattern: (e.target.value || undefined) as BarPattern | undefined })}><option value="">(from the bar style)</option>{PATTERNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <F label="Colour"><ColorField value={o.color} onPick={c => set({ color: c })} auto="From the bar style" /></F>
        </fieldset>
        <fieldset><legend>Sample</legend><StyleSample w={140} st={{ shape: o.shape || 'full', pattern: o.pattern || 'solid', color: o.color || '#5b8fdc', start: o.start || 'none', startColor: o.endColor || '#273142', end: o.end || 'none', endColor: o.endColor || '#273142' }} /></fieldset>
      </div>}
      {tab === 'text' && <div className="grid2">
        {(['left', 'right', 'top', 'bottom', 'inside'] as const).map(pos => <F key={pos} label={pos[0].toUpperCase() + pos.slice(1)}><select className="inp" value={o[pos] ?? '\u0000'} onChange={e => set({ [pos]: e.target.value === '\u0000' ? undefined : e.target.value })}><option value={'\u0000'}>(from the bar style)</option>{tf.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>)}
      </div>}
      <p className="hint">Format Bar changes only {sel.size > 1 ? 'these tasks' : 'this task'}. To change all bars of one kind, use Format › Bar Styles.</p>
    </Modal>
  );
}

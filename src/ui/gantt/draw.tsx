// Draws Gantt bars from bar styles (Format › Bar Styles): each style says for which tasks it
// applies, between which two dates it is drawn, its shape, pattern and colour, its end shapes and its text.
// Used by the Gantt chart on screen, by printing and by Copy Picture.
import type { ReactElement } from 'react';
import type { BarOverride, BarStyle, EndShape, GanttLayout, Project } from '../../engine/model';
import type { Row, Schedule } from '../../engine/schedule';
import { FIELD } from '../../engine/fields';
import { fmtDate, todayMinutes, type Minutes } from '../../engine/time';
import { makeColumn } from '../columns';

export interface DrawCtx {
  p: Project; s: Schedule; x: (t: Minutes) => number; layout: GanttLayout;
  toggles: Record<string, boolean>; status: Minutes; barText: { font?: string; size?: number; color?: string };
  dark?: boolean;             // dark theme: near-black bar colours are lifted so they stay visible
}

// On the dark chart, a near-black colour (summary bars, milestones) is swapped for a light slate.
const lift = (col: string | undefined): string | undefined => {
  const m = col && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(col);
  if (!m) return col;
  const h = m[1].length === 3 ? m[1].split('').map(ch => ch + ch).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.22 ? '#b9c6dc' : col;
};
const liftStyle = (st: BarStyle): BarStyle => ({ ...st, color: lift(st.color) ?? st.color, startColor: lift(st.startColor) ?? st.startColor, endColor: lift(st.endColor) ?? st.endColor });

// "Show for … tasks" conditions.
export function matches(r: Row, cond: string[], c: DrawCtx, rolled = false): boolean {
  for (const raw of cond) {
    const not = raw.startsWith('!'), k = not ? raw.slice(1) : raw;
    let v: boolean;
    const ms = !r.summary && (r.duration === 0 || r.task.milestone);
    switch (k) {
      case 'normal': v = !r.summary && !ms; break;
      case 'milestone': v = ms; break;
      case 'summary': v = r.summary && r.id > 0 && !r.group; break;
      case 'projectSummary': v = r.id === 0; break;
      case 'groupBy': v = !!r.group; break;
      case 'critical': v = r.critical; break;
      case 'noncritical': v = !r.critical; break;
      case 'manual': v = r.task.mode === 'manual'; break;
      case 'split': v = !!r.segments; break;
      case 'inProgress': v = r.percent > 0 && r.percent < 100; break;
      case 'finished': v = r.percent >= 100; break;
      case 'notFinished': v = r.percent < 100; break;
      case 'inactive': v = !r.task.active; break;
      case 'active': v = r.task.active; break;
      case 'rolledUp': v = rolled; break;
      case 'marked': v = !!r.task.marked; break;
      case 'late': v = isLate(r, c); break;
      case 'external': v = false; break;
      default: v = true;
    }
    if (v === not) return false;
  }
  return true;
}

function isLate(r: Row, c: DrawCtx): boolean {
  if (r.percent >= 100 || r.summary) return false;
  if (c.status <= r.start) return false;
  return r.completeThrough < Math.min(c.status, r.finish) - 1;
}

// The date a bar style starts or ends at.
export function barDate(r: Row, key: string, c: DrawCtx): Minutes | null {
  const bl = (k: number) => (k === 0 ? (c.p.gantt.baseline ? c.p.baselines[c.p.gantt.baseline]?.tasks[r.task.uid] : r.baseline) ?? null : c.p.baselines[k]?.tasks[r.task.uid] ?? null);
  switch (key) {
    case 'start': return r.start;
    case 'finish': return r.finish;
    case 'actualStart': return r.actualStart;
    case 'actualFinish': return r.actualFinish;
    case 'completeThrough': return r.percent > 0 ? r.completeThrough : null;
    case 'baselineStart': return bl(0)?.start ?? null;
    case 'baselineFinish': return bl(0)?.finish ?? null;
    case 'deadline': return r.task.deadline;
    case 'earlyStart': return r.es;
    case 'earlyFinish': return r.ef;
    case 'lateStart': return r.ls;
    case 'lateFinish': return r.summary ? null : r.lf;
    case 'preStart': return r.preStart;
    case 'preFinish': return r.preFinish;
    case 'constraintDate': return r.task.constraintDate;
    case 'statusDate': return c.status;
    case 'freeSlackEnd': return r.freeSlack > 0 ? c.s.calendars.get(r.task.calendar, c.p.calendar).add(r.finish, r.freeSlack) : null;
    case 'today': return todayMinutes();
  }
  const m = /^b(\d+)(Start|Finish)$/.exec(key);
  if (m) { const b = bl(+m[1]); return b ? (m[2] === 'Start' ? b.start : b.finish) : null; }
  const f = FIELD.get(key);
  if (f && f.type === 'date') { const v = f.get(r, c); return typeof v === 'number' ? v : null; }
  return null;
}

export const SHADE = (hex: string, k: number): string => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!isFinite(n)) return hex;
  const ch = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, ch(v))).toString(16).padStart(2, '0')).join('');
};

// Bands of the bar rows: row 1 is the full bar height, further rows half of it, stacked below.
export function bandOf(row: number, H: number, top: number): [number, number] {
  let t = top;
  for (let k = 1; k < row; k++) t += (k === 1 ? H : H / 2) + 1;
  return [t, row === 1 ? H : H / 2];
}
export function blockHeight(maxRow: number, H: number): number { return bandOf(maxRow, H, 0)[0] + (maxRow === 1 ? H : H / 2); }

function shapeBox(shape: BarStyle['shape'], t: number, h: number): [number, number] {
  switch (shape) {
    case 'top': return [t, h / 2];
    case 'bottom': return [t + h / 2, h / 2];
    case 'mid': return [t + h * 0.32, h * 0.36];
    case 'thin': return [t + h * 0.3, h * 0.4];
    case 'line': return [t + h / 2 - 0.75, 1.5];
    default: return [t, h];
  }
}

let patternId = 0;
export function endShape(kind: EndShape, cx: number, t: number, h: number, color: string, atStart: boolean, key: string, H: number): ReactElement | null {
  if (kind === 'none') return null;
  const mid = t + h / 2, s = Math.max(5, Math.min(9, H * 0.62));
  switch (kind) {
    case 'diamond': return <path key={key} d={`M${cx} ${mid - s}l${s} ${s}-${s} ${s}-${s}-${s}z`} fill={color} />;
    case 'down': return <path key={key} d={`M${cx - 5} ${t - 3}h10l-5 7z`} fill={color} />;
    case 'up': return <path key={key} d={`M${cx - 5} ${t + h + 3}h10l-5 -7z`} fill={color} />;
    case 'circle': return <circle key={key} cx={cx} cy={mid} r={s * 0.62} fill={color} />;
    case 'square': return <rect key={key} x={cx - s * 0.55} y={mid - s * 0.55} width={s * 1.1} height={s * 1.1} fill={color} />;
    case 'star': { const pts: string[] = []; for (let k = 0; k < 10; k++) { const a = Math.PI / 5 * k - Math.PI / 2, rr = k % 2 ? s * 0.45 : s; pts.push((cx + Math.cos(a) * rr).toFixed(1) + ',' + (mid + Math.sin(a) * rr).toFixed(1)); } return <polygon key={key} points={pts.join(' ')} fill={color} />; }
    case 'arrowR': return <path key={key} d={`M${cx - 6} ${mid - 5}l6 5-6 5z`} fill={color} />;
    case 'arrowL': return <path key={key} d={`M${cx + 6} ${mid - 5}l-6 5 6 5z`} fill={color} />;
    case 'bracketL': return <path key={key} d={`M${cx + 3} ${t - 1.5}h-3v${h + 3}h3`} fill="none" stroke={color} strokeWidth={1.8} />;
    case 'bracketR': return <path key={key} d={`M${cx - 3} ${t - 1.5}h3v${h + 3}h-3`} fill="none" stroke={color} strokeWidth={1.8} />;
    case 'house': {
      const drop = Math.max(4, H * 0.36);
      return atStart
        ? <path key={key} d={`M${cx} ${t}V${t + h + drop}L${cx + 5} ${t + h}V${t}z`} fill={color} />
        : <path key={key} d={`M${cx} ${t}V${t + h + drop}L${cx - 5} ${t + h}V${t}z`} fill={color} />;
    }
  }
  return null;
}

export interface PatternDefs { list: ReactElement[]; get: (kind: string, color: string) => string }
export function patternDefs(prefix: string): PatternDefs {
  const map = new Map<string, string>();
  const list: ReactElement[] = [];
  return {
    list,
    get(kind, color) {
      const k = kind + color;
      let id = map.get(k);
      if (!id) {
        id = prefix + 'p' + (++patternId);
        map.set(k, id);
        list.push(kind === 'hatch'
          ? <pattern key={id} id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill={SHADE(color, 0.6)} /><line x1="0" y1="0" x2="0" y2="5" stroke={color} strokeWidth="2.2" /></pattern>
          : <pattern key={id} id={id} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={SHADE(color, 0.7)} /><circle cx="2" cy="2" r="1" fill={color} /></pattern>);
      }
      return 'url(#' + id + ')';
    }
  };
}

export interface BarHit { kind: 'bar' | 'segment'; seg?: number; x1: number; x2: number; t: number; h: number }

// Text shown at one position of a bar.
function textFor(r: Row, key: string, c: DrawCtx): string {
  if (!key) return '';
  if (key === 'name') return r.task.name;
  const f = FIELD.get(key);
  if (f?.type === 'date') {
    const v = f.get(r, c);
    const fmt = c.layout.dateFormat === 'project' ? c.p.settings.dateFormat : c.layout.dateFormat;
    return typeof v === 'number' ? fmtDate(v, { weekday: false, format: fmt }) : '';
  }
  if (key === 'resources') {
    const res = new Map(c.p.resources.map(x => [x.uid, x]));
    return r.task.assignments.map(a => { const x = res.get(a.res); if (!x) return ''; return x.type === 'Work' && Math.abs(a.units - 1) > 1e-6 ? x.name + '[' + Math.round(a.units * 100) + '%]' : x.name; }).filter(Boolean).join(', ');
  }
  const col = makeColumn({ field: key }, c.p);
  return col ? col.text(r, { p: c.p, s: c.s, outlineNumber: false }) : '';
}

// Applies Format › Bar to the styles that draw the task itself.
function override(st: BarStyle, o: BarOverride | undefined, legacy: string | undefined): BarStyle {
  if (!o && !legacy) return st;
  const main = st.from === 'start' && (st.to === 'finish' || st.to === 'start') && !st.toggle;
  if (!main) return st;
  const out: BarStyle = { ...st, text: { ...st.text } };
  const color = o?.color || legacy;
  if (color) out.color = color;
  if (o?.shape) out.shape = o.shape;
  if (o?.pattern) out.pattern = o.pattern;
  if (o?.start) out.start = o.start;
  if (o?.end) out.end = o.end;
  if (o?.endColor) { out.startColor = o.endColor; out.endColor = o.endColor; }
  (['left', 'right', 'top', 'bottom', 'inside'] as const).forEach(k => { if (o && o[k] !== undefined) out.text[k] = o[k] || undefined; });
  return out;
}

// All bars of one row. `top` is the top of the block of bar rows; H the bar height.
export function drawRow(r: Row, styles: BarStyle[], c: DrawCtx, top: number, H: number, pat: PatternDefs, opts: { rolledFrom?: Row[]; keyPrefix?: string } = {}): { els: ReactElement[]; hits: BarHit[] } {
  const els: ReactElement[] = [], hits: BarHit[] = [];
  if (r.task.hideBar && !r.group) return { els, hits };
  const k0 = (opts.keyPrefix || '') + r.task.uid + '-';
  const texts: ReactElement[] = [];
  const tf = c.barText;
  const textStyle = { fontFamily: tf.font ? '"' + tf.font + '", var(--font)' : undefined, fontSize: tf.size ? tf.size * 4 / 3 : undefined, fill: tf.color };
  const one = (row: Row, st0: BarStyle, idx: number, rolled: boolean) => {
    if (st0.hidden || (st0.toggle && !c.toggles[st0.toggle])) return;
    if (!matches(row, st0.show, c, rolled)) return;
    const stO = rolled ? st0 : override(st0, row.task.style?.barFmt, row.task.style?.bar);
    const st = c.dark ? liftStyle(stO) : stO;
    const [bt, bh] = bandOf(st.row, H, top);
    const key = k0 + (rolled ? 'r' + row.task.uid + '-' : '') + idx;
    let parts: [number, number][];
    if (st.from === 'gaps') {
      if (!row.segments || !c.layout.showSplits) return;
      parts = row.segments.slice(1).map((sg, k) => [row.segments![k][1], sg[0]]);
    } else {
      const a = barDate(row, st.from, c), b = barDate(row, st.to, c);
      if (a == null || b == null || b < a) return;
      if (row.segments && c.layout.showSplits && (st.from === 'start' || st.from === 'actualStart') && (st.to === 'finish' || st.to === 'completeThrough')) {
        parts = row.segments.map(([x, y]) => [Math.max(x, a), Math.min(y, b)] as [number, number]).filter(([x, y]) => y > x || (x === y && a === b));
        if (!parts.length) return;
      } else parts = [[a, b]];
    }
    const [st1, sh] = shapeBox(st.shape, bt, bh);
    const fill = st.pattern === 'hollow' ? 'none' : st.pattern === 'hatch' || st.pattern === 'dots' ? pat.get(st.pattern, st.color) : st.color;
    const opacity = st.pattern === 'light' ? 0.5 : undefined;
    const rx = c.layout.rounded && st.shape !== 'line' ? Math.min(3, sh / 2) : 0;
    parts.forEach(([a, b], k) => {
      const x1 = c.x(a), x2 = Math.max(c.x(b), x1 + (b > a ? 1 : 0));
      if (st.shape === 'line') {
        if (x2 > x1) els.push(<line key={key + 'l' + k} x1={x1} x2={x2} y1={st1 + sh / 2} y2={st1 + sh / 2} stroke={st.color} strokeWidth={1.6} strokeDasharray={st.pattern === 'dots' ? '2 2' : undefined} />);
      } else if (x2 > x1) {
        els.push(<rect key={key + 'b' + k} x={x1} y={st1} width={x2 - x1} height={sh} rx={rx} fill={fill} fillOpacity={opacity}
          stroke={st.pattern === 'hollow' ? st.color : sh >= 6 ? SHADE(st.color, -0.28) : 'none'} strokeWidth={st.pattern === 'hollow' ? 1.2 : 0.8} strokeDasharray={st.pattern === 'hollow' && !row.task.active ? '3 2' : undefined} />);
      }
      if (!rolled && st.from === 'start' && st.to === 'finish' && st.row === 1) hits.push({ kind: row.segments ? 'segment' : 'bar', seg: k, x1, x2, t: bt, h: bh });
    });
    const xa = c.x(parts[0][0]), xb = c.x(parts[parts.length - 1][1]);
    const s1 = endShape(st.start, xa, st1, sh, st.startColor, true, key + 's', H);
    const s2 = endShape(st.end, xb, st1, sh, st.endColor, false, key + 'e', H);
    if (s1) els.push(s1);
    if (s2) els.push(s2);
    if (!rolled && (st.end === 'diamond' || st.start === 'diamond') && st.row === 1) hits.push({ kind: 'bar', x1: xa - 7, x2: xb + 7, t: bt, h: bh });
    if (rolled) return;
    const endPad = st.end !== 'none' ? 9 : 5, startPad = st.start !== 'none' ? 9 : 5;
    const ty = bt + bh / 2 + 4;
    if (st.text.right) { const v = textFor(row, st.text.right, c); if (v) texts.push(<text key={key + 'tr'} x={xb + endPad} y={ty} className="lbl" style={textStyle}>{v}</text>); }
    if (st.text.left) { const v = textFor(row, st.text.left, c); if (v) texts.push(<text key={key + 'tl'} x={xa - startPad} y={ty} className="lbl" textAnchor="end" style={textStyle}>{v}</text>); }
    if (st.text.top) { const v = textFor(row, st.text.top, c); if (v) texts.push(<text key={key + 'tt'} x={(xa + xb) / 2} y={bt - 2} className="lbl small" textAnchor="middle" style={textStyle}>{v}</text>); }
    if (st.text.bottom) { const v = textFor(row, st.text.bottom, c); if (v) texts.push(<text key={key + 'tb'} x={(xa + xb) / 2} y={bt + bh + 10} className="lbl small" textAnchor="middle" style={textStyle}>{v}</text>); }
    if (st.text.inside) { const v = textFor(row, st.text.inside, c); if (v && xb - xa > 24) texts.push(<text key={key + 'ti'} x={(xa + xb) / 2} y={ty} className="lbl inside" textAnchor="middle" style={textStyle}>{v.length * 6 > xb - xa ? v.slice(0, Math.max(1, Math.floor((xb - xa) / 6) - 1)) + '…' : v}</text>); }
  };
  styles.forEach((st, idx) => one(r, st, idx, false));
  // Subtask bars rolled up onto this summary bar.
  if (opts.rolledFrom) opts.rolledFrom.forEach(k => styles.forEach((st, idx) => { if (st.show.includes('rolledUp')) one(k, st, idx, true); }));
  return { els: els.concat(texts), hits };
}

export function maxBarRow(styles: BarStyle[], toggles: Record<string, boolean>): number {
  let m = 1;
  styles.forEach(st => { if (!st.hidden && (!st.toggle || toggles[st.toggle])) m = Math.max(m, st.row); });
  return m;
}

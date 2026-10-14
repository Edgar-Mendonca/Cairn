// Gantt chart formatting: the default bar styles of each Gantt view, the timescale presets used by zooming,
// gridlines and layout. Everything here is plain data saved with the plan, so a file opens looking the same.
import type { BarStyle, EndShape, GanttFormat, GanttLayout, GridLine, Gridlines, Tier, Timescale, TimeUnit, BarShape, BarPattern, LineType } from './model';

type S = Partial<BarStyle> & Pick<BarStyle, 'name' | 'show' | 'from' | 'to'>;
const style = (x: S): BarStyle => ({
  row: 1, shape: 'full', pattern: 'solid', color: '#4f86d9', start: 'none', startColor: '#1f2937', end: 'none', endColor: '#1f2937', text: {}, ...x
});

export const BLUE = '#5b8fdc', BLUE_D = '#2c5ea8', RED = '#e0605a', TEAL = '#4fb3a9', DARK = '#273142', GREEN = '#2f9e62', AMBER = '#e7a33e', GREY = '#9aa3ae';

// The Gantt's styles, in drawing order (later styles draw over earlier ones).
export function ganttStyles(): BarStyle[] {
  return [
    style({ name: 'Task', show: ['normal', '!manual', '!inactive'], from: 'start', to: 'finish', color: BLUE, text: { right: 'resources' } }),
    style({ name: 'Critical', show: ['normal', 'critical', '!manual', '!inactive'], from: 'start', to: 'finish', color: RED, toggle: 'critical' }),
    style({ name: 'Late', show: ['normal', 'late', '!inactive'], from: 'start', to: 'finish', color: AMBER, toggle: 'late' }),
    style({ name: 'Split', show: ['normal', 'split'], from: 'gaps', to: 'gaps', shape: 'line', pattern: 'dots', color: BLUE_D }),
    style({ name: 'Progress', show: ['normal', '!inactive'], from: 'start', to: 'completeThrough', shape: 'mid', color: '#1d3557' }),
    style({ name: 'Manual Task', show: ['normal', 'manual', '!inactive'], from: 'start', to: 'finish', color: TEAL, start: 'bracketL', startColor: '#1f7f76', end: 'bracketR', endColor: '#1f7f76', text: { right: 'resources' } }),
    style({ name: 'Milestone', show: ['milestone', '!inactive'], from: 'start', to: 'start', shape: 'line', pattern: 'hollow', color: DARK, end: 'diamond', endColor: DARK, text: { right: 'start' } }),
    style({ name: 'Summary', show: ['summary', '!manual', '!inactive'], from: 'start', to: 'finish', shape: 'top', color: DARK, start: 'house', startColor: DARK, end: 'house', endColor: DARK }),
    style({ name: 'Manual Summary', show: ['summary', 'manual', '!inactive'], from: 'start', to: 'finish', shape: 'top', color: '#5c8f8a', start: 'bracketL', startColor: '#1f7f76', end: 'bracketR', endColor: '#1f7f76' }),
    style({ name: 'Plan total', show: ['projectSummary'], from: 'start', to: 'finish', shape: 'top', color: '#7c8796', start: 'house', startColor: '#7c8796', end: 'house', endColor: '#7c8796' }),
    style({ name: 'Group By Summary', show: ['groupBy'], from: 'start', to: 'finish', shape: 'top', color: '#8a94a3', start: 'house', startColor: '#8a94a3', end: 'house', endColor: '#8a94a3' }),
    style({ name: 'Rolled Up Task', show: ['normal', 'rolledUp'], from: 'start', to: 'finish', shape: 'top', color: '#9ab9e8' }),
    style({ name: 'Rolled Up Milestone', show: ['milestone', 'rolledUp'], from: 'start', to: 'start', shape: 'line', pattern: 'hollow', end: 'diamond', endColor: DARK }),
    style({ name: 'Inactive Task', show: ['normal', 'inactive'], from: 'start', to: 'finish', pattern: 'hollow', color: GREY }),
    style({ name: 'Inactive Milestone', show: ['milestone', 'inactive'], from: 'start', to: 'start', shape: 'line', end: 'diamond', endColor: GREY, pattern: 'hollow' }),
    style({ name: 'Inactive Summary', show: ['summary', 'inactive'], from: 'start', to: 'finish', shape: 'top', pattern: 'hollow', color: GREY, start: 'house', startColor: GREY, end: 'house', endColor: GREY }),
    style({ name: 'Baseline', show: ['normal'], from: 'baselineStart', to: 'baselineFinish', row: 2, shape: 'thin', color: '#aab3be', toggle: 'baseline' }),
    style({ name: 'Baseline Milestone', show: ['milestone'], from: 'baselineStart', to: 'baselineStart', row: 2, shape: 'line', pattern: 'hollow', end: 'diamond', endColor: '#8e98a5', toggle: 'baseline' }),
    style({ name: 'Baseline Summary', show: ['summary'], from: 'baselineStart', to: 'baselineFinish', row: 2, shape: 'thin', color: '#8e98a5', toggle: 'baseline' }),
    style({ name: 'Slack', show: ['normal', '!milestone'], from: 'finish', to: 'lateFinish', shape: 'line', color: '#6f90c4', toggle: 'slack' }),
    style({ name: 'Deadline', show: ['!projectSummary', '!groupBy'], from: 'deadline', to: 'deadline', shape: 'line', pattern: 'hollow', color: GREEN, start: 'down', startColor: GREEN })
  ];
}

export function trackingStyles(): BarStyle[] {
  return [
    style({ name: 'Task', show: ['normal', '!critical', '!inactive'], from: 'start', to: 'finish', shape: 'top', color: BLUE, text: { right: 'percent' } }),
    style({ name: 'Critical', show: ['normal', 'critical', '!inactive'], from: 'start', to: 'finish', shape: 'top', color: RED, pattern: 'hatch', text: { right: 'percent' } }),
    style({ name: 'Split', show: ['normal', 'split'], from: 'gaps', to: 'gaps', shape: 'line', pattern: 'dots', color: BLUE_D }),
    style({ name: 'Progress', show: ['normal', '!inactive'], from: 'actualStart', to: 'completeThrough', shape: 'top', color: '#2a4d80' }),
    style({ name: 'Baseline', show: ['normal'], from: 'baselineStart', to: 'baselineFinish', shape: 'bottom', color: '#aab3be' }),
    style({ name: 'Milestone', show: ['milestone', '!inactive'], from: 'start', to: 'start', shape: 'line', pattern: 'hollow', end: 'diamond', endColor: DARK, text: { right: 'start' } }),
    style({ name: 'Milestone Baseline', show: ['milestone'], from: 'baselineStart', to: 'baselineStart', shape: 'line', pattern: 'hollow', end: 'diamond', endColor: '#9aa3ae', row: 2 }),
    style({ name: 'Summary', show: ['summary', '!inactive'], from: 'start', to: 'finish', shape: 'top', color: DARK, start: 'house', startColor: DARK, end: 'house', endColor: DARK, text: { right: 'percent' } }),
    style({ name: 'Summary Baseline', show: ['summary'], from: 'baselineStart', to: 'baselineFinish', row: 2, shape: 'thin', color: '#9aa3ae' }),
    style({ name: 'Plan total', show: ['projectSummary'], from: 'start', to: 'finish', shape: 'top', color: '#7c8796', start: 'house', startColor: '#7c8796', end: 'house', endColor: '#7c8796' }),
    style({ name: 'Group By Summary', show: ['groupBy'], from: 'start', to: 'finish', shape: 'top', color: '#8a94a3', start: 'house', startColor: '#8a94a3', end: 'house', endColor: '#8a94a3' }),
    style({ name: 'Inactive Task', show: ['normal', 'inactive'], from: 'start', to: 'finish', shape: 'top', pattern: 'hollow', color: GREY }),
    style({ name: 'Deadline', show: ['!projectSummary', '!groupBy'], from: 'deadline', to: 'deadline', shape: 'line', color: GREEN, start: 'down', startColor: GREEN })
  ];
}

export function detailStyles(): BarStyle[] {
  return [
    style({ name: 'Task', show: ['normal', '!critical', '!inactive'], from: 'start', to: 'finish', color: BLUE, text: { right: 'resources' } }),
    style({ name: 'Critical', show: ['normal', 'critical', '!inactive'], from: 'start', to: 'finish', color: RED, text: { right: 'resources' } }),
    style({ name: 'Split', show: ['normal', 'split'], from: 'gaps', to: 'gaps', shape: 'line', pattern: 'dots', color: BLUE_D }),
    style({ name: 'Progress', show: ['normal'], from: 'start', to: 'completeThrough', shape: 'mid', color: '#1d3557' }),
    style({ name: 'Free Slack', show: ['normal', '!summary'], from: 'finish', to: 'freeSlackEnd', shape: 'thin', color: '#76a5e3' }),
    style({ name: 'Balancing Delay', show: ['normal'], from: 'preStart', to: 'start', shape: 'line', color: '#c99a36', pattern: 'dots' }),
    style({ name: 'Milestone', show: ['milestone'], from: 'start', to: 'start', shape: 'line', end: 'diamond', endColor: DARK, text: { right: 'start' } }),
    style({ name: 'Summary', show: ['summary'], from: 'start', to: 'finish', shape: 'top', color: DARK, start: 'house', startColor: DARK, end: 'house', endColor: DARK }),
    style({ name: 'Plan total', show: ['projectSummary'], from: 'start', to: 'finish', shape: 'top', color: '#7c8796', start: 'house', startColor: '#7c8796', end: 'house', endColor: '#7c8796' }),
    style({ name: 'Group By Summary', show: ['groupBy'], from: 'start', to: 'finish', shape: 'top', color: '#8a94a3', start: 'house', startColor: '#8a94a3', end: 'house', endColor: '#8a94a3' }),
    style({ name: 'Deadline', show: ['!projectSummary', '!groupBy'], from: 'deadline', to: 'deadline', shape: 'line', color: GREEN, start: 'down', startColor: GREEN })
  ];
}

export function levelingStyles(): BarStyle[] {
  return [
    style({ name: 'Preleveled Task', show: ['normal', '!summary'], from: 'preStart', to: 'preFinish', shape: 'top', color: '#e9c46a' }),
    style({ name: 'Task', show: ['normal', '!critical'], from: 'start', to: 'finish', shape: 'bottom', color: BLUE, text: { right: 'resources' } }),
    style({ name: 'Critical', show: ['normal', 'critical'], from: 'start', to: 'finish', shape: 'bottom', color: RED, text: { right: 'resources' } }),
    style({ name: 'Split', show: ['normal', 'split'], from: 'gaps', to: 'gaps', shape: 'line', pattern: 'dots', color: BLUE_D }),
    style({ name: 'Balancing Delay', show: ['normal'], from: 'preStart', to: 'start', shape: 'line', color: '#c99a36', pattern: 'dots' }),
    style({ name: 'Slack', show: ['normal', '!milestone'], from: 'finish', to: 'lateFinish', shape: 'line', color: '#6f90c4' }),
    style({ name: 'Milestone', show: ['milestone'], from: 'start', to: 'start', shape: 'line', end: 'diamond', endColor: DARK, text: { right: 'start' } }),
    style({ name: 'Summary', show: ['summary'], from: 'start', to: 'finish', shape: 'top', color: DARK, start: 'house', startColor: DARK, end: 'house', endColor: DARK }),
    style({ name: 'Plan total', show: ['projectSummary'], from: 'start', to: 'finish', shape: 'top', color: '#7c8796', start: 'house', startColor: '#7c8796', end: 'house', endColor: '#7c8796' }),
    style({ name: 'Group By Summary', show: ['groupBy'], from: 'start', to: 'finish', shape: 'top', color: '#8a94a3', start: 'house', startColor: '#8a94a3', end: 'house', endColor: '#8a94a3' })
  ];
}

export function multiBaselineStyles(): BarStyle[] {
  return [
    style({ name: 'Baseline', show: ['normal'], from: 'baselineStart', to: 'baselineFinish', shape: 'top', color: '#5b8fdc' }),
    style({ name: 'Baseline1', show: ['normal'], from: 'b1Start', to: 'b1Finish', shape: 'mid', color: '#e7a33e' }),
    style({ name: 'Baseline2', show: ['normal'], from: 'b2Start', to: 'b2Finish', shape: 'bottom', color: '#4fb3a9' }),
    style({ name: 'Baseline Milestone', show: ['milestone'], from: 'baselineStart', to: 'baselineStart', shape: 'line', end: 'diamond', endColor: '#5b8fdc' }),
    style({ name: 'Baseline1 Milestone', show: ['milestone'], from: 'b1Start', to: 'b1Start', shape: 'line', end: 'diamond', endColor: '#e7a33e' }),
    style({ name: 'Baseline2 Milestone', show: ['milestone'], from: 'b2Start', to: 'b2Start', shape: 'line', end: 'diamond', endColor: '#4fb3a9' }),
    style({ name: 'Baseline Summary', show: ['summary'], from: 'baselineStart', to: 'baselineFinish', shape: 'top', color: DARK, start: 'house', startColor: DARK, end: 'house', endColor: DARK }),
    style({ name: 'Baseline1 Summary', show: ['summary'], from: 'b1Start', to: 'b1Finish', shape: 'mid', color: '#b07a20' }),
    style({ name: 'Baseline2 Summary', show: ['summary'], from: 'b2Start', to: 'b2Finish', shape: 'bottom', color: '#2f7f77' })
  ];
}

export const GANTT_VIEWS: Record<string, { label: string; styles: () => BarStyle[] }> = {
  gantt: { label: 'Gantt', styles: ganttStyles },
  tracking: { label: 'Progress view', styles: trackingStyles },
  detail: { label: 'Detail Gantt', styles: detailStyles },
  leveling: { label: 'Balancing delays', styles: levelingStyles },
  multiBaseline: { label: 'Multiple Baselines Gantt', styles: multiBaselineStyles }
};

/* ---------- timescale ---------- */

const tier = (unit: TimeUnit, label: string, count = 1, align: Tier['align'] = 'left'): Tier => ({ unit, count, label, align, ticks: true });

// Label formats offered for each unit. Tokens: yyyy yy MMMM MMM M1 (first letter) MM M d dd ddd dddd d1 Q H W h hh am T (third).
export const TIER_LABELS: Record<TimeUnit, string[]> = {
  year: ['yyyy', "'yy", 'FY yyyy'],
  half: ['H1 yyyy', 'H1', '1st Half yyyy'],
  quarter: ['Qn yyyy', 'Qn', "Qn 'yy", 'Quarter n, yyyy'],
  month: ['MMMM yyyy', "MMM 'yy", 'MMM yyyy', 'MMMM', 'MMM', 'M1', 'MM/yy'],
  third: ['MMM T', 'T', 'MMM d'],
  week: ["MMM d, 'yy", 'd MMM yy', 'MMM d', 'd MMM', 'Week W', 'W', 'ddd d MMM'],
  day: ['ddd d', 'ddd', 'd1', 'd', 'dddd d MMMM', "ddd MMM d, 'yy", 'd MMM'],
  hour: ['h am', 'HH:mm', 'h'],
  minute: ['HH:mm', 'mm']
};
export const UNIT_NAMES: Record<TimeUnit, string> = { year: 'Years', half: 'Half Years', quarter: 'Quarters', month: 'Months', third: 'Thirds of Months', week: 'Weeks', day: 'Days', hour: 'Hours', minute: 'Minutes' };

// Zoom levels: pixels per day and the tiers shown at that scale.
export const ZOOM_PRESETS: { name: string; px: number; tiers: number; top: Tier; middle: Tier; bottom: Tier }[] = [
  { name: 'Hours', px: 360, tiers: 2, top: tier('day', 'ddd d MMM'), middle: tier('day', 'ddd d MMM'), bottom: tier('hour', 'h am', 3, 'center') },
  { name: 'Days', px: 64, tiers: 2, top: tier('week', "MMM d, 'yy"), middle: tier('week', "MMM d, 'yy"), bottom: tier('day', 'ddd d', 1, 'center') },
  { name: 'Weeks', px: 24, tiers: 2, top: tier('week', "MMM d, 'yy"), middle: tier('week', "MMM d, 'yy"), bottom: tier('day', 'd1', 1, 'center') },
  { name: 'Thirds of Months', px: 12, tiers: 2, top: tier('month', 'MMMM yyyy'), middle: tier('month', 'MMMM yyyy'), bottom: tier('week', 'd', 1, 'center') },
  { name: 'Months', px: 6, tiers: 2, top: tier('month', "MMM 'yy"), middle: tier('month', "MMM 'yy"), bottom: tier('week', 'd', 1, 'center') },
  { name: 'Quarters', px: 2.2, tiers: 2, top: tier('quarter', 'Qn yyyy'), middle: tier('quarter', 'Qn yyyy'), bottom: tier('month', 'MMM', 1, 'center') },
  { name: 'Half Years', px: 1.1, tiers: 2, top: tier('year', 'yyyy'), middle: tier('year', 'yyyy'), bottom: tier('quarter', 'Qn', 1, 'center') },
  { name: 'Years', px: 0.45, tiers: 2, top: tier('year', 'yyyy'), middle: tier('year', 'yyyy'), bottom: tier('half', 'H1', 1, 'center') }
];

export function presetTimescale(i: number, base?: Timescale): Timescale {
  const z = ZOOM_PRESETS[Math.max(0, Math.min(ZOOM_PRESETS.length - 1, i))];
  return { ...(base || defaultTimescale()), tiers: z.tiers, top: { ...z.top }, middle: { ...z.middle }, bottom: { ...z.bottom }, px: z.px, size: 100 };
}

// The zoom slider: any scale between the presets, with the tiers of the nearest preset.
export function timescaleForPx(px: number, base?: Timescale): Timescale {
  let best = 0;
  ZOOM_PRESETS.forEach((z, i) => { if (Math.abs(Math.log(z.px / px)) < Math.abs(Math.log(ZOOM_PRESETS[best].px / px))) best = i; });
  return { ...presetTimescale(best, base), px };
}

export function defaultTimescale(): Timescale {
  const z = ZOOM_PRESETS[2];
  return { tiers: 2, top: { ...z.top }, middle: { ...z.middle }, bottom: { ...z.bottom }, size: 100, px: z.px, shade: 'behind', shadeColor: '#eef1f5', shadeCal: null, fiscalStart: 1, weekStart: 0 };
}

const line = (type: LineType, color: string, extra: Partial<GridLine> = {}): GridLine => ({ type, color, ...extra });
export function defaultGridlines(): Gridlines {
  return {
    ganttRows: line('none', '#e5e8ec'), sheetRows: line('solid', '#e9ecf0'), sheetCols: line('solid', '#e9ecf0'),
    major: line('none', '#dfe3e8'), minor: line('none', '#eef0f3'), current: line('dashed', '#e7a33e'), status: line('dotted', '#7a4cc2'),
    projStart: line('none', '#2f9e62'), projFinish: line('none', '#2f9e62'), topTier: line('solid', '#d6dbe1'), bottomTier: line('solid', '#e1e5ea')
  };
}

export const DEFAULT_LAYOUT: GanttLayout = { links: 'orth', dateFormat: 'project', barHeight: 12, rounded: true, rollupAll: false, showSplits: true, showDrawings: true, roundToDays: true };

export function defaultGantt(): GanttFormat {
  return { styles: {}, layout: { ...DEFAULT_LAYOUT }, timescale: defaultTimescale(), gridlines: defaultGridlines(), progress: { show: false, at: 'status', color: '#d64545' }, drawings: [], baseline: 0 };
}

export function stylesFor(g: GanttFormat, view: string): BarStyle[] {
  return g.styles[view] ?? (GANTT_VIEWS[view] || GANTT_VIEWS.gantt).styles();
}

/* ---------- reading saved formatting ---------- */

const isObj = (o: unknown): o is Record<string, any> => o != null && typeof o === 'object' && !Array.isArray(o);
const COLOR = /^#[0-9a-f]{3,8}$/i;
const col = (v: unknown, d: string) => (typeof v === 'string' && COLOR.test(v) ? v : d);
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const SHAPES: BarShape[] = ['full', 'top', 'mid', 'bottom', 'thin', 'line'];
const PATTERNS: BarPattern[] = ['solid', 'light', 'hollow', 'hatch', 'dots'];
const ENDS: EndShape[] = ['none', 'diamond', 'down', 'up', 'circle', 'square', 'bracketL', 'bracketR', 'house', 'star', 'arrowR', 'arrowL'];
const UNITS: TimeUnit[] = ['year', 'half', 'quarter', 'month', 'third', 'week', 'day', 'hour', 'minute'];
const LINES: LineType[] = ['none', 'solid', 'dotted', 'dashed', 'long'];
const str = (v: unknown) => (v == null ? '' : String(v));

export function normalizeStyle(x: Record<string, any>): BarStyle {
  const t = isObj(x.text) ? x.text : {};
  const text: BarStyle['text'] = {};
  (['left', 'right', 'top', 'bottom', 'inside'] as const).forEach(k => { if (t[k]) text[k] = str(t[k]); });
  return {
    name: str(x.name).slice(0, 80) || 'Style', show: Array.isArray(x.show) ? x.show.map(str).filter(Boolean) : ['normal'],
    from: str(x.from) || 'start', to: str(x.to) || 'finish', row: Math.max(1, Math.min(4, Math.round(Number(x.row) || 1))),
    shape: pick(x.shape, SHAPES, 'full'), pattern: pick(x.pattern, PATTERNS, 'solid'), color: col(x.color, BLUE),
    start: pick(x.start, ENDS, 'none'), startColor: col(x.startColor, DARK), end: pick(x.end, ENDS, 'none'), endColor: col(x.endColor, DARK),
    text, toggle: x.toggle ? str(x.toggle) : undefined, hidden: !!x.hidden
  };
}

function normTier(x: unknown, d: Tier): Tier {
  if (!isObj(x)) return { ...d };
  return { unit: pick(x.unit, UNITS, d.unit), count: Math.max(1, Math.min(100, Math.round(Number(x.count) || 1))), label: str(x.label) || d.label, align: pick(x.align, ['left', 'center', 'right'] as const, d.align), ticks: x.ticks !== false };
}
function normLine(x: unknown, d: GridLine): GridLine {
  if (!isObj(x)) return { ...d };
  const out: GridLine = { type: pick(x.type, LINES, d.type), color: col(x.color, d.color) };
  if (Number(x.every) > 0) out.every = Math.min(50, Math.round(Number(x.every)));
  if (x.altType) out.altType = pick(x.altType, LINES, 'none');
  if (x.altColor) out.altColor = col(x.altColor, d.color);
  return out;
}

export function normalizeGantt(raw: unknown): GanttFormat {
  const g = defaultGantt();
  if (!isObj(raw)) return g;
  if (isObj(raw.styles)) Object.entries(raw.styles).forEach(([k, list]) => { if (Array.isArray(list)) g.styles[k] = list.filter(isObj).map(normalizeStyle); });
  if (isObj(raw.layout)) {
    const l = raw.layout;
    g.layout = {
      links: pick(l.links, ['orth', 'straight', 'none'] as const, 'orth'), dateFormat: pick(l.dateFormat, ['project', 'dmy', 'mdy', 'ndmy', 'nmdy', 'iso'] as const, 'project'),
      barHeight: Math.max(6, Math.min(24, Math.round(Number(l.barHeight) || 12))), rounded: l.rounded !== false, rollupAll: !!l.rollupAll,
      showSplits: l.showSplits !== false, showDrawings: l.showDrawings !== false, roundToDays: l.roundToDays !== false
    };
  }
  if (isObj(raw.timescale)) {
    const t = raw.timescale, d = g.timescale;
    g.timescale = {
      tiers: Math.max(1, Math.min(3, Math.round(Number(t.tiers) || 2))), top: normTier(t.top, d.top), middle: normTier(t.middle, d.middle), bottom: normTier(t.bottom, d.bottom),
      size: Math.max(10, Math.min(1000, Number(t.size) || 100)), px: Math.max(0.05, Math.min(5000, Number(t.px) || d.px)),
      shade: pick(t.shade, ['behind', 'front', 'none'] as const, 'behind'), shadeColor: col(t.shadeColor, d.shadeColor), shadeCal: t.shadeCal ? str(t.shadeCal) : null,
      fiscalStart: Math.max(1, Math.min(12, Math.round(Number(t.fiscalStart) || 1))), weekStart: Math.max(0, Math.min(6, Math.round(Number(t.weekStart) || 0)))
    };
  }
  if (isObj(raw.gridlines)) {
    const d = g.gridlines as unknown as Record<string, GridLine>;
    Object.keys(d).forEach(k => { d[k] = normLine((raw.gridlines as Record<string, unknown>)[k], d[k]); });
  }
  if (isObj(raw.progress)) g.progress = { show: !!raw.progress.show, at: raw.progress.at === 'current' ? 'current' : 'status', color: col(raw.progress.color, '#d64545') };
  if (Array.isArray(raw.drawings)) {
    g.drawings = raw.drawings.filter(isObj).map((x, i) => ({
      id: Math.round(Number(x.id)) || i + 1, kind: pick(x.kind, ['text', 'rect', 'oval', 'line', 'arrow'] as const, 'text'), at: Number(x.at) || 0, row: Math.max(0, Math.round(Number(x.row) || 0)),
      dx: Number(x.dx) || 0, dy: Number(x.dy) || 0, w: Math.max(4, Number(x.w) || 120), h: Math.max(4, Number(x.h) || 28), text: str(x.text), color: col(x.color, '#1f2937'), fill: col(x.fill, '#fff7d6'),
      uid: x.uid != null ? Math.round(Number(x.uid)) : undefined
    }));
  }
  g.baseline = Math.max(0, Math.min(10, Math.round(Number(raw.baseline) || 0)));
  return g;
}

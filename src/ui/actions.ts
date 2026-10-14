// Commands used by the ribbon, keyboard shortcuts and menus.
import { autolinkInserted, deleteTasks, editCell, indent, insertTasks, linkTasks, markOnTrack, moveBlock, moveTasks, setMode, setPercent, unlinkTasks, updateTask, type Field } from '../engine/ops';
import { presetTimescale, timescaleForPx, ZOOM_PRESETS } from '../engine/gantt';
import { fromProjectXml, looksLikeProjectXml, toProjectXml, type ImportReport } from '../engine/projectxml';
import { fromXer, looksLikeXer, toXer } from '../engine/xer';
import { fromMpx, looksLikeMpx } from '../engine/mpx';
import { toIcs } from '../engine/ics';
import { parseCsv } from '../engine/tabular';
import { schedule, type Row } from '../engine/schedule';
import { S, parseProjectText, tableColumns, useStore, type FilterName, type SortSpec, type Store, type TableName } from './store';
import { FILTER_BY_ID, GROUP_BY_ID, promptsOf, testFilter } from '../engine/filters';
import { editText, makeColumn, type Ctx } from './columns';
import type { ColSpec, Fmt, GroupDef, Project, TaskStyle } from '../engine/model';
import { readXlsx, toXlsx } from './xlsx';
import { buckets, phasedResource, phasedTask } from '../engine/timephase';
import { fmtDate, todayMinutes } from '../engine/time';

/* ---------- which rows the task table shows ---------- */

// The filter in effect: a built-in filter, or one of the plan's own (with answers to its questions).
export function activeFilter(st: Store): { test: (r: Row) => boolean; summaries: boolean; name: string; noParents?: boolean } | null {
  const id = st.ui.filter;
  if (!id || id === 'all') return null;
  const ctx = { p: st.p, s: st.s };
  const args = st.ui.filterArgs;
  const b = FILTER_BY_ID.get(id);
  if (b) return { test: r => b.test(r, ctx, args), summaries: !!b.summaries, name: b.name, noParents: b.noParents };
  const f = st.p.filters.find(x => x.id === id);
  if (!f) return null;
  const prompts = promptsOf(f);
  const map = new Map(prompts.map((q, k) => [q, args[k] ?? '']));
  return { test: r => testFilter(r, ctx, f, map), summaries: f.criteria.some(c => c.field === 'summary'), name: f.name };
}

export function matchesFilter(r: Row, f: FilterName, st: Store): boolean {
  const flt = activeFilter({ ...st, ui: { ...st.ui, filter: f } });
  return !flt || flt.test(r);
}

const sortKeys = (st: Store): SortSpec[] => (st.ui.sorts.length ? st.ui.sorts : st.ui.sort ? [st.ui.sort] : []);

// Rows in display order after collapsing, outline level, filter, AutoFilter, sort and grouping.
// Summary tasks of matching rows stay visible, and sorting keeps tasks under their phase (the usual
// "Keep outline structure"). With a highlight filter all rows show and matching ones are highlighted.
let visCache: { key: unknown[]; rows: Row[] } | null = null;
export function visibleRows(st: Store): Row[] {
  const key = [st.s, st.p, st.ui.filter, st.ui.filterArgs, st.ui.highlight, st.ui.group, st.ui.sort, st.ui.sorts, st.ui.autoFilter, st.ui.collapsed, st.ui.outlineLevel, st.ui.projectSummary, st.ui.outlineNumber];
  if (visCache && visCache.key.length === key.length && visCache.key.every((k, i) => k === key[i])) return visCache.rows;
  const rows = computeVisible(st);
  visCache = { key, rows };
  return rows;
}

function computeVisible(st: Store): Row[] {
  const { rows } = st.s, ui = st.ui;
  const ctx = ctxOf(st);
  const auto = Object.entries(ui.autoFilter).map(([k, vals]) => ({ col: makeColumn({ field: k }, st.p), allowed: new Set(vals) })).filter(f => f.col);
  const flt = ui.highlight ? null : activeFilter(st);
  const filtering = !!flt || auto.length > 0;
  const keep = new Array(rows.length).fill(!filtering);
  if (filtering) {
    rows.forEach(r => {
      if (r.summary && !flt?.summaries) return;
      if (flt && !flt.test(r)) return;
      if (auto.some(f => !f.allowed.has(f.col!.text(r, ctx)))) return;
      keep[r.i] = true;
      if (!flt?.noParents) for (let q = r.parent; q >= 0; q = rows[q].parent) keep[q] = true;
    });
  }
  const group = ui.group ? GROUP_BY_ID.get(ui.group) || st.p.groups.find(g => g.id === ui.group) : undefined;
  if (group) return groupedRows(st, rows.filter(r => keep[r.i] && (group.summaries || !r.summary)), group);
  // Display order: outline order, or siblings sorted by fields.
  const keys = sortKeys(st);
  let order: Row[];
  if (keys.length) {
    const cmp = sorter(st, keys);
    order = [];
    if (ui.sortOutline === false) order = rows.slice().sort(cmp);
    else {
      const walk = (list: Row[]) => list.sort(cmp).forEach(r => { order.push(r); if (r.summary) walk(r.children.map(i => rows[i])); });
      walk(rows.filter(r => r.parent === -1));
    }
  } else order = rows;
  const out: Row[] = [];
  if (ui.projectSummary) out.push(projectSummaryRow(st));
  const hidden = new Set<number>();
  const flat = (keys.length > 0 && ui.sortOutline === false) || !!flt?.noParents;
  for (const r of order) {
    if (!keep[r.i] || (!flat && r.parent >= 0 && hidden.has(r.parent))) { if (r.summary) hidden.add(r.i); continue; }
    if (ui.outlineLevel && r.task.level > ui.outlineLevel) { hidden.add(r.i); continue; }
    out.push(r);
    if (r.summary && (ui.collapsed[r.task.uid] || (ui.outlineLevel && r.task.level >= ui.outlineLevel))) hidden.add(r.i);
  }
  return out;
}

function sorter(st: Store, keys: SortSpec[]) {
  const ctx = ctxOf(st);
  const cols = keys.map(k => ({ col: makeColumn({ field: k.field }, st.p), dir: k.desc ? -1 : 1, cache: new Map<number, unknown>() }));
  return (a: Row, b: Row) => {
    for (const k of cols) {
      const get = (r: Row) => { if (!k.cache.has(r.i)) k.cache.set(r.i, k.col ? k.col.raw(r, ctx) : 0); return k.cache.get(r.i); };
      const x = get(a), y = get(b);
      if (x == null && y == null) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) : Number(x) - Number(y);
      if (c) return c * k.dir;
    }
    return a.id - b.id;
  };
}

// Highlighted rows (View › Filter › Highlight).
let hlCache: { s: unknown; f: unknown; a: unknown; set: Set<number> } | null = null;
export function highlighted(st: Store): Set<number> | null {
  if (!st.ui.highlight) return null;
  if (hlCache && hlCache.s === st.s && hlCache.f === st.ui.filter && hlCache.a === st.ui.filterArgs) return hlCache.set;
  const flt = activeFilter({ ...st, ui: { ...st.ui, highlight: false } });
  const set = new Set<number>();
  if (flt) st.s.rows.forEach(r => { if (flt.test(r)) set.add(r.task.uid); });
  hlCache = { s: st.s, f: st.ui.filter, a: st.ui.filterArgs, set };
  return set;
}

/* ---------- groups (View › Group By) ---------- */

export const GROUP_COLORS = ['#fde9b5', '#dbe9fb', '#e3f2df', '#f6dfe9', '#ece4fb'];

function groupedRows(st: Store, list: Row[], g: GroupDef): Row[] {
  const ctx = ctxOf(st);
  const out: Row[] = [];
  let n = 0;
  const level = (rows: Row[], k: number, path: string) => {
    if (k >= g.keys.length) { rows.forEach(r => out.push(r)); return; }
    const key = g.keys[k];
    const col = makeColumn({ field: key.field }, st.p);
    if (!col) { rows.forEach(r => out.push(r)); return; }
    const buckets = new Map<string, { raw: unknown; rows: Row[] }>();
    rows.forEach(r => {
      const text = col.text(r, ctx) || 'No ' + col.label;
      const b = buckets.get(text);
      if (b) b.rows.push(r); else buckets.set(text, { raw: col.raw(r, ctx), rows: [r] });
    });
    const entries = [...buckets.entries()].sort((a, b) => {
      const x = a[1].raw, y = b[1].raw;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : typeof x === 'boolean' && typeof y === 'boolean' ? Number(x) - Number(y) : a[0].localeCompare(b[0], undefined, { numeric: true });
      return key.desc ? -c : c;
    });
    entries.forEach(([label, b]) => {
      out.push(groupRow(st, col.label + ': ' + label, k, path + '|' + label, b.rows, --n));
      level(b.rows, k + 1, path + '|' + label);
    });
  };
  level(list, 0, '');
  return out;
}

function groupRow(st: Store, label: string, lv: number, key: string, rows: Row[], uid: number): Row {
  const { s } = st;
  const leaves = rows.filter(r => !r.summary);
  const use = leaves.length ? leaves : rows;
  let start = Infinity, finish = -Infinity, work = 0, cost = 0, ac = 0, aw = 0, d = 0, done = 0;
  use.forEach(r => { start = Math.min(start, r.start); finish = Math.max(finish, r.finish); work += r.work; cost += r.cost; ac += r.actualCost; aw += r.actualWork; d += r.duration; done += r.duration * r.percent / 100; });
  if (start === Infinity) start = finish = s.start;
  const t = { ...(rows[0]?.task || st.p.tasks[0]), uid, name: label, level: 1, notes: '', preds: [], assignments: [], mode: 'auto' as const, active: true, estimated: false, milestone: false, constraint: 'ASAP' as const, constraintDate: null, deadline: null, fixedCost: 0, custom: {}, style: undefined, levelDelay: 0, calendar: null, splits: undefined, hyperlink: undefined };
  const dur = s.calendar.workBetween(start, finish);
  return {
    task: t, i: -100000 + uid, id: -1, wbs: '', outline: '', summary: true, parent: -1, children: [], start, finish, duration: dur, es: start, ef: finish, ls: start, lf: finish,
    totalSlack: 0, freeSlack: 0, critical: false, work, cost, actualCost: ac, actualWork: aw, percent: d ? Math.round(done / d * 100) : 0, actualStart: null, actualFinish: null,
    remaining: dur, indicators: [], conflict: '', baseline: null, segments: null, completeThrough: start, preStart: start, preFinish: finish, group: { label, level: lv, key }
  };
}

// plan total row (ID 0): the whole plan as one row.
let psCache: { s: unknown; row: Row } | null = null;
export function projectSummaryRow(st: Store): Row {
  if (psCache && psCache.s === st.s) return psCache.row;
  const { s, p } = st;
  const first = s.rows[0];
  const top = s.rows.filter(r => r.parent === -1);
  const row: Row = {
    ...(first || ({} as Row)), task: { ...(first?.task || ({} as Row['task'])), uid: 0, name: p.name, level: 0, notes: p.notes, preds: [], assignments: [], mode: 'auto', active: true, estimated: false, milestone: false, constraint: 'ASAP', constraintDate: null, deadline: null, fixedCost: 0, custom: {}, style: undefined, levelDelay: 0, calendar: null },
    i: -1, id: 0, wbs: '0', outline: '0', summary: true, parent: -1, children: top.map(r => r.i), start: s.start, finish: s.finish, duration: s.duration, es: s.start, ef: s.finish, ls: s.start, lf: s.finish,
    totalSlack: Math.min(0, ...top.map(r => r.totalSlack)), freeSlack: 0, critical: false, work: s.work, cost: s.cost, actualCost: s.actualCost, actualWork: top.reduce((a, r) => a + r.actualWork, 0),
    percent: s.percent, actualStart: top.reduce<number | null>((a, r) => (r.actualStart == null ? a : a == null ? r.actualStart : Math.min(a, r.actualStart)), null), actualFinish: null,
    remaining: s.duration * (1 - s.percent / 100), indicators: [], conflict: '', baseline: null,
    segments: null, completeThrough: s.start, preStart: s.start, preFinish: s.finish
  };
  psCache = { s, row };
  return row;
}

/* ---------- columns of the current table (saved with the plan) ---------- */

export function currentColumns(st: Store = S()): ColSpec[] { return tableColumns(st.p, st.ui.table); }

export function setColumns(cols: ColSpec[], table: TableName = S().ui.table) {
  const st = S();
  st.commit({ ...st.p, tables: { ...st.p.tables, [table]: cols } });
}
export function insertColumn(field: string, before?: string) {
  const cols = currentColumns().slice();
  const at = before ? cols.findIndex(c => c.field === before) : -1;
  cols.splice(at < 0 ? cols.length : at, 0, { field });
  setColumns(cols);
  S().set({ colSel: field });
}
export function hideColumn(field: string) {
  const cols = currentColumns().filter(c => c.field !== field);
  if (!cols.length) { S().notify('A table needs at least one column.'); return; }
  setColumns(cols);
  S().set({ colSel: null });
}
export function updateColumn(field: string, patch: Partial<ColSpec>) {
  setColumns(currentColumns().map(c => {
    if (c.field !== field) return c;
    const next: ColSpec = { ...c, ...patch };
    (Object.keys(next) as (keyof ColSpec)[]).forEach(k => { if (next[k] === undefined || next[k] === '') delete next[k]; });
    return next;
  }));
}
export function moveColumn(field: string, before: string | null) {
  const cols = currentColumns().slice();
  const from = cols.findIndex(c => c.field === field);
  if (from < 0) return;
  const [c] = cols.splice(from, 1);
  const to = before ? cols.findIndex(x => x.field === before) : cols.length;
  cols.splice(to < 0 ? cols.length : to, 0, c);
  setColumns(cols);
}

// Width that fits the title and the longest value in the column (Field Settings › Best Fit).
export function bestFitWidth(field: string): number {
  const st = S(), col = makeColumn({ field }, st.p);
  if (!col) return 100;
  const ctx = ctxOf(st);
  let w = textPx(col.label, true) + 28;
  for (const r of st.s.rows.slice(0, 2000)) w = Math.max(w, textPx(col.text(r, ctx), r.summary) + 18 + (field === 'name' ? 16 + (r.task.level - 1) * 14 : 0));
  return Math.min(600, Math.ceil(w));
}
let measure: CanvasRenderingContext2D | null = null;
function textPx(t: string, bold: boolean) {
  if (!measure) measure = document.createElement('canvas').getContext('2d');
  if (!measure) return t.length * 7;
  measure.font = (bold ? '600 ' : '') + '12px "Segoe UI", system-ui, sans-serif';
  return measure.measureText(t).width;
}

/* ---------- text formatting (Task › Font, Format › Text Styles) ---------- */

export const STYLE_ITEMS: [string, string][] = [
  ['all', 'All'], ['noncritical', 'Noncritical Tasks'], ['critical', 'Critical Tasks'], ['milestone', 'Milestone Tasks'], ['summary', 'Phases'], ['projectSummary', 'plan total row'],
  ['marked', 'Marked Tasks'], ['highlighted', 'Highlighted Tasks'], ['inactive', 'Inactive Tasks'], ['manual', 'Pinned Tasks'], ['changed', 'Changed Cells'],
  ['titles', 'Row and Column Titles'], ['barText', 'Gantt Bar Text'], ['tiers', 'Timescale Tiers'], ['groupHeads', 'Group Headings']
];

export const FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Aptos', 'Cambria', 'Candara', 'Consolas', 'Courier New', 'Georgia', 'Helvetica', 'Inter', 'Roboto', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28];
export const BASE_SIZE = 12;
// A font that is not installed falls back to the closest generic family rather than to the UI font.
const SERIF = /georgia|cambria|times|garamond|book antiqua|palatino|constantia/i, MONO = /consolas|courier|mono/i;
export const fontStack = (f?: string) => (f ? '"' + f + '", ' + (SERIF.test(f) ? 'Georgia, "Times New Roman", serif' : MONO.test(f) ? 'Consolas, "Courier New", monospace' : 'var(--font)') : undefined);
// Font size in px for a format (sizes are points; the table uses 12 px for the default 9 pt).
export const fontPx = (size?: number) => (size ? Math.round(size * 4 / 3 * 10) / 10 : undefined);

export function cellFormat(r: Row, col: string, p: Project, extra?: { changed?: boolean; highlighted?: boolean }): Fmt {
  const ts = p.textStyles;
  if (r.group) return { b: true, ...(ts.groupHeads || {}) };
  const out: Fmt = { ...(ts.all || {}) };
  if (!r.summary && !r.critical) Object.assign(out, ts.noncritical);
  if (r.task.mode === 'manual' && !r.summary) Object.assign(out, ts.manual);
  if (r.summary) Object.assign(out, r.id === 0 ? { ...ts.summary, ...ts.projectSummary } : ts.summary);
  if (!r.summary && r.duration === 0) Object.assign(out, ts.milestone);
  if (r.critical && !r.summary) Object.assign(out, ts.critical);
  if (r.task.marked) Object.assign(out, ts.marked);
  if (extra?.highlighted) Object.assign(out, { bg: '#fff3b0', ...ts.highlighted });
  if (!r.task.active) Object.assign(out, ts.inactive);
  if (r.task.style?.row) Object.assign(out, r.task.style.row);
  if (r.task.style?.cells?.[col]) Object.assign(out, r.task.style.cells[col]);
  if (extra?.changed) Object.assign(out, { bg: '#d6ecff', ...ts.changed });
  return out;
}

// Largest font size used on a row (rows grow taller for larger fonts).
export function rowFontPx(r: Row, p: Project, cols: string[]): number {
  let size = p.textStyles.all?.size;
  const ts = p.textStyles;
  if (r.summary && ts.summary?.size) size = ts.summary.size;
  if (r.critical && !r.summary && ts.critical?.size) size = ts.critical.size;
  if (!r.summary && r.duration === 0 && ts.milestone?.size) size = ts.milestone.size;
  const st = r.task.style;
  if (st?.row?.size) size = st.row.size;
  let px = fontPx(size) ?? BASE_SIZE;
  if (st?.cells) cols.forEach(c => { const z = st.cells![c]?.size; if (z) px = Math.max(px, fontPx(z)!); });
  return px;
}

// The formatting of the active cell (or row), for the state of the Font buttons.
export function activeFormat(st: Store): Fmt {
  if (st.colSel) {
    const t0 = st.p.tasks[0];
    return t0?.style?.cells?.[st.colSel] || {};
  }
  const uid = st.sel[0];
  const t = st.p.tasks.find(x => x.uid === uid);
  if (!t) return {};
  if (st.selMode === 'rows' || !st.cell) return t.style?.row || {};
  return { ...(t.style?.row || {}), ...(t.style?.cells?.[st.cell.col] || {}) };
}

// Applies formatting to the selection: whole rows when selected by the row header, else the active column's cells,
// or every task's cell when a column is selected by its header.
export function applyFormat(patch: Partial<Fmt>) {
  const st = S();
  const colAll = st.colSel;
  const uids = colAll ? st.p.tasks.map(t => t.uid) : st.sel;
  if (!uids.length) { st.notify('Select cells, rows or a column to format.'); return; }
  const col = colAll || (st.selMode === 'rows' ? null : st.cell?.col ?? null);
  const set = new Set(uids);
  const clean = (f: Fmt): Fmt | undefined => {
    const o: Fmt = { ...f };
    (Object.keys(o) as (keyof Fmt)[]).forEach(k => { if (o[k] === undefined || o[k] === false || o[k] === '') delete o[k]; });
    return Object.keys(o).length ? o : undefined;
  };
  st.commit({
    ...st.p,
    tasks: st.p.tasks.map(t => {
      if (!set.has(t.uid)) return t;
      const style: TaskStyle = { ...(t.style || {}), cells: { ...(t.style?.cells || {}) } };
      if (col) { const f = clean({ ...(style.cells![col] || {}), ...patch }); if (f) style.cells![col] = f; else delete style.cells![col]; }
      else style.row = clean({ ...(style.row || {}), ...patch });
      if (!style.row) delete style.row;
      if (!Object.keys(style.cells!).length) delete style.cells;
      return { ...t, style: Object.keys(style).length ? style : undefined };
    })
  });
}

// Copy formatting: picks up the formatting of the active cell (or row) and applies it to the next cell or rows clicked.
export function pickPainter(sticky = false) {
  const st = S();
  if (st.painter) { st.set({ painter: null }); return; }
  if (!st.sel.length) { st.notify('Select the cell or row whose formatting to copy.'); return; }
  st.set({ painter: { fmt: { ...activeFormat(st) }, rows: st.selMode === 'rows', sticky } });
  st.notify('Click the cells or rows to format' + (sticky ? '. Press Esc when done.' : '.'));
}
export function applyPainter(uids: number[], col: string | null) {
  const st = S(), pt = st.painter;
  if (!pt) return;
  const set = new Set(uids);
  st.commit({
    ...st.p,
    tasks: st.p.tasks.map(t => {
      if (!set.has(t.uid)) return t;
      const style: TaskStyle = { ...(t.style || {}), cells: { ...(t.style?.cells || {}) } };
      const f = { ...(pt.fmt as Fmt) };
      if (col && !pt.rows) { if (Object.keys(f).length) style.cells![col] = f; else delete style.cells![col]; }
      else { style.row = Object.keys(f).length ? f : undefined; style.cells = {}; }
      if (!style.row) delete style.row;
      if (!Object.keys(style.cells!).length) delete style.cells;
      return { ...t, style: Object.keys(style).length ? style : undefined };
    })
  });
  if (!pt.sticky) st.set({ painter: null });
}

// Height of rows in lines (drag the bottom edge of a row heading).
export function setRowLines(uids: number[], lines: number) {
  const st = S(), set = new Set(uids), n = Math.max(1, Math.min(10, Math.round(lines)));
  st.commit({ ...st.p, tasks: st.p.tasks.map(t => {
    if (!set.has(t.uid)) return t;
    const style: TaskStyle = { ...(t.style || {}) };
    if (n > 1) style.lines = n; else delete style.lines;
    return { ...t, style: Object.keys(style).length ? style : undefined };
  }) });
}

export function clearFormat() {
  const st = S();
  const set = new Set(st.colSel ? st.p.tasks.map(t => t.uid) : st.sel);
  st.commit({ ...st.p, tasks: st.p.tasks.map(t => (set.has(t.uid) && t.style ? { ...t, style: t.style.bar ? { bar: t.style.bar } : undefined } : t)) });
}

export function setBarColor(color: string | null) {
  const st = S();
  const set = new Set(st.sel);
  if (!set.size) { st.notify('Select the tasks whose bars to colour.'); return; }
  st.commit({ ...st.p, tasks: st.p.tasks.map(t => {
    if (!set.has(t.uid)) return t;
    const style: TaskStyle = { ...(t.style || {}) };
    if (color) style.bar = color; else delete style.bar;
    return { ...t, style: Object.keys(style).length ? style : undefined };
  }) });
}

// Task › Snap to links: moves the selected tasks so their links drive their dates again.
export function respectLinks() {
  const st = S();
  if (!st.sel.length) { st.notify('Select the tasks to move.'); return; }
  let p = st.p, moved = 0;
  st.sel.forEach(uid => {
    const r = st.s.byUid.get(uid);
    if (!r || r.summary || !r.task.preds.length) return;
    const t = r.task;
    if (t.mode === 'manual') {
      // Earliest start allowed by the links, from a copy of the task as an auto-scheduled task.
      const probe = schedule({ ...p, tasks: p.tasks.map(x => (x.uid === uid ? { ...x, mode: 'auto' as const, constraint: 'ASAP' as const, constraintDate: null } : x)) });
      const start = probe.byUid.get(uid)!.start;
      if (start !== r.start) { p = updateTask(p, uid, { start }); moved++; }
    } else if ((t.constraint === 'SNET' || t.constraint === 'FNET' || t.constraint === 'MSO' || t.constraint === 'MFO') && t.actualStart == null) {
      p = updateTask(p, uid, { constraint: 'ASAP', constraintDate: null }); moved++;
    }
  });
  if (moved) st.commit(p);
  st.notify(moved ? 'Moved ' + moved + ' task(s) to follow their links.' : 'The selected tasks already follow their links.');
}

export const ctxOf = (st: Store): Ctx => ({ p: st.p, s: st.s, outlineNumber: st.ui.outlineNumber });

/* ---------- task commands ---------- */

const selected = () => S().sel;
function needSel(): number[] | null {
  const sel = selected();
  if (!sel.length) { S().notify('Select one or more tasks first.'); return null; }
  return sel;
}
function apply(r: { p: any; error?: string; message?: string }) {
  if (r.error) { S().notify(r.error, true); return false; }
  S().commit(r.p);
  if (r.message) S().notify(r.message);
  return true;
}

export function editTask(uid: number, field: Field, text: string): boolean {
  const st = S();
  if (uid === 0) {
    if (field === 'name' && text.trim()) { st.commit({ ...st.p, name: text.trim() }); return true; }
    st.notify('The plan total row adds up the whole plan. Edit the tasks, or use File › Plan settings.');
    return false;
  }
  return apply(editCell(st.p, st.s, uid, field, text));
}

// Insert › Task: a new task below the selected task (after its subtasks) at the same level, or at the end.
export function insertTask(fields: Record<string, unknown> = {}, name = 'New task') {
  const st = S();
  const tasks = st.p.tasks;
  let at = tasks.length, level: number | undefined;
  if (st.sel.length) {
    const i = Math.max(...st.sel.map(u => tasks.findIndex(t => t.uid === u)));
    if (i >= 0) { at = i + 1; while (at < tasks.length && tasks[at].level > tasks[i].level) at++; level = tasks[i].level; }
  }
  let { p, uids } = insertTasks(st.p, at, 1, { name, ...(level ? { level } : {}), ...fields, created: new Date().toISOString() });
  if (p.settings.autoLink) p = autolinkInserted(p, uids[0]);
  st.commit(p);
  st.set({ sel: uids });
  return uids[0];
}

export function insertMilestone() {
  const uid = insertTask({ duration: 0, milestone: true, estimated: false }, 'New milestone');
  return uid;
}

// Insert › Phase: a new phase above the selected tasks, which become its subtasks.
export function insertSummary() {
  const st = S();
  const sel = st.sel.length ? st.sel : [];
  const idx = sel.length ? st.p.tasks.findIndex(t => sel.includes(t.uid)) : st.p.tasks.length;
  let { p, uids } = insertTasks(st.p, idx < 0 ? st.p.tasks.length : idx, 1, { name: 'New phase' });
  if (sel.length) p = indent(p, sel, 1).p;
  else p = insertTasks(p, p.tasks.length, 1, { name: 'New task', level: (p.tasks[p.tasks.length - 1]?.level ?? 1) + 1 }).p;
  st.commit(p);
  st.set({ sel: uids });
}

export function deleteSelected() {
  const sel = needSel(); if (!sel) return;
  const st = S();
  apply(deleteTasks(st.p, sel));
  st.set({ sel: [] });
}
export function indentSel(dir: 1 | -1) { const sel = needSel(); if (sel) apply(indent(S().p, sel, dir)); }
export function moveSel(dir: 1 | -1) { const sel = needSel(); if (sel) apply(moveTasks(S().p, sel, dir)); }
export function linkSel() { const sel = needSel(); if (sel) apply(linkTasks(S().p, sel)); }
export function unlinkSel() { const sel = needSel(); if (sel) apply(unlinkTasks(S().p, sel)); }
export function modeSel(mode: 'manual' | 'auto') { const sel = needSel(); if (sel) apply(setMode(S().p, S().s, sel, mode)); }
export function percentSel(v: number) { const sel = needSel(); if (sel) apply(setPercent(S().p, S().s, sel, v)); }
export function onTrackSel() { const sel = needSel(); if (sel) apply(markOnTrack(S().p, S().s, sel, todayMinutes())); }

export function toggleSel(field: 'active' | 'timeline' | 'milestone') {
  const sel = needSel(); if (!sel) return;
  const st = S();
  const first = st.p.tasks.find(t => t.uid === sel[0]);
  if (!first) return;
  const value = !first[field];
  let p = st.p;
  sel.forEach(u => {
    if (field === 'milestone') { const r = editCell(p, st.s, u, 'milestone', String(value)); p = r.p; }
    else p = updateTask(p, u, { [field]: value });
  });
  st.commit(p);
}

export function toggleCollapse(uid: number) {
  const ui = S().ui;
  S().setUI({ collapsed: { ...ui.collapsed, [uid]: !ui.collapsed[uid] } });
}

/* ---------- clipboard (tab-separated, compatible with Excel) ---------- */

export function copyRows(cut = false) {
  const st = S();
  const sel = new Set(st.sel);
  const rows = visibleRows(st).filter(r => sel.has(r.task.uid));
  if (!rows.length) return;
  const cols = currentColumns(st).map(c => makeColumn(c, st.p)).filter(c => c && c.key !== 'indicators' && c.key !== 'mode');
  const ctx = ctxOf(st);
  const text = rows.map(r => cols.map(c => c!.text(r, ctx).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  navigator.clipboard?.writeText(text).then(() => {
    if (cut) deleteSelected();
    st.notify((cut ? 'Cut ' : 'Copied ') + rows.length + ' row' + (rows.length > 1 ? 's' : ''));
  }, () => st.notify('The browser blocked clipboard access. Use Ctrl+C on the page instead.', true));
}

// Pastes tab-separated text into the table from the active cell, adding tasks as needed. One undo step.
export function pasteText(text: string) {
  const st = S();
  const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l.length || i < a.length - 1);
  if (!lines.length) return;
  const vis = visibleRows(st);
  const cols = currentColumns(st).map(c => c.field);
  const startRow = st.cell ? st.cell.row : vis.length;
  const startCol = Math.max(0, st.cell ? cols.indexOf(st.cell.col) : cols.indexOf('name'));
  let p = st.p;
  const bad: string[] = [];
  lines.forEach((line, k) => {
    const cells = line.split('\t');
    let uid: number;
    const rowIdx = startRow + k;
    if (rowIdx < vis.length) uid = vis[rowIdx].task.uid;
    else { const r = insertTasks(p, p.tasks.length, 1, { name: '' }); p = r.p; uid = r.uids[0]; }
    let sched = schedule(p);
    cells.forEach((v, j) => {
      const key = cols[startCol + j];
      const col = key ? makeColumn({ field: key }, p) : undefined;
      if (!col?.edit || (v.trim() === '' && col.key !== 'name')) return;
      const r = editCell(p, sched, uid, col.edit, v);
      if (r.error) bad.push(col.label + ' “' + v + '”: ' + r.error); else { p = r.p; sched = schedule(p); }
    });
  });
  st.commit(p);
  st.notify('Pasted ' + lines.length + ' row' + (lines.length > 1 ? 's' : '') + (bad.length ? '. Skipped: ' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? '…' : '') : ''), bad.length > 0);
}


/* ---------- files ---------- */

const W = window as any;
const slug = (s: string) => (s || 'project').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';

export function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let handle: any = null;
export async function saveFile(as = false) {
  const st = S();
  const json = JSON.stringify(st.p);
  if (!W.showSaveFilePicker) { download(slug(st.p.name) + '.cairn', json, 'application/json'); st.set({ dirty: false }); st.notify('Plan file downloaded'); return; }
  try {
    if (as || !handle) handle = await W.showSaveFilePicker({ suggestedName: slug(st.p.name) + '.cairn', types: [{ description: 'Cairn plan', accept: { 'application/json': ['.cairn'] } }] });
    const w = await handle.createWritable();
    await w.write(json);
    await w.close();
    st.set({ dirty: false, fileName: handle.name });
    st.notify('Saved to ' + handle.name);
  } catch (e: any) { if (e?.name !== 'AbortError') st.notify('Could not save: ' + e.message, true); }
}

const MPP_HELP = '.mpp files use a closed format that browsers cannot read. Save the plan as XML in the program that made it (Save As › XML), or open it in the free ProjectLibre and save as XML, then open the .xml file here.';

// Text formats that open straight into a plan.
export function readFileText(textContent: string, fileName: string): { p: any; report: ImportReport | null } {
  if (/\.xer$/i.test(fileName) || looksLikeXer(textContent)) return fromXer(textContent);
  if (/\.mpx$/i.test(fileName) || looksLikeMpx(textContent)) return fromMpx(textContent);
  const xml = /\.xml$/i.test(fileName) || /^\s*(\uFEFF)?</.test(textContent);
  if (xml) {
    if (!looksLikeProjectXml(textContent)) throw new Error('This XML file is not a project plan. Save the plan as “XML” (project data interchange) in the program that made it.');
    return fromProjectXml(textContent, fileName);
  }
  return { p: parseProjectText(textContent), report: null };
}

// Any supported file, from File › Open or dropped on the window.
export async function readDroppedFile(file: File) {
  const st = S();
  if (file.size > 50 * 1024 * 1024) { st.notify('That file is larger than 50 MB.', true); return; }
  const name = file.name;
  try {
    if (/\.mpp$/i.test(name)) { st.notify(MPP_HELP, true); st.setUI({ help: 'import' }); return; }
    if (/\.(xlsx|xlsm)$/i.test(name)) { const rows = await readXlsx(await file.arrayBuffer()); st.open('importTable', { rows, fileName: name }); return; }
    if (/\.(xls)$/i.test(name)) { st.notify('Old .xls workbooks cannot be read. Save it as .xlsx or CSV in your spreadsheet program first.', true); return; }
    const text = await file.text();
    if (/\.(csv|tsv|txt)$/i.test(name)) { st.open('importTable', { rows: parseCsv(text), fileName: name }); return; }
    const { p, report } = readFileText(text, name);
    handle = null;
    st.load(p, 'Opened ' + name, /\.cairn$|\.plancraft$/i.test(name) ? name : null);
    if (report) st.open('importReport', { report, fileName: name });
  } catch (e: any) { st.notify('Could not open ' + name + ': ' + e.message, true); }
}

export const OPEN_TYPES = '.cairn,.plancraft,.json,.xml,.xer,.mpx,.csv,.tsv,.txt,.xlsx,.xlsm,.mpp';
export function openFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = OPEN_TYPES;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = () => { const file = input.files?.[0]; input.remove(); if (file) readDroppedFile(file); };
  input.click();
  setTimeout(() => { if (!input.files?.length) input.remove(); }, 60000);
}

export function exportFile(kind: 'xml' | 'xer' | 'ics' | 'xlsx' | 'csv' | 'timephased' | 'resources') {
  const st = S(), name = slug(st.p.name);
  if (kind === 'timephased' || kind === 'resources') { exportTimephased(kind); return; }
  if (kind === 'xml') {
    const { xml, notes } = toProjectXml(st.p, st.s);
    download(name + '.xml', xml, 'application/xml');
    st.notify('Project XML downloaded. Most desktop schedulers open it with File › Open.' + (notes.length ? ' ' + notes.join(' ') : ''));
    return;
  }
  if (kind === 'xer') { download(name + '.xer', toXer(st.p, st.s), 'text/plain'); st.notify('Primavera XER downloaded. Import it in P6 with File › Import › XER.'); return; }
  if (kind === 'ics') { download(name + '.ics', toIcs(st.p, st.s), 'text/calendar'); st.notify('Calendar file downloaded: milestones and deadlines. Open it to add them to your calendar.'); return; }
  const ctx = ctxOf(st);
  const cols = [{ field: 'id' } as ColSpec, ...currentColumns(st).filter(c => c.field !== 'indicators' && c.field !== 'id')].map(c => makeColumn(c, st.p)!).filter(Boolean);
  const header = cols.map(c => (c.key === 'id' ? 'ID' : c.label));
  const rows = st.s.rows.map(r => cols.map(c => (c.key === 'name' ? '  '.repeat(r.task.level - 1) + r.task.name : c.text(r, ctx))));
  if (kind === 'csv') {
    const esc = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    download(name + '.csv', '\uFEFF' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n'), 'text/csv');
  } else {
    download(name + '.xlsx', toXlsx([header, ...rows], 'Tasks') as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  st.notify((kind === 'csv' ? 'CSV' : 'Excel workbook') + ' downloaded');
}

export function scrollToTask() {
  const st = S();
  const uid = st.sel[0];
  if (uid == null) { st.notify('Select a task first.'); return; }
  window.dispatchEvent(new CustomEvent('pc:scrollto', { detail: uid }));
}

export { useStore };

/* ---------- zoom (status bar slider, View › Zoom, Ctrl+wheel) ---------- */

export function setZoomPx(px: number) {
  const st = S();
  const ts = st.p.gantt.timescale;
  st.setGantt({ timescale: timescaleForPx(Math.max(0.3, Math.min(600, px)), ts) });
}
export function zoomBy(dir: number) {
  const ts = S().p.gantt.timescale;
  const cur = ts.px * ts.size / 100;
  // Step to the next preset in that direction.
  const presets = ZOOM_PRESETS.map(z => z.px).sort((a, b) => a - b);
  const next = dir > 0 ? presets.find(v => v > cur * 1.05) : [...presets].reverse().find(v => v < cur / 1.05);
  if (next) S().setGantt({ timescale: presetTimescale(ZOOM_PRESETS.findIndex(z => z.px === next), ts) });
}
export function zoomToPreset(i: number) { const ts = S().p.gantt.timescale; S().setGantt({ timescale: presetTimescale(i, ts) }); }

// View › Zoom › Entire Project, or the selected tasks.
export function fitRange(a: number, b: number) {
  const st = S();
  const days = Math.max(1, (b - a) / 1440 + 4);
  const avail = Math.max(300, window.innerWidth - st.ui.gridWidth - 120);
  setZoomPx(avail / days);
  setTimeout(() => window.dispatchEvent(new CustomEvent('pc:scrollto', { detail: { date: a - 1440 } })), 30);
}
export function fitEntireProject() { const s = S().s; fitRange(s.start, s.finish); }
export function fitSelected() {
  const st = S();
  const rows = st.sel.map(u => st.s.byUid.get(u)).filter((r): r is Row => !!r);
  if (!rows.length) { st.notify('Select the tasks to zoom to.'); return; }
  fitRange(Math.min(...rows.map(r => r.start)), Math.max(...rows.map(r => r.finish)));
}

/* ---------- editing helpers ---------- */

// Fill Down (Ctrl+D): copies the active cell of the first selected task to the other selected tasks.
export function fillDown() {
  const st = S();
  const col = st.cell?.col;
  if (!col || st.sel.length < 2) { st.notify('Select a cell and the rows below it to fill (Shift+click or Shift+Down).'); return; }
  const c = makeColumn({ field: col }, st.p);
  if (!c?.edit) { st.notify('This column cannot be edited.'); return; }
  const order = visibleRows(st).filter(r => st.sel.includes(r.task.uid) && r.id > 0 && !r.group);
  if (order.length < 2) return;
  const text = editText(c, order[0], ctxOf(st));
  let p = st.p;
  const errors: string[] = [];
  order.slice(1).forEach(r => { const out = editCell(p, schedule(p), r.task.uid, c.edit!, text); if (out.error) errors.push(out.error); else p = out.p; });
  st.commit(p);
  st.notify(errors.length ? 'Filled with ' + errors.length + ' cell(s) skipped: ' + errors[0] : 'Filled ' + (order.length - 1) + ' cell(s) with “' + text + '”', errors.length > 0);
}

export function openHyperlink(uid: number) {
  const t = S().p.tasks.find(x => x.uid === uid);
  const h = t?.hyperlink;
  if (!h) return;
  const href = h.address ? (/^[a-z][\w+.-]*:/i.test(h.address) ? h.address : /^[\w.-]+@[\w.-]+$/.test(h.address) ? 'mailto:' + h.address : 'https://' + h.address) + (h.sub ? '#' + h.sub : '') : '';
  if (href && /^(https?|mailto|ftp|file):/i.test(href)) window.open(href, '_blank', 'noopener');
  else if (h.sub) {
    // A link within the plan: the subaddress is a task ID.
    const id = parseInt(h.sub, 10), r = S().s.rows[id - 1];
    if (r) { S().set({ sel: [r.task.uid] }); scrollToTask(); }
  } else S().notify('This hyperlink cannot be opened: ' + h.address, true);
}

export function splitModeOn() {
  const st = S();
  st.set({ splitMode: !st.splitMode });
  if (!st.splitMode) st.notify('Click a task bar where its work should pause. Drag the later part to set the length of the pause.');
}

// Moves the selected rows to before another row (dragging row headings).
export function moveRowsTo(before: number | null, level?: number) {
  const st = S();
  const out = moveBlock(st.p, st.sel, before, level);
  if (out.p === st.p) return;
  st.commit(out.p);
}

// View › Reports › Visual Reports: timephased work and cost by week, or resource data, as Excel workbooks.
function exportTimephased(kind: 'timephased' | 'resources') {
  const st = S(), { p, s } = st, name = slug(p.name);
  const ctx = { p, s, outlineNumber: false };
  if (kind === 'resources') {
    const header = ['ID', 'Resource Name', 'Type', 'Group', 'Max Units', 'Std. Rate', 'Ovt. Rate', 'Cost/Use', 'Work (hours)', 'Cost', 'Overallocated'];
    const rows = p.resources.map((r, i) => {
      const ph = phasedResource(r.uid, s, p, [{ start: s.start - 1440 * 3650, end: s.finish + 1440 * 3650 }]);
      return [i + 1, r.name, r.type, r.group, r.type === 'Work' ? Math.round(r.maxUnits * 100) + '%' : '', r.stdRate, r.ovtRate, r.costPerUse, Math.round(ph.work[0] / 60 * 100) / 100, Math.round(ph.cost[0] * 100) / 100, s.overallocated.has(r.uid) ? 'Yes' : 'No'];
    });
    download(name + '-resources.xlsx', toXlsx([header, ...rows], 'Resources') as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    st.notify('Resource data downloaded');
    return;
  }
  const bks = buckets('week', s.start, s.finish + 1, p.gantt.timescale.weekStart);
  const header = ['ID', 'Task Name', 'Measure', ...bks.map(b => fmtDate(b.start, { weekday: false, format: 'iso' }))];
  const rows: unknown[][] = [];
  s.rows.forEach(r => {
    const ph = phasedTask(r, s, p, bks);
    rows.push([r.id, '  '.repeat(r.task.level - 1) + r.task.name, 'Work (hours)', ...ph.work.map(v => Math.round(v / 60 * 100) / 100)]);
    rows.push([r.id, '', 'Cost', ...ph.cost.map(v => Math.round(v * 100) / 100)]);
    rows.push([r.id, '', 'Baseline Work (hours)', ...ph.baselineWork.map(v => Math.round(v / 60 * 100) / 100)]);
  });
  void ctx;
  download(name + '-timephased.xlsx', toXlsx([header, ...rows], 'Timephased') as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  st.notify('Timephased work and cost by week downloaded');
}

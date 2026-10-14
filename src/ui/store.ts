// Application state: the project, its schedule, undo history, selection and view settings.
import { createStore } from './lib/createStore';
import { blankProject, normalizeProject, type ColSpec, type Project } from '../engine/model';
import { schedule, type Schedule } from '../engine/schedule';
import { buildTemplate } from '../engine/templates';
import { fromLegacy, isLegacy } from '../engine/legacy';
import { todayMinutes } from '../engine/time';

export type ViewName = 'gantt' | 'tracking' | 'detail' | 'leveling' | 'multiBaseline' | 'taskSheet' | 'taskUsage' | 'network' | 'calendar' | 'timeline' |
  'resourceSheet' | 'resourceUsage' | 'resourceGraph' | 'teamPlanner' | 'reports';
export type TableName = 'entry' | 'schedule' | 'tracking' | 'cost' | 'work' | 'variance' | 'summary' | 'baseline' | 'earned' | 'constraint' | 'delay' | 'hyperlink' | 'usage' | 'evCost' | 'evSchedule' | 'rollup' | 'export';
export type FilterName = string;   // a built-in filter id, or the id of one of the plan's own filters

export const VIEW_LABELS: Record<ViewName, string> = {
  gantt: 'Gantt', tracking: 'Progress against baseline', detail: 'Gantt with float', leveling: 'Balancing delays', multiBaseline: 'Baseline history',
  taskSheet: 'Task list', taskUsage: 'Task hours', network: 'Flow diagram', calendar: 'Calendar', timeline: 'Timeline',
  resourceSheet: 'People and resources', resourceUsage: 'Workload', resourceGraph: 'Capacity chart', teamPlanner: 'Team board', reports: 'Reports'
};
// Views that show the task table with a Gantt chart.
export const GANTT_VIEWS = new Set<ViewName>(['gantt', 'tracking', 'detail', 'leveling', 'multiBaseline']);
export const TASK_TABLE_VIEWS = new Set<ViewName>(['gantt', 'tracking', 'detail', 'leveling', 'multiBaseline', 'taskSheet', 'taskUsage']);

export interface Dialog { type: string; props?: any }
export interface CellPos { row: number; col: string } // row index in the visible list
export interface SortSpec { field: string; desc: boolean }

export interface Painter { fmt: Record<string, unknown>; rows: boolean; sticky: boolean }
export interface TaskPath { preds: boolean; driving: boolean; succs: boolean; driven: boolean }

export interface UI {
  view: ViewName;
  table: TableName;
  filter: FilterName;
  filterArgs: string[];          // answers to an interactive filter's questions
  highlight: boolean;            // highlight matching tasks instead of hiding the others
  group: string | null;          // built-in group id or the id of one of the plan's groups
  sort: SortSpec | null;
  sorts: SortSpec[];             // multi-level sort (View › Sort › Sort By); `sort` is the first key
  sortOutline: boolean;          // keep the outline structure when sorting
  details: boolean;              // details form under the view (View › Details)
  detailsH: number;
  taskPath: TaskPath;
  report: string;
  usageFields: string[];         // detail rows of the usage views: work, actualWork, cost, actualCost, baselineWork, peak, overalloc, remaining
  usageUnit: 'day' | 'week' | 'month' | 'quarter' | 'year';
  graphField: string;
  calMonth: number | null;       // first day of the month shown in the Calendar view
  netZoom: number;
  netSummaries: boolean;
  autoFilter: Record<string, string[]>;   // column AutoFilter: field → values shown
  barScheme: string;
  outlineLevel: number;          // 0 = all subtasks
  collapsed: Record<number, boolean>;
  critical: boolean;
  slack: boolean;
  baselineBars: boolean;
  lateTasks: boolean;
  projectSummary: boolean;
  outlineNumber: boolean;
  timeline: boolean;
  gridWidth: number;
  home: string | null;           // full-screen pages: 'new', 'open', 'print'
  help: string | null;           // help panel page: 'start', 'keys', 'import', 'about'
  inspector: boolean;            // task details panel on the right
  inspectorW: number;
  toolbar: boolean;
  theme: 'light' | 'dark';
}

export const TABLES: Record<TableName, { label: string; cols: string[] }> = {
  entry: { label: 'Standard', cols: ['indicators', 'mode', 'name', 'duration', 'start', 'finish', 'preds', 'resources'] },
  schedule: { label: 'Dates and float', cols: ['name', 'start', 'finish', 'lateStart', 'lateFinish', 'freeSlack', 'totalSlack'] },
  tracking: { label: 'Progress', cols: ['name', 'actualStart', 'actualFinish', 'percent', 'physPercent', 'actualDuration', 'remainingDuration', 'actualCost', 'actualWork'] },
  cost: { label: 'Cost', cols: ['name', 'fixedCost', 'accrual', 'cost', 'baselineCost', 'costVariance', 'actualCost', 'remainingCost'] },
  work: { label: 'Work', cols: ['name', 'work', 'baselineWork', 'workVariance', 'actualWork', 'remainingWork', 'percentWork'] },
  variance: { label: 'Date variance', cols: ['name', 'start', 'finish', 'baselineStart', 'baselineFinish', 'startVariance', 'finishVariance'] },
  summary: { label: 'Overview', cols: ['name', 'duration', 'start', 'finish', 'percent', 'cost', 'work'] },
  baseline: { label: 'Baseline', cols: ['name', 'baselineDuration', 'baselineStart', 'baselineFinish', 'baselineWork', 'baselineCost'] },
  earned: { label: 'Earned value', cols: ['name', 'bcws', 'bcwp', 'acwp', 'sv', 'cv', 'eac', 'bac', 'vac'] },
  evCost: { label: 'Earned value: cost', cols: ['name', 'bcws', 'bcwp', 'cv', 'cvp', 'cpi', 'bac', 'eac', 'vac', 'tcpi'] },
  evSchedule: { label: 'Earned value: schedule', cols: ['name', 'bcws', 'bcwp', 'sv', 'svp', 'spi'] },
  constraint: { label: 'Constraints and deadlines', cols: ['name', 'duration', 'constraint', 'constraintDate', 'deadline'] },
  delay: { label: 'Balancing delay', cols: ['indicators', 'name', 'levelDelay', 'duration', 'start', 'finish', 'preStart', 'preFinish', 'succs', 'resources'] },
  hyperlink: { label: 'Web links', cols: ['indicators', 'name', 'hyperlink', 'hyperlinkAddress', 'hyperlinkSub'] },
  usage: { label: 'Workload', cols: ['indicators', 'name', 'work', 'duration', 'start', 'finish'] },
  rollup: { label: 'Roll-up', cols: ['indicators', 'name', 'duration', 'rollup', 'hideBar', 'start', 'finish'] },
  export: { label: 'All fields', cols: ['uid', 'id', 'name', 'duration', 'type', 'outlineLevel', 'baselineDuration', 'constraint', 'constraintDate', 'deadline', 'start', 'finish', 'earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'freeSlack', 'totalSlack', 'levelDelay', 'percent', 'actualStart', 'actualFinish', 'baselineStart', 'baselineFinish', 'cost', 'fixedCost', 'work', 'priority', 'notes', 'wbs', 'preds'] }
};

// The columns of a table: as customised in this plan, else the defaults. Tables are saved with the plan.
export function tableColumns(p: Project, table: TableName): ColSpec[] {
  return p.tables[table] ?? TABLES[table].cols.map(field => ({ field }));
}

const UI_DEFAULTS: UI = {
  view: 'gantt', table: 'entry', filter: 'all', filterArgs: [], highlight: false, group: null, sort: null, sorts: [], sortOutline: true, details: false, detailsH: 230,
  taskPath: { preds: false, driving: false, succs: false, driven: false }, report: 'overview', usageFields: ['work'], usageUnit: 'day', graphField: 'peak', calMonth: null, netZoom: 1, netSummaries: true,
  autoFilter: {}, barScheme: 'default', outlineLevel: 0, collapsed: {}, critical: false, slack: false, baselineBars: false, lateTasks: false,
  projectSummary: false, outlineNumber: false, timeline: true, gridWidth: 640, home: null, help: null, inspector: true, inspectorW: 330, toolbar: true, theme: 'light'
};

export interface Store {
  p: Project;
  s: Schedule;
  planId: string;
  undo: Project[];
  redo: Project[];
  dirty: boolean;
  fileName: string | null;
  sel: number[];              // selected task uids
  cell: CellPos | null;       // active cell
  selMode: 'cells' | 'rows';  // rows when selected by the row header (formatting applies to whole rows)
  colSel: string | null;      // a column selected by its header
  editing: { row: number; col: string; text: string; cal?: boolean } | null;
  resSel: number[];
  painter: Painter | null;           // Copy formatting: formatting waiting to be applied
  changed: Map<number, Set<string>>; // cells changed by the last edit (change highlighting)
  splitMode: boolean;                // Task › Split Task: the next click on a bar splits it
  dialog: Dialog | null;
  toast: { text: string; err: boolean; id: number } | null;
  ui: UI;
  commit: (p: Project, opts?: { keepSel?: boolean }) => void;
  setGantt: (patch: Partial<Project['gantt']>) => void;   // view formatting without an undo step (zoom)
  undoAct: () => void;
  redoAct: () => void;
  load: (p: Project, msg?: string, fileName?: string | null) => void;
  setUI: (patch: Partial<UI>) => void;
  set: (patch: Partial<Store>) => void;
  notify: (text: string, err?: boolean) => void;
  open: (type: string, props?: any) => void;
  close: () => void;
}

/* ---------- local storage: a small library of plans ---------- */

const LIB = 'cairn.plans';
const PLAN = (id: string) => 'cairn.plan.' + id;
const ACTIVE = 'cairn.active';
const UIKEY = 'cairn.ui';

export interface PlanEntry { id: string; name: string; updatedAt: number }

export function listPlans(): PlanEntry[] {
  try { const v = JSON.parse(localStorage.getItem(LIB) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeList(list: PlanEntry[]) { try { localStorage.setItem(LIB, JSON.stringify(list)); } catch { /* storage unavailable */ } }
export function readPlan(id: string): Project | null {
  try { const t = localStorage.getItem(PLAN(id)); return t ? parseProjectText(t) : null; } catch { return null; }
}
export function deletePlan(id: string) {
  try { localStorage.removeItem(PLAN(id)); } catch { /* ignore */ }
  writeList(listPlans().filter(e => e.id !== id));
}

let saveTimer = 0;
let saveError = false;
function savePlan(id: string, p: Project) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(PLAN(id), JSON.stringify(p));
      localStorage.setItem(ACTIVE, id);
      const list = listPlans().filter(e => e.id !== id);
      list.unshift({ id, name: p.name, updatedAt: Date.now() });
      writeList(list.slice(0, 50));
      if (saveError) { saveError = false; useStore.getState().notify('Saving in this browser works again.'); }
    } catch {
      if (!saveError) useStore.getState().notify('This browser could not store the plan (storage full or blocked). Use File › Save to keep a copy.', true);
      saveError = true;
    }
  }, 250);
}

// Reads a .cairn plan file, including files saved by earlier versions.
export function parseProjectText(text: string): Project {
  const raw = JSON.parse(text);
  if (isLegacy(raw)) return fromLegacy(raw);
  return normalizeProject(raw);
}

function loadUI(): UI {
  try {
    const saved = JSON.parse(localStorage.getItem(UIKEY) || '{}');
    const ui = { ...UI_DEFAULTS, ...saved, home: null, help: null, collapsed: {}, autoFilter: {}, sort: null } as UI;
    delete (ui as any).columns; delete (ui as any).colWidths;
    if (!(ui.view in VIEW_LABELS)) ui.view = 'gantt';
    if (!(ui.table in TABLES)) ui.table = 'entry';
    ui.filter = 'all'; ui.filterArgs = []; ui.group = null; ui.sorts = [];
    ui.taskPath = { ...UI_DEFAULTS.taskPath };
    delete (ui as any).zoom;
    return ui;
  } catch { return { ...UI_DEFAULTS }; }
}

// Plans kept in this browser by earlier versions (stored under older key names) are copied over once.
// The old copies are left untouched.
function migrateOldPlans() {
  try {
    if (localStorage.getItem('cairn.migrated')) return;
    localStorage.setItem('cairn.migrated', '1');
    const list = listPlans();
    const have = new Set(list.map(e => e.id));
    const copy = (id: string, text: string | null, updatedAt?: number) => {
      if (!text || have.has(id)) return;
      try { const p = parseProjectText(text); localStorage.setItem(PLAN(id), JSON.stringify(p)); list.push({ id, name: p.name, updatedAt: Number(updatedAt) || Date.now() }); have.add(id); } catch { /* skip a plan that cannot be read */ }
    };
    const prev = JSON.parse(localStorage.getItem('plancraft5.plans') || '[]');
    if (Array.isArray(prev)) prev.forEach((e: { id?: string; updatedAt?: number }) => { if (e && typeof e.id === 'string') copy(e.id, localStorage.getItem('plancraft5.plan.' + e.id), e.updatedAt); });
    const old = JSON.parse(localStorage.getItem('plancraft.plans.v1') || '[]');
    if (Array.isArray(old)) old.forEach((e: { id?: string; updatedAt?: number }) => { if (e && typeof e.id === 'string') copy('v4-' + e.id, localStorage.getItem('plancraft.plan.' + e.id), e.updatedAt); });
    const active = localStorage.getItem('plancraft5.active');
    if (active && have.has(active) && !localStorage.getItem(ACTIVE)) localStorage.setItem(ACTIVE, active);
    const ui = localStorage.getItem('plancraft5.ui');
    if (ui && !localStorage.getItem(UIKEY)) localStorage.setItem(UIKEY, ui);
    writeList(list.sort((a, b) => b.updatedAt - a.updatedAt));
  } catch { /* storage unavailable */ }
}
migrateOldPlans();

// The plan that was open last; on a first visit, a blank plan with File › New open to choose a template.
let firstVisit = false;
function initial(): { p: Project; id: string } {
  let id = '';
  try { id = localStorage.getItem(ACTIVE) || ''; } catch { /* ignore */ }
  const p = id ? readPlan(id) : null;
  if (p) return { p, id };
  firstVisit = true;
  return { p: blankProject('Untitled plan'), id: crypto.randomUUID() };
}

const start = initial();
let toastId = 0;
const MAX_UNDO = 100;

export const useStore = createStore<Store>((set, get) => ({
  p: start.p,
  s: schedule(start.p),
  planId: start.id,
  undo: [],
  redo: [],
  dirty: false,
  fileName: null,
  sel: [],
  cell: null,
  selMode: 'cells',
  colSel: null,
  editing: null,
  resSel: [],
  dialog: null,
  toast: null,
  painter: null,
  changed: new Map(),
  splitMode: false,
  ui: { ...loadUI(), home: null },

  commit: (p, opts) => {
    const st = get();
    if (p === st.p) return;
    const s = schedule(p);
    const uids = new Set(p.tasks.map(t => t.uid));
    set({ p, s, undo: st.undo.concat([st.p]).slice(-MAX_UNDO), redo: [], dirty: true, sel: opts?.keepSel === false ? [] : st.sel.filter(u => uids.has(u)), changed: p.settings.changeHighlight ? diffSchedules(st.s, s) : new Map() });
    savePlan(st.planId, p);
  },
  setGantt: patch => {
    const st = get();
    const p = { ...st.p, gantt: { ...st.p.gantt, ...patch } };
    set({ p, dirty: true });
    savePlan(st.planId, p);
  },
  undoAct: () => {
    const st = get();
    if (!st.undo.length) return;
    const p = st.undo[st.undo.length - 1];
    set({ p, s: schedule(p), undo: st.undo.slice(0, -1), redo: st.redo.concat([st.p]), editing: null, changed: new Map() });
    savePlan(st.planId, p);
  },
  redoAct: () => {
    const st = get();
    if (!st.redo.length) return;
    const p = st.redo[st.redo.length - 1];
    set({ p, s: schedule(p), redo: st.redo.slice(0, -1), undo: st.undo.concat([st.p]), editing: null, changed: new Map() });
    savePlan(st.planId, p);
  },
  load: (p, msg, fileName = null) => {
    const id = crypto.randomUUID();
    set({ p, s: schedule(p), planId: id, undo: [], redo: [], sel: [], cell: null, colSel: null, editing: null, dirty: false, fileName, changed: new Map(), ui: { ...get().ui, home: null, collapsed: {}, sort: null, sorts: [], autoFilter: {}, filter: 'all', group: null } });
    savePlan(id, p);
    if (msg) get().notify(msg);
  },
  setUI: patch => {
    const ui = { ...get().ui, ...patch };
    set({ ui });
    // The open File page and collapsed rows are not remembered.
    try { const { home: _b, help: _h, collapsed: _c, autoFilter: _f, sort: _s, sorts: _ss, filterArgs: _fa, ...keep } = ui; localStorage.setItem(UIKEY, JSON.stringify(keep)); } catch { /* ignore */ }
  },
  set: patch => set(patch),
  notify: (text, err = false) => set({ toast: { text, err, id: ++toastId } }),
  open: (type, props) => set({ dialog: { type, props }, editing: null }),
  close: () => set({ dialog: null })
}));

export const S = () => useStore.getState();

// Cells whose values changed with the last edit, for change highlighting.
const WATCH: [string, (r: Schedule['rows'][number]) => number][] = [['start', r => r.start], ['finish', r => r.finish], ['duration', r => r.duration], ['work', r => r.work], ['cost', r => r.cost], ['lateStart', r => r.ls], ['lateFinish', r => r.lf], ['totalSlack', r => r.totalSlack], ['freeSlack', r => r.freeSlack]];
function diffSchedules(a: Schedule, b: Schedule): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  if (b.rows.length > 20000) return out;
  b.rows.forEach(r => {
    const o = a.byUid.get(r.task.uid);
    if (!o) return;
    WATCH.forEach(([k, f]) => { if (Math.abs(f(o) - f(r)) > 0.01) { let set = out.get(r.task.uid); if (!set) out.set(r.task.uid, (set = new Set())); set.add(k); } });
  });
  return out;
}

export function switchPlan(id: string) {
  const p = readPlan(id);
  if (!p) { S().notify('That plan could not be opened.', true); return; }
  useStore.setState({ p, s: schedule(p), planId: id, undo: [], redo: [], sel: [], cell: null, editing: null, dirty: false, fileName: null, changed: new Map() });
  useStore.getState().setUI({ home: null });
  try { localStorage.setItem(ACTIVE, id); } catch { /* ignore */ }
}

export function newBlank() { S().load(blankProject('Untitled plan ' + (listPlans().length + 1)), 'New blank plan'); }
export function newFromTemplate(id: string, name: string) { S().load(buildTemplate(id, todayMinutes()), name + ' template opened. Rename it in File › Plan settings.'); }
if (firstVisit) useStore.getState().setUI({ home: 'new' });

// Saves pending edits before the page closes.
window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  const st = S();
  try { localStorage.setItem(PLAN(st.planId), JSON.stringify(st.p)); localStorage.setItem(ACTIVE, st.planId); } catch { /* ignore */ }
});
(globalThis as unknown as { __cairn: unknown }).__cairn = S; // for debugging in the browser console

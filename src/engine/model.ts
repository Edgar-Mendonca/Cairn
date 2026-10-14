// The Cairn plan model. Field meanings follow the project XML exchange format, so files map one to one.
import { defaultGantt, normalizeGantt } from './gantt';
import { hours24Calendar, nightShiftCalendar, standardCalendar, type CalendarDef, type CalendarException } from './calendar';
import type { DurUnit } from './duration';
import type { RecurRule } from './recur';
import { atDay, dayOf, DATE_FORMATS, localeDateFormat, todayMinutes, weekday, type DateFormat, type Minutes } from './time';

export type TaskMode = 'auto' | 'manual';
export type TaskType = 'FixedUnits' | 'FixedWork' | 'FixedDuration';
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type ConstraintType = 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
export type ResourceType = 'Work' | 'Material' | 'Cost';

export const CONSTRAINT_NAMES: Record<ConstraintType, string> = {
  ASAP: 'As Soon As Possible', ALAP: 'As Late As Possible', SNET: 'Start No Earlier Than', SNLT: 'Start No Later Than',
  FNET: 'Finish No Earlier Than', FNLT: 'Finish No Later Than', MSO: 'Must Start On', MFO: 'Must Finish On'
};
export const TASK_TYPE_NAMES: Record<TaskType, string> = { FixedUnits: 'Fixed Units', FixedWork: 'Fixed Work', FixedDuration: 'Fixed Duration' };
export const LINK_NAMES: Record<LinkType, string> = { FS: 'Finish-to-Start (FS)', SS: 'Start-to-Start (SS)', FF: 'Finish-to-Finish (FF)', SF: 'Start-to-Finish (SF)' };

export interface Link {
  pred: number;          // predecessor task uid
  type: LinkType;
  lag: number;           // minutes (working, or clock when lagElapsed), or a percentage when lagPercent
  lagUnit: DurUnit;      // how the lag is shown
  lagElapsed: boolean;
  lagPercent: boolean;
}

export type Contour = 'flat' | 'backLoaded' | 'frontLoaded' | 'doublePeak' | 'earlyPeak' | 'latePeak' | 'bell' | 'turtle';
export const CONTOUR_NAMES: Record<Contour, string> = {
  flat: 'Flat', backLoaded: 'Back Loaded', frontLoaded: 'Front Loaded', doublePeak: 'Double Peak', earlyPeak: 'Early Peak', latePeak: 'Late Peak', bell: 'Bell', turtle: 'Turtle'
};

export interface Assignment {
  res: number;           // resource uid
  units: number;         // work: 1 = 100%; material: quantity
  work: number;          // minutes of work (work resources)
  cost: number;          // amount (cost resources)
  contour?: Contour;     // how work spreads over the task (timephased views, usage, overallocation)
  rateTable?: number;    // cost rate table 0–4 (A–E)
  ovt?: number;          // minutes of the work done as overtime (charged at the overtime rate)
  delay?: number;        // assignment delay (working minutes after the task start; timephased views)
}

// A pause in a task's work (Task › Split Task): after `after` working minutes the work stops for `gap` working minutes.
export interface Split { after: number; gap: number }

// Recurring task information, kept on the recurring phase so the occurrences can be rebuilt.
export interface Recurrence extends RecurRule {
  from: Minutes;          // range start (date)
  until: Minutes | null;  // end by date, or
  count: number;          // number of occurrences (when until is null)
  duration: number;       // working minutes of each occurrence
  durUnit: DurUnit;
  workdaysOnly: boolean;  // move occurrences off non-working days
}

export interface Hyperlink { text: string; address: string; sub: string }

export interface Task {
  uid: number;
  name: string;
  level: number;
  active: boolean;
  mode: TaskMode;
  type: TaskType;
  effortDriven: boolean;
  duration: number;       // minutes (working, or clock when elapsed)
  durUnit: DurUnit;
  elapsed: boolean;
  estimated: boolean;
  milestone: boolean;
  start: Minutes | null;  // manually scheduled tasks only
  constraint: ConstraintType;
  constraintDate: Minutes | null;
  deadline: Minutes | null;
  calendar: string | null;
  priority: number;
  levelDelay: number;     // working minutes added by resource balancing
  preds: Link[];
  assignments: Assignment[];
  percent: number;
  actualStart: Minutes | null;
  actualFinish: Minutes | null;
  fixedCost: number;
  notes: string;
  timeline: boolean;
  custom: Record<string, CustomValue>;   // keyed by custom field: Text1, Number3, Flag2, Date1 …
  style?: TaskStyle;
  splits?: Split[];          // pauses in the work, in order
  recurrence?: Recurrence;   // on recurring phases
  hyperlink?: Hyperlink;
  notesHtml?: string;        // formatted notes (notes holds the plain text)
  physPercent?: number;      // Physical % Complete
  evMethod?: 'percent' | 'physical';
  accrual?: Accrual;         // when the fixed cost is incurred
  rollup?: boolean;          // show this task's bar on its summary bar
  tlCallout?: boolean;       // shown as a callout on the Timeline
  hideBar?: boolean;
  marked?: boolean;
  wbsCode?: string;          // a WBS code typed by hand (otherwise from the WBS code mask)
  contact?: string;
  ignoreResCal?: boolean;
  created?: string;          // ISO date and time the task was created
}

export type Accrual = 'start' | 'prorated' | 'end';

// Values of custom fields: Text → string, Number/Cost → number, Flag → boolean, Date/Start/Finish → minutes, Duration → minutes.
export type CustomValue = string | number | boolean | null;

// Text formatting of a row or of single cells (Task › Font), and the colour of its Gantt bar.
export interface Fmt { b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string; bg?: string; font?: string; size?: number }
// Format › Bar for one task: overrides parts of the bar style that applies to it.
export interface BarOverride { color?: string; shape?: BarShape; pattern?: BarPattern; start?: EndShape; end?: EndShape; endColor?: string; left?: string; right?: string; top?: string; bottom?: string; inside?: string }
export interface TaskStyle { row?: Fmt; cells?: Record<string, Fmt>; bar?: string; barFmt?: BarOverride; lines?: number }

export interface RateChange { from: Minutes; rate: number; ovt?: number; perUse?: number }
// Cost rate tables B–E (table A is the resource's own rates and rate changes).
export interface RateTable { std: number; ovt: number; perUse: number; changes: RateChange[] }
// Resource availability over time (Person details › Resource Availability).
export interface Availability { from: Minutes | null; to: Minutes | null; units: number }

export interface Resource {
  uid: number;
  name: string;
  initials: string;
  group: string;
  type: ResourceType;
  materialLabel: string;
  maxUnits: number;      // 1 = 100%
  stdRate: number;       // per hour (material: per unit)
  ovtRate: number;
  costPerUse: number;
  calendar: string;
  rates: RateChange[];   // cost rate table A changes after the first rate
  notes: string;
  tables?: RateTable[];  // cost rate tables B–E
  availability?: Availability[];
  accrue?: Accrual;
  budget?: boolean;
  generic?: boolean;
  booking?: 'committed' | 'proposed';
  email?: string;
  code?: string;
}

export interface BaselineEntry { start: Minutes; finish: Minutes; duration: number; work: number; cost: number }
export interface Baseline { savedAt: string; tasks: Record<number, BaselineEntry> }
/* ---------- custom fields (Plan › Custom Fields) ---------- */

export type CFType = 'Text' | 'Number' | 'Flag' | 'Cost' | 'Date' | 'Duration' | 'Start' | 'Finish';
export const CF_COUNT: Record<CFType, number> = { Text: 30, Number: 20, Flag: 20, Cost: 10, Date: 10, Duration: 10, Start: 10, Finish: 10 };
export const CF_TYPES = Object.keys(CF_COUNT) as CFType[];
export const ALL_CUSTOM_FIELDS: string[] = CF_TYPES.flatMap(t => Array.from({ length: CF_COUNT[t] }, (_, i) => t + (i + 1)));
export function cfType(key: string): CFType | null {
  const m = /^(Text|Number|Flag|Cost|Date|Duration|Start|Finish)(\d{1,2})$/.exec(key);
  return m && +m[2] >= 1 && +m[2] <= CF_COUNT[m[1] as CFType] ? (m[1] as CFType) : null;
}

export type IndTest = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between' | 'notBetween' | 'contains' | 'notContains' | 'any';
export interface IndicatorRule { test: IndTest; value: string; value2: string; icon: string }
export type SummaryCalc = 'none' | 'sum' | 'max' | 'min' | 'avg' | 'count' | 'countNon' | 'and' | 'or' | 'formula';

export interface CustomFieldDef {
  alias: string;                                  // the name shown instead of Text1
  formula: string;                                // empty = values are typed in
  values: { value: string; desc: string }[];      // value list (lookup table)
  restrict: boolean;                              // only values from the list
  summary: SummaryCalc;                           // calculation for summary rows
  display: 'data' | 'indicators';
  indicators: IndicatorRule[];                    // first matching rule wins
  summaryIndicators: IndicatorRule[] | null;      // null = same rules as other tasks
  tip: boolean;                                   // show the value when hovering an indicator
}

// A column of a table, as set in Field Settings.
export interface ColSpec { field: string; title?: string; width?: number; align?: 'left' | 'center' | 'right'; titleAlign?: 'left' | 'center' | 'right'; wrapHeader?: boolean; wrap?: boolean }

export const blankFieldDef = (): CustomFieldDef => ({ alias: '', formula: '', values: [], restrict: false, summary: 'none', display: 'data', indicators: [], summaryIndicators: null, tip: true });

/* ---------- Gantt chart formatting (Format › Bar Styles, Layout, Timescale, Gridlines) ---------- */

export type BarShape = 'full' | 'top' | 'mid' | 'bottom' | 'thin' | 'line';
export type BarPattern = 'solid' | 'light' | 'hollow' | 'hatch' | 'dots';
export type EndShape = 'none' | 'diamond' | 'down' | 'up' | 'circle' | 'square' | 'bracketL' | 'bracketR' | 'house' | 'star' | 'arrowR' | 'arrowL';
export interface BarStyle {
  name: string;
  show: string[];           // conditions, all must hold: normal, milestone, summary, critical, noncritical, manual, split, inProgress, finished, notFinished, inactive, rolledUp, marked, late, groupBy, projectSummary, external; prefix "!" for Not
  from: string;             // field the bar starts at (start, baselineStart, actualStart, completeThrough, deadline, lateStart, preStart, b1Start, statusDate …)
  to: string;
  row: number;              // bar row 1–4 (rows below the first stack under the bar)
  shape: BarShape;
  pattern: BarPattern;
  color: string;
  start: EndShape; startColor: string;
  end: EndShape; endColor: string;
  text: { left?: string; right?: string; top?: string; bottom?: string; inside?: string };
  toggle?: string;          // shown only when this Format check box is on: critical, slack, baseline, late
  hidden?: boolean;
}
export interface GanttLayout { links: 'orth' | 'straight' | 'none'; dateFormat: DateFormat | 'project'; barHeight: number; rounded: boolean; rollupAll: boolean; showSplits: boolean; showDrawings: boolean; roundToDays: boolean }
export type TimeUnit = 'year' | 'half' | 'quarter' | 'month' | 'third' | 'week' | 'day' | 'hour' | 'minute';
export interface Tier { unit: TimeUnit; count: number; label: string; align: 'left' | 'center' | 'right'; ticks: boolean }
export interface Timescale { tiers: number; top: Tier; middle: Tier; bottom: Tier; size: number; px: number; shade: 'behind' | 'front' | 'none'; shadeColor: string; shadeCal: string | null; fiscalStart: number; weekStart: number }
export type LineType = 'none' | 'solid' | 'dotted' | 'dashed' | 'long';
export interface GridLine { type: LineType; color: string; every?: number; altType?: LineType; altColor?: string }
export interface Gridlines { ganttRows: GridLine; sheetRows: GridLine; sheetCols: GridLine; major: GridLine; minor: GridLine; current: GridLine; status: GridLine; projStart: GridLine; projFinish: GridLine; topTier: GridLine; bottomTier: GridLine }
export interface Drawing { id: number; kind: 'text' | 'rect' | 'oval' | 'line' | 'arrow'; at: Minutes; row: number; dx: number; dy: number; w: number; h: number; text: string; color: string; fill: string; uid?: number }
export interface ProgressLines { show: boolean; at: 'status' | 'current'; color: string }
// Bar styles are kept per Gantt view (gantt, tracking, detail, balancing, multiBaseline); a view without its own list uses the defaults.
export interface GanttFormat { styles: Record<string, BarStyle[]>; layout: GanttLayout; timescale: Timescale; gridlines: Gridlines; progress: ProgressLines; drawings: Drawing[]; baseline: number }

/* ---------- filters, groups, saved views ---------- */

export type FilterTest = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'within' | 'notWithin' | 'contains' | 'notContains' | 'exact';
export interface Criterion { join: 'and' | 'or'; field: string; test: FilterTest; value: string; value2: string }
export interface FilterDef { id: string; name: string; criteria: Criterion[]; summaries: boolean; resource?: boolean }
export interface GroupDef { id: string; name: string; keys: { field: string; desc: boolean; interval?: number }[]; summaries: boolean; resource?: boolean }
export interface SavedView { id: string; name: string; screen: string; table: string; filter: string; group: string; highlight: boolean }

// WBS code mask (Plan › WBS › Define Code): a prefix, then one entry per outline level.
export interface WbsLevel { seq: 'num' | 'upper' | 'lower' | 'chars'; length: number; sep: string }
export interface WbsMask { prefix: string; levels: WbsLevel[] }

export interface LevelOptions { order: 'id' | 'standard' | 'priority'; withinSlack: boolean; from: Minutes | null; to: Minutes | null; clearFirst: boolean; canSplit: boolean; basis: 'minute' | 'day' | 'week' }

export interface Settings {
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
  defaultStart: number;    // minute of day new tasks start (8:00)
  defaultFinish: number;   // minute of day tasks finish (17:00)
  newTaskMode: TaskMode;
  defaultType: TaskType;
  effortDriven: boolean;
  honorConstraints: boolean;
  criticalSlack: number;   // minutes
  durationUnit: DurUnit;
  workUnit: DurUnit;
  dateFormat: DateFormat;
  showTime: boolean;
  currency: string;
  multipleCritical: boolean;   // each chain of tasks has its own critical path
  autoLink: boolean;           // inserting or moving tasks links them in the chain ("Autolink")
  changeHighlight: boolean;    // shade cells changed by the last edit
  splitInProgress: boolean;    // Update Project can split tasks in progress
  calcActualCosts: boolean;
}

export interface Project {
  format: 'cairn';
  version: 5;
  name: string;
  subject: string;
  company: string;
  manager: string;
  notes: string;
  start: Minutes;
  statusDate: Minutes | null;
  calendar: string;
  calendars: CalendarDef[];
  settings: Settings;
  tasks: Task[];             // in outline order
  resources: Resource[];
  baselines: (Baseline | null)[];   // Baseline, Baseline 1 … Baseline 10
  fields: Record<string, CustomFieldDef>;   // customised custom fields, keyed Text1, Number1 …
  textStyles: Record<string, Fmt>;          // Format › Text Styles: all, summary, critical, milestone, inactive
  tables: Record<string, ColSpec[]>;        // customised table columns (entry, schedule …); missing = default columns
  scheduleFrom: 'start' | 'finish';
  finish: Minutes | null;                   // project finish date when scheduling from the finish
  gantt: GanttFormat;
  filters: FilterDef[];                     // your own filters (built-in filters are not stored)
  groups: GroupDef[];
  views: SavedView[];
  wbsMask: WbsMask | null;
  leveling: LevelOptions;
  nextTaskUid: number;
  nextResUid: number;
}

export const DEFAULT_SETTINGS: Settings = {
  minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20, defaultStart: 480, defaultFinish: 1020,
  newTaskMode: 'auto', defaultType: 'FixedUnits', effortDriven: false, honorConstraints: true, criticalSlack: 0,
  durationUnit: 'd', workUnit: 'h', dateFormat: 'dmy', showTime: false, currency: '$',
  multipleCritical: false, autoLink: true, changeHighlight: true, splitInProgress: true, calcActualCosts: true
};

export const DEFAULT_LEVELING: LevelOptions = { order: 'standard', withinSlack: false, from: null, to: null, clearFirst: true, canSplit: false, basis: 'day' };

// The next working Monday-to-Friday morning on or after today.
function defaultStart(): Minutes {
  let d = dayOf(todayMinutes());
  while (weekday(d) === 0 || weekday(d) === 6) d++;
  return atDay(d, 480);
}

export function blankProject(name = 'Untitled plan'): Project {
  const settings = { ...DEFAULT_SETTINGS, dateFormat: localeDateFormat() };
  return {
    format: 'cairn', version: 5, name, subject: '', company: '', manager: '', notes: '',
    start: defaultStart(), statusDate: null, calendar: 'standard',
    calendars: [standardCalendar(), hours24Calendar(), nightShiftCalendar()],
    settings, tasks: [], resources: [], baselines: Array(11).fill(null), fields: {}, textStyles: {}, tables: {},
    scheduleFrom: 'start', finish: null, gantt: defaultGantt(), filters: [], groups: [], views: [], wbsMask: null, leveling: { ...DEFAULT_LEVELING },
    nextTaskUid: 1, nextResUid: 1
  };
}

export function newTask(p: Project, fields: Partial<Task> = {}): Task {
  const s = p.settings;
  const manual = (fields.mode ?? s.newTaskMode) === 'manual';
  return {
    uid: p.nextTaskUid++, name: '', level: 1, active: true, mode: s.newTaskMode, type: s.defaultType, effortDriven: s.defaultType === 'FixedWork' || s.effortDriven,
    duration: s.minutesPerDay, durUnit: s.durationUnit, elapsed: false, estimated: !manual, milestone: false, start: null,
    constraint: 'ASAP', constraintDate: null, deadline: null, calendar: null, priority: 500, levelDelay: 0, preds: [], assignments: [],
    percent: 0, actualStart: null, actualFinish: null, fixedCost: 0, notes: '', timeline: false, custom: {},
    ...fields
  };
}

export function newResource(p: Project, fields: Partial<Resource> = {}): Resource {
  return {
    uid: p.nextResUid++, name: '', initials: '', group: '', type: 'Work', materialLabel: '', maxUnits: 1, stdRate: 0, ovtRate: 0,
    costPerUse: 0, calendar: p.calendar, rates: [], notes: '', ...fields
  };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
}

export const isSummaryAt = (tasks: Task[], i: number) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;

// Index one past the last descendant of task i.
export function subtreeEnd(tasks: Task[], i: number): number {
  let j = i + 1;
  while (j < tasks.length && tasks[j].level > tasks[i].level) j++;
  return j;
}

// Keeps the outline valid: first task at level 1 and no task more than one level below the one above.
export function fixLevels(tasks: Task[]): Task[] {
  let prev = 0;
  return tasks.map(t => {
    const lv = Math.max(1, Math.min(t.level, prev + 1));
    prev = lv;
    return lv === t.level ? t : { ...t, level: lv };
  });
}

/* ---------- loading and checking files ---------- */

const isObj = (o: unknown): o is Record<string, any> => o != null && typeof o === 'object' && !Array.isArray(o);
const num = (v: unknown, d: number) => { const n = Number(v); return isFinite(n) ? n : d; };
const str = (v: unknown) => (v == null ? '' : String(v));
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const time = (v: unknown): Minutes | null => (v == null || v === '' || !isFinite(Number(v)) ? null : Math.round(Number(v)));
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const UNITS = ['m', 'h', 'd', 'w', 'mo'] as const;
const CONSTRAINTS = ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'] as const;

// Fills missing fields and coerces every value, so a damaged or older file cannot break the app.
export function normalizeProject(raw: unknown): Project {
  if (!isObj(raw) || (raw.format !== 'cairn' && raw.format !== 'plancraft') || !Array.isArray(raw.tasks)) throw new Error('This is not a Cairn plan file.');
  const base = blankProject();
  const p: Project = { ...base, ...raw, format: 'cairn' } as Project;
  p.version = 5;
  p.name = str(raw.name) || 'Untitled plan';
  ['subject', 'company', 'manager', 'notes'].forEach(k => { (p as any)[k] = str(raw[k]); });
  p.start = time(raw.start) ?? base.start;
  p.statusDate = time(raw.statusDate);
  p.settings = { ...DEFAULT_SETTINGS, ...(isObj(raw.settings) ? raw.settings : {}) };
  const s = p.settings;
  s.minutesPerDay = Math.max(1, Math.min(1440, num(s.minutesPerDay, 480)));
  s.minutesPerWeek = Math.max(1, Math.min(10080, num(s.minutesPerWeek, 2400)));
  s.daysPerMonth = Math.max(1, Math.min(31, num(s.daysPerMonth, 20)));
  s.newTaskMode = oneOf(s.newTaskMode, ['auto', 'manual'] as const, 'auto');
  s.defaultType = oneOf(s.defaultType, ['FixedUnits', 'FixedWork', 'FixedDuration'] as const, 'FixedUnits');
  s.durationUnit = oneOf(s.durationUnit, UNITS, 'd');
  s.workUnit = oneOf(s.workUnit, UNITS, 'h');
  s.dateFormat = oneOf(s.dateFormat, DATE_FORMATS, localeDateFormat());
  p.calendars = arr(raw.calendars).filter(isObj).map(c => ({
    id: str(c.id), name: str(c.name), base: c.base ? str(c.base) : null,
    week: [0, 1, 2, 3, 4, 5, 6].map(i => { const w = arr(c.week)[i]; return Array.isArray(w) ? w.filter(isObj).map(x => ({ from: num(x.from, 0), to: num(x.to, 0) })) : null; }),
    exceptions: arr(c.exceptions).filter(isObj).map(e => {
      const ex: CalendarException = { name: str(e.name), start: str(e.start), finish: str(e.finish || e.start), times: arr(e.times).filter(isObj).map(x => ({ from: num(x.from, 0), to: num(x.to, 0) })) };
      if (isObj(e.recur)) ex.recur = { ...normRule(e.recur), count: Math.max(1, Math.min(2000, Math.round(num(e.recur.count, 1)))) };
      return ex;
    })
  })).filter(c => c.id);
  if (!p.calendars.some(c => c.id === 'standard')) p.calendars.unshift(standardCalendar());
  if (!p.calendars.some(c => c.id === raw.calendar)) p.calendar = 'standard';
  // Custom field definitions. Files from 0.5 had free-form fields; they move to Text and Number fields.
  const renamed = new Map<string, string>();
  p.fields = {};
  if (isObj(raw.fields)) {
    Object.entries(raw.fields).forEach(([k, f]) => { if (cfType(k) && isObj(f)) p.fields[k] = normalizeFieldDef(f); });
  }
  arr(raw.customFields).filter(isObj).forEach(f => {
    const type: CFType = f.type === 'number' ? 'Number' : 'Text';
    const key = Array.from({ length: CF_COUNT[type] }, (_, i) => type + (i + 1)).find(k => !p.fields[k]);
    if (!key) return;
    p.fields[key] = { ...blankFieldDef(), alias: str(f.name) };
    renamed.set(str(f.id), key);
  });
  p.tables = {};
  if (isObj(raw.tables)) {
    const ALIGN = ['left', 'center', 'right'] as const;
    Object.entries(raw.tables).forEach(([k, cols]) => {
      const list = arr(cols).filter(isObj).map(c => {
        const out: ColSpec = { field: str(c.field) };
        if (c.title) out.title = str(c.title);
        if (isFinite(Number(c.width)) && Number(c.width) > 0) out.width = Math.min(2000, Math.round(Number(c.width)));
        if (ALIGN.includes(c.align)) out.align = c.align;
        if (ALIGN.includes(c.titleAlign)) out.titleAlign = c.titleAlign;
        if (c.wrapHeader === false) out.wrapHeader = false;
        if (c.wrap) out.wrap = true;
        return out;
      }).filter(c => c.field);
      if (list.length) p.tables[k] = list;
    });
  }
  p.scheduleFrom = raw.scheduleFrom === 'finish' ? 'finish' : 'start';
  p.finish = time(raw.finish);
  if (p.scheduleFrom === 'finish' && p.finish == null) p.scheduleFrom = 'start';
  p.gantt = normalizeGantt(raw.gantt);
  p.filters = arr(raw.filters).filter(isObj).map(normFilter).filter(f => f.name);
  p.groups = arr(raw.groups).filter(isObj).map(normGroup).filter(g => g.name && g.keys.length);
  p.views = arr(raw.views).filter(isObj).map(v => ({ id: str(v.id) || 'v' + Math.random().toString(36).slice(2, 8), name: str(v.name), screen: str(v.screen) || 'gantt', table: str(v.table) || 'entry', filter: str(v.filter) || 'all', group: str(v.group), highlight: !!v.highlight })).filter(v => v.name);
  p.wbsMask = isObj(raw.wbsMask) && Array.isArray(raw.wbsMask.levels) ? { prefix: str(raw.wbsMask.prefix), levels: arr(raw.wbsMask.levels).filter(isObj).map(l => ({ seq: oneOf(l.seq, ['num', 'upper', 'lower', 'chars'] as const, 'num'), length: Math.max(0, Math.min(10, Math.round(num(l.length, 0)))), sep: str(l.sep).slice(0, 1) || '.' })) } : null;
  p.leveling = { ...DEFAULT_LEVELING, ...(isObj(raw.leveling) ? raw.leveling : {}) };
  p.leveling.order = oneOf(p.leveling.order, ['id', 'standard', 'priority'] as const, 'standard');
  p.leveling.basis = oneOf(p.leveling.basis, ['minute', 'day', 'week'] as const, 'day');
  p.leveling.from = time(p.leveling.from); p.leveling.to = time(p.leveling.to);
  p.textStyles = {};
  if (isObj(raw.textStyles)) Object.entries(raw.textStyles).forEach(([k, f]) => { const v = normFmt(f); if (v) p.textStyles[k] = v; });
  const seenT = new Set<number>(), seenR = new Set<number>();
  let maxT = 0, maxR = 0;
  p.resources = arr(raw.resources).filter(isObj).map(r => {
    const res = newResource({ ...base, nextResUid: 0 } as Project, {});
    const out: Resource = {
      ...res, uid: Math.floor(num(r.uid, 0)), name: str(r.name), initials: str(r.initials), group: str(r.group),
      type: oneOf(r.type, ['Work', 'Material', 'Cost'] as const, 'Work'), materialLabel: str(r.materialLabel),
      maxUnits: Math.max(0, num(r.maxUnits, 1)), stdRate: Math.max(0, num(r.stdRate, 0)), ovtRate: Math.max(0, num(r.ovtRate, 0)),
      costPerUse: Math.max(0, num(r.costPerUse, 0)), calendar: p.calendars.some(c => c.id === r.calendar) ? str(r.calendar) : p.calendar,
      rates: arr(r.rates).filter(isObj).map(normRate).sort((a, b) => a.from - b.from),
      notes: str(r.notes)
    };
    if (Array.isArray(r.tables)) out.tables = arr(r.tables).slice(0, 4).map(t => (isObj(t) ? { std: Math.max(0, num(t.std, 0)), ovt: Math.max(0, num(t.ovt, 0)), perUse: Math.max(0, num(t.perUse, 0)), changes: arr(t.changes).filter(isObj).map(normRate).sort((a, b) => a.from - b.from) } : { std: 0, ovt: 0, perUse: 0, changes: [] }));
    if (Array.isArray(r.availability)) out.availability = arr(r.availability).filter(isObj).map(a => ({ from: time(a.from), to: time(a.to), units: Math.max(0, num(a.units, 1)) }));
    if (r.accrue) out.accrue = oneOf(r.accrue, ['start', 'prorated', 'end'] as const, 'prorated');
    if (r.budget) out.budget = true;
    if (r.generic) out.generic = true;
    if (r.booking === 'proposed') out.booking = 'proposed';
    if (r.email) out.email = str(r.email);
    if (r.code) out.code = str(r.code);
    if (out.uid < 1 || seenR.has(out.uid)) out.uid = -1;
    else seenR.add(out.uid);
    maxR = Math.max(maxR, out.uid);
    return out;
  });
  p.resources.forEach(r => { if (r.uid < 1) { r.uid = ++maxR; } });
  const resIds = new Set(p.resources.map(r => r.uid));
  p.tasks = arr(raw.tasks).filter(isObj).map(t => {
    const out: Task = newTask({ ...base, nextTaskUid: 0 } as Project, {});
    Object.assign(out, {
      uid: Math.floor(num(t.uid, 0)), name: str(t.name), level: Math.max(1, Math.floor(num(t.level, 1))), active: t.active !== false,
      mode: oneOf(t.mode, ['auto', 'manual'] as const, 'auto'), type: oneOf(t.type, ['FixedUnits', 'FixedWork', 'FixedDuration'] as const, 'FixedUnits'),
      effortDriven: !!t.effortDriven, duration: Math.max(0, num(t.duration, 480)), durUnit: oneOf(t.durUnit, UNITS, 'd'), elapsed: !!t.elapsed,
      estimated: !!t.estimated, milestone: !!t.milestone, start: time(t.start), constraint: oneOf(t.constraint, CONSTRAINTS, 'ASAP'),
      constraintDate: time(t.constraintDate), deadline: time(t.deadline), calendar: t.calendar && p.calendars.some(c => c.id === t.calendar) ? str(t.calendar) : null,
      priority: Math.max(0, Math.min(1000, num(t.priority, 500))), levelDelay: Math.max(0, num(t.levelDelay, 0)), percent: Math.max(0, Math.min(100, num(t.percent, 0))),
      actualStart: time(t.actualStart), actualFinish: time(t.actualFinish), fixedCost: num(t.fixedCost, 0), notes: str(t.notes), timeline: !!t.timeline,
      preds: arr(t.preds).filter(isObj).map(l => ({
        pred: Math.floor(num(l.pred, 0)), type: oneOf(l.type, ['FS', 'SS', 'FF', 'SF'] as const, 'FS'), lag: num(l.lag, 0),
        lagUnit: oneOf(l.lagUnit, UNITS, 'd'), lagElapsed: !!l.lagElapsed, lagPercent: !!l.lagPercent
      })),
      assignments: arr(t.assignments).filter(isObj).map(a => {
        const out: Assignment = { res: Math.floor(num(a.res, 0)), units: Math.max(0, num(a.units, 1)), work: Math.max(0, num(a.work, 0)), cost: num(a.cost, 0) };
        if (a.contour && a.contour !== 'flat') out.contour = oneOf(a.contour, CONTOURS, 'flat');
        if (num(a.rateTable, 0) > 0) out.rateTable = Math.min(4, Math.round(num(a.rateTable, 0)));
        if (num(a.ovt, 0) > 0) out.ovt = Math.min(out.work, num(a.ovt, 0));
        if (num(a.delay, 0) > 0) out.delay = num(a.delay, 0);
        return out;
      }).filter(a => resIds.has(a.res)),
      custom: normCustom(t.custom, renamed),
      style: normStyle(t.style)
    });
    if (!out.style) delete out.style;
    normTaskExtras(out, t);
    if (out.uid < 1 || seenT.has(out.uid)) out.uid = -1; else seenT.add(out.uid);
    maxT = Math.max(maxT, out.uid);
    return out;
  });
  p.tasks.forEach(t => { if (t.uid < 1) t.uid = ++maxT; });
  const taskIds = new Set(p.tasks.map(t => t.uid));
  p.tasks.forEach(t => { t.preds = t.preds.filter(l => taskIds.has(l.pred) && l.pred !== t.uid); });
  p.tasks = fixLevels(p.tasks);
  p.nextTaskUid = Math.max(num(raw.nextTaskUid, 1), maxT + 1);
  p.nextResUid = Math.max(num(raw.nextResUid, 1), maxR + 1);
  const bl = arr(raw.baselines);
  p.baselines = Array.from({ length: 11 }, (_, i) => (isObj(bl[i]) && isObj(bl[i].tasks) ? { savedAt: str(bl[i].savedAt), tasks: bl[i].tasks } : null));
  return p;
}

const CONTOURS: Contour[] = ['flat', 'backLoaded', 'frontLoaded', 'doublePeak', 'earlyPeak', 'latePeak', 'bell', 'turtle'];
const normRate = (x: Record<string, any>): RateChange => {
  const out: RateChange = { from: time(x.from) ?? 0, rate: Math.max(0, num(x.rate, 0)) };
  if (x.ovt != null) out.ovt = Math.max(0, num(x.ovt, 0));
  if (x.perUse != null) out.perUse = Math.max(0, num(x.perUse, 0));
  return out;
};

export function normRule(r: Record<string, any>): RecurRule {
  return {
    pattern: oneOf(r.pattern ?? r.type, ['daily', 'weekly', 'monthly', 'yearly'] as const, 'weekly'), every: Math.max(1, Math.min(999, Math.round(num(r.every, 1)))),
    days: arr(r.days).map(d => Math.round(num(d, -1))).filter(d => d >= 0 && d <= 6), monthDay: Math.max(0, Math.min(31, Math.round(num(r.monthDay, 0)))),
    nth: Math.max(1, Math.min(5, Math.round(num(r.nth, 1)))), weekday: Math.max(0, Math.min(6, Math.round(num(r.weekday, 1)))), month: Math.max(1, Math.min(12, Math.round(num(r.month, 1))))
  };
}

// Fields added in version 0.7; absent in older files.
function normTaskExtras(out: Task, t: Record<string, any>) {
  const splits = arr(t.splits).filter(isObj).map(x => ({ after: Math.max(0, num(x.after, 0)), gap: Math.max(0, num(x.gap, 0)) })).filter(x => x.gap > 0).sort((a, b) => a.after - b.after);
  if (splits.length) out.splits = splits;
  if (isObj(t.recurrence)) {
    const r = t.recurrence;
    out.recurrence = { ...normRule(r), from: time(r.from) ?? 0, until: time(r.until), count: Math.max(1, Math.min(999, Math.round(num(r.count, 1)))), duration: Math.max(0, num(r.duration, 60)), durUnit: oneOf(r.durUnit, UNITS, 'h'), workdaysOnly: r.workdaysOnly !== false };
  }
  if (isObj(t.hyperlink) && (t.hyperlink.address || t.hyperlink.sub)) out.hyperlink = { text: str(t.hyperlink.text), address: str(t.hyperlink.address), sub: str(t.hyperlink.sub) };
  if (t.notesHtml) out.notesHtml = str(t.notesHtml);
  if (t.physPercent != null && num(t.physPercent, 0) > 0) out.physPercent = Math.max(0, Math.min(100, num(t.physPercent, 0)));
  if (t.evMethod === 'physical') out.evMethod = 'physical';
  if (t.accrual === 'start' || t.accrual === 'end') out.accrual = t.accrual;
  (['rollup', 'hideBar', 'marked', 'ignoreResCal', 'tlCallout'] as const).forEach(k => { if (t[k]) out[k] = true; });
  if (t.wbsCode) out.wbsCode = str(t.wbsCode);
  if (t.contact) out.contact = str(t.contact);
  if (t.created) out.created = str(t.created);
}

const TESTS_F: FilterTest[] = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'within', 'notWithin', 'contains', 'notContains', 'exact'];
function normFilter(f: Record<string, any>): FilterDef {
  return {
    id: str(f.id) || 'f' + Math.random().toString(36).slice(2, 8), name: str(f.name).slice(0, 80), summaries: f.summaries !== false, resource: !!f.resource,
    criteria: arr(f.criteria).filter(isObj).map((c): Criterion => ({ join: c.join === 'or' ? 'or' : 'and', field: str(c.field), test: oneOf(c.test, TESTS_F, 'eq'), value: str(c.value), value2: str(c.value2) })).filter(c => c.field)
  };
}
function normGroup(g: Record<string, any>): GroupDef {
  return {
    id: str(g.id) || 'g' + Math.random().toString(36).slice(2, 8), name: str(g.name).slice(0, 80), summaries: g.summaries !== false, resource: !!g.resource,
    keys: arr(g.keys).filter(isObj).map(k => ({ field: str(k.field), desc: !!k.desc, interval: num(k.interval, 0) > 0 ? num(k.interval, 0) : undefined })).filter(k => k.field).slice(0, 10)
  };
}

function normCustom(raw: unknown, renamed: Map<string, string>): Record<string, CustomValue> {
  const out: Record<string, CustomValue> = {};
  if (!isObj(raw)) return out;
  Object.entries(raw).forEach(([k0, v]) => {
    const k = renamed.get(k0) ?? k0;
    const type = cfType(k);
    if (!type || v == null || v === '') return;
    if (type === 'Text') out[k] = String(v);
    else if (type === 'Flag') out[k] = v === true || v === 1 || /^(true|yes|1)$/i.test(String(v));
    else { const n = Number(v); if (isFinite(n)) out[k] = n; }
  });
  return out;
}

const COLOR = /^#[0-9a-f]{3,8}$/i;
function normFmt(f: unknown): Fmt | undefined {
  if (!isObj(f)) return undefined;
  const out: Fmt = {};
  (['b', 'i', 'u', 's'] as const).forEach(k => { if (f[k]) out[k] = true; });
  if (typeof f.color === 'string' && COLOR.test(f.color)) out.color = f.color;
  if (typeof f.bg === 'string' && COLOR.test(f.bg)) out.bg = f.bg;
  if (typeof f.font === 'string' && f.font.trim()) out.font = f.font.trim().slice(0, 60);
  if (isFinite(Number(f.size)) && Number(f.size) >= 6 && Number(f.size) <= 48) out.size = Math.round(Number(f.size) * 2) / 2;
  return Object.keys(out).length ? out : undefined;
}

function normStyle(st: unknown): TaskStyle | undefined {
  if (!isObj(st)) return undefined;
  const out: TaskStyle = {};
  const row = normFmt(st.row);
  if (row) out.row = row;
  if (isObj(st.cells)) {
    const cells: Record<string, Fmt> = {};
    Object.entries(st.cells).forEach(([k, f]) => { const v = normFmt(f); if (v) cells[k] = v; });
    if (Object.keys(cells).length) out.cells = cells;
  }
  if (typeof st.bar === 'string' && COLOR.test(st.bar)) out.bar = st.bar;
  if (isObj(st.barFmt)) {
    const b: BarOverride = {}, x = st.barFmt;
    if (typeof x.color === 'string' && COLOR.test(x.color)) b.color = x.color;
    if (typeof x.endColor === 'string' && COLOR.test(x.endColor)) b.endColor = x.endColor;
    (['shape', 'pattern', 'start', 'end', 'left', 'right', 'top', 'bottom', 'inside'] as const).forEach(k => { if (typeof x[k] === 'string') (b as Record<string, string>)[k] = x[k]; });
    if (Object.keys(b).length) out.barFmt = b;
  }
  if (Number(st.lines) > 1) out.lines = Math.min(10, Math.round(Number(st.lines)));
  return Object.keys(out).length ? out : undefined;
}

const TESTS: IndTest[] = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between', 'notBetween', 'contains', 'notContains', 'any'];
const CALCS: SummaryCalc[] = ['none', 'sum', 'max', 'min', 'avg', 'count', 'countNon', 'and', 'or', 'formula'];
function normRules(v: unknown): IndicatorRule[] {
  return arr(v).filter(isObj).map(r => ({ test: oneOf(r.test, TESTS, 'eq'), value: str(r.value), value2: str(r.value2), icon: str(r.icon) || 'circle-green' }));
}
export function normalizeFieldDef(f: Record<string, any>): CustomFieldDef {
  return {
    alias: str(f.alias).slice(0, 100), formula: str(f.formula),
    values: arr(f.values).filter(isObj).map(x => ({ value: str(x.value), desc: str(x.desc) })).filter(x => x.value !== ''),
    restrict: !!f.restrict, summary: oneOf(f.summary, CALCS, 'none'), display: f.display === 'indicators' ? 'indicators' : 'data',
    indicators: normRules(f.indicators), summaryIndicators: f.summaryIndicators == null ? null : normRules(f.summaryIndicators), tip: f.tip !== false
  };
}

// The task field catalog. Every column, formula reference, sort and filter goes through
// these definitions, so a field behaves the same everywhere. `get` returns the raw value:
//   dates → minutes (null = NA) · durations and work → minutes · costs → amount · flags → boolean · % → 0–100
import { CONSTRAINT_NAMES, TASK_TYPE_NAMES, ALL_CUSTOM_FIELDS, cfType, type CFType, type CustomFieldDef, type CustomValue, type Project } from './model';
import type { Row, Schedule } from './schedule';
import { compile, evaluate, DateV, FormulaError, toBool, toNum, toStr, type FormulaEnv, type Val } from './formula';
import { formatDuration, parseDuration, type DurUnit } from './duration';
import { fmtDate, parseDateText, atDay, todayMinutes, type Minutes } from './time';
import type { Field as EditField } from './ops';

export type FType = 'text' | 'number' | 'int' | 'percent' | 'duration' | 'work' | 'date' | 'cost' | 'flag';
export type FRaw = string | number | boolean | null;

export interface FieldDef {
  key: string;
  name: string;            // field name, used in formulas: [Baseline Finish]
  title?: string;          // default column title when it differs (Name → Task Name)
  type: FType;
  group: string;
  width: number;
  edit?: EditField;
  editor?: 'mode' | 'constraint' | 'type' | 'bool' | 'date' | 'list';
  get: (r: Row, c: FCtx) => FRaw;
  custom?: CFType;
  hidden?: boolean;        // used by built-in groups, not offered in field lists
  options?: string[];      // values offered by a list editor
}

export interface FCtx { p: Project; s: Schedule }

/* ---------- earned value (Baseline vs status date) ---------- */

interface EV { bcws: number; bcwp: number; acwp: number; bac: number }
const evCache = new WeakMap<Schedule, Map<number, EV>>();

export function earnedValue(r: Row, c: FCtx): EV {
  let m = evCache.get(c.s);
  if (!m) { m = new Map(); evCache.set(c.s, m); }
  const hit = m.get(r.i);
  if (hit) return hit;
  let ev: EV;
  if (r.summary) {
    ev = { bcws: 0, bcwp: 0, acwp: 0, bac: 0 };
    r.children.forEach(i => { const x = earnedValue(c.s.rows[i], c); ev.bcws += x.bcws; ev.bcwp += x.bcwp; ev.acwp += x.acwp; ev.bac += x.bac; });
  } else {
    const b = r.baseline, bac = b ? b.cost : 0;
    const status = c.p.statusDate ?? todayMinutes();
    let planned = 0;
    if (b) {
      if (status >= b.finish) planned = 1;
      else if (status > b.start) planned = b.duration > 0 ? Math.min(1, c.s.calendar.workBetween(b.start, status) / b.duration) : 1;
    }
    ev = { bcws: bac * planned, bcwp: bac * (r.task.evMethod === 'physical' ? r.task.physPercent ?? 0 : r.percent) / 100, acwp: r.actualCost, bac };
  }
  m.set(r.i, ev);
  return ev;
}

/* ---------- helpers ---------- */

// Physical % Complete: typed on tasks; phases show the cost-weighted value of their subtasks.
function physical(r: Row, c: FCtx): number {
  if (!r.summary) return r.task.physPercent ?? 0;
  let w = 0, v = 0;
  r.children.forEach(i => { const k = c.s.rows[i]; const b = k.baseline?.cost || k.cost || k.duration || 1; w += b; v += b * physical(k, c); });
  return w ? v / w : 0;
}
function sumAssign(r: Row, c: FCtx, f: (a: Row['task']['assignments'][number]) => number): number {
  if (r.summary) return r.children.reduce((t, i) => t + sumAssign(c.s.rows[i], c, f), 0);
  return r.task.assignments.reduce((t, a) => t + (c.p.resources.find(x => x.uid === a.res)?.type === 'Work' ? f(a) : 0), 0);
}

const work = (r: Row, c: FCtx, a: Minutes | null | undefined, b: Minutes | null | undefined) =>
  a == null || b == null ? 0 : c.s.calendars.get(r.task.calendar, c.p.calendar).workBetween(a, b);
const blAt = (c: FCtx, r: Row, k: number) => (k === 0 ? r.baseline : c.p.baselines[k]?.tasks[r.task.uid] ?? null);
const status = (r: Row, c: FCtx): string => {
  if (r.percent >= 100) return 'Complete';
  const now = c.p.statusDate ?? todayMinutes();
  if (r.start > now) return 'Future Task';
  const expected = r.duration > 0 ? Math.min(1, Math.max(0, work(r, c, r.start, now) / r.duration)) : 1;
  return r.percent / 100 < expected - 1e-6 ? 'Late' : 'On Schedule';
};
const resNames = (c: FCtx, r: Row, initials: boolean) => {
  const res = new Map(c.p.resources.map(x => [x.uid, x]));
  return r.task.assignments.map(a => { const x = res.get(a.res); return x ? (initials ? x.initials || x.name : x.name) : ''; }).filter(Boolean).join(',');
};

type Spec = Omit<FieldDef, 'group' | 'width'> & { group?: string; width?: number };
const F = (group: string, list: Spec[]): FieldDef[] => list.map(f => ({ width: defaultWidth(f.type), ...f, group: f.group || group }));
function defaultWidth(t: FType) { return t === 'date' ? 120 : t === 'text' ? 120 : t === 'flag' ? 64 : t === 'cost' ? 96 : t === 'int' ? 64 : 86; }

const BUILT_IN: FieldDef[] = [
  ...F('General', [
    { key: 'id', name: 'ID', type: 'int', get: r => r.id, width: 44 },
    { key: 'uid', name: 'Unique ID', type: 'int', get: r => r.task.uid },
    { key: 'name', name: 'Name', title: 'Task', type: 'text', get: r => r.task.name, edit: 'name', width: 260 },
    { key: 'mode', name: 'Task Mode', title: 'Mode', type: 'text', get: r => (r.task.mode === 'manual' ? 'Pinned' : 'Auto'), edit: 'mode', editor: 'mode', width: 48 },
    { key: 'wbs', name: 'WBS', type: 'text', get: r => r.wbs, edit: 'wbs', width: 64 },
    { key: 'outlineNumber', name: 'Outline Number', type: 'text', get: r => r.outline, width: 64 },
    { key: 'outlineLevel', name: 'Outline Level', type: 'int', get: r => r.task.level },
    { key: 'notes', name: 'Notes', type: 'text', get: r => r.task.notes, edit: 'notes', width: 200 },
    { key: 'preds', name: 'Predecessors', type: 'text', get: () => '', edit: 'preds', width: 100 },
    { key: 'succs', name: 'Successors', type: 'text', get: () => '', width: 100 },
    { key: 'resources', name: 'Resource Names', title: 'Assigned to', type: 'text', get: (r, c) => resNames(c, r, false), edit: 'resources', width: 170 },
    { key: 'resourceInitials', name: 'Resource Initials', type: 'text', get: (r, c) => resNames(c, r, true) },
    { key: 'priority', name: 'Priority', type: 'int', get: r => r.task.priority, edit: 'priority' },
    { key: 'type', name: 'Type', type: 'text', get: r => TASK_TYPE_NAMES[r.task.type], edit: 'type', editor: 'type', width: 110 },
    { key: 'constraint', name: 'Constraint Type', type: 'text', get: r => CONSTRAINT_NAMES[r.task.constraint], edit: 'constraint', editor: 'constraint', width: 150 },
    { key: 'calendar', name: 'Task Calendar', type: 'text', edit: 'calendar', get: (r, c) => (r.task.calendar ? c.p.calendars.find(x => x.id === r.task.calendar)?.name ?? '' : 'None') },
    { key: 'hyperlink', name: 'Hyperlink', type: 'text', edit: 'hyperlink', get: r => r.task.hyperlink ? r.task.hyperlink.text || r.task.hyperlink.address : '', width: 140 },
    { key: 'hyperlinkAddress', name: 'Hyperlink Address', type: 'text', edit: 'hyperlinkAddress', get: r => r.task.hyperlink?.address ?? '', width: 160 },
    { key: 'hyperlinkSub', name: 'Hyperlink SubAddress', type: 'text', edit: 'hyperlinkSub', get: r => r.task.hyperlink?.sub ?? '' },
    { key: 'hyperlinkHref', name: 'Hyperlink Href', type: 'text', get: r => (r.task.hyperlink ? r.task.hyperlink.address + (r.task.hyperlink.sub ? '#' + r.task.hyperlink.sub : '') : ''), width: 160 },
    { key: 'contact', name: 'Contact', type: 'text', edit: 'contact', get: r => r.task.contact ?? '' },
    { key: 'resourceGroup', name: 'Resource Group', type: 'text', get: (r, c) => [...new Set(r.task.assignments.map(a => c.p.resources.find(x => x.uid === a.res)?.group || '').filter(Boolean))].join(',') },
    { key: 'uidPreds', name: 'Unique ID Predecessors', type: 'text', get: r => r.task.preds.map(l => l.pred).join(','), width: 100 },
    { key: 'uidSuccs', name: 'Unique ID Successors', type: 'text', get: (r, c) => c.s.rows.filter(x => x.task.preds.some(l => l.pred === r.task.uid)).map(x => x.task.uid).join(','), width: 100 },
    { key: 'evMethod', name: 'Earned Value Method', type: 'text', edit: 'evMethod', editor: 'list', options: ['% Complete', 'Physical % Complete'], get: r => (r.task.evMethod === 'physical' ? 'Physical % Complete' : '% Complete'), width: 130 },
    { key: 'accrual', name: 'Fixed Cost Accrual', type: 'text', edit: 'accrual', editor: 'list', options: ['Start', 'Prorated', 'End'], get: r => (r.task.accrual === 'start' ? 'Start' : r.task.accrual === 'end' ? 'End' : 'Prorated'), width: 100 },
    { key: 'created', name: 'Created', type: 'date', get: r => (r.task.created ? Math.round(Date.parse(r.task.created) / 60000) - new Date(r.task.created).getTimezoneOffset() : null) },
    { key: 'status', name: 'Status', type: 'text', get: status },
    { key: 'completion', name: 'Completion', type: 'text', hidden: true, get: r => (r.percent >= 100 ? '100% Complete' : r.percent > 0 ? '1% to 99% Complete' : '0% Complete') },
    { key: 'project', name: 'Project', type: 'text', get: (_, c) => c.p.name }
  ]),
  ...F('Flags', [
    { key: 'active', name: 'Active', type: 'flag', get: r => r.task.active, edit: 'active', editor: 'bool' },
    { key: 'milestone', name: 'Milestone', type: 'flag', get: r => r.task.milestone || (!r.summary && r.duration === 0), edit: 'milestone', editor: 'bool' },
    { key: 'summary', name: 'Summary', type: 'flag', get: r => r.summary },
    { key: 'critical', name: 'Critical', type: 'flag', get: r => r.critical },
    { key: 'effortDriven', name: 'Effort Driven', type: 'flag', get: r => r.task.effortDriven, edit: 'effortDriven', editor: 'bool' },
    { key: 'estimated', name: 'Estimated', type: 'flag', get: r => r.task.estimated },
    { key: 'manual', name: 'Manual', type: 'flag', get: r => r.task.mode === 'manual' },
    { key: 'overallocated', name: 'Overallocated', type: 'flag', get: r => r.indicators.includes('overallocated') },
    { key: 'timeline', name: 'Show On Timeline', type: 'flag', get: r => r.task.timeline },
    { key: 'recurring', name: 'Recurring', type: 'flag', get: r => !!r.task.recurrence },
    { key: 'split', name: 'Split', type: 'flag', get: r => !!r.segments },
    { key: 'rollup', name: 'Rollup', type: 'flag', edit: 'rollup', editor: 'bool', get: r => !!r.task.rollup },
    { key: 'hideBar', name: 'Hide Bar', type: 'flag', edit: 'hideBar', editor: 'bool', get: r => !!r.task.hideBar },
    { key: 'marked', name: 'Marked', type: 'flag', edit: 'marked', editor: 'bool', get: r => !!r.task.marked },
    { key: 'ignoreResCal', name: 'Ignore Resource Calendar', type: 'flag', edit: 'ignoreResCal', editor: 'bool', get: r => !!r.task.ignoreResCal },
    { key: 'started', name: 'Started', type: 'flag', hidden: true, get: r => r.actualStart != null },
    { key: 'hasNotes', name: 'Has Notes', type: 'flag', hidden: true, get: r => !!r.task.notes }
  ]),
  ...F('Dates', [
    { key: 'start', name: 'Start', type: 'date', get: r => r.start, edit: 'start', editor: 'date' },
    { key: 'finish', name: 'Finish', type: 'date', get: r => r.finish, edit: 'finish', editor: 'date' },
    { key: 'earlyStart', name: 'Early Start', type: 'date', get: r => r.es },
    { key: 'earlyFinish', name: 'Early Finish', type: 'date', get: r => r.ef },
    { key: 'lateStart', name: 'Late Start', type: 'date', get: r => r.ls },
    { key: 'lateFinish', name: 'Late Finish', type: 'date', get: r => r.lf },
    { key: 'actualStart', name: 'Actual Start', type: 'date', get: r => r.actualStart, edit: 'actualStart', editor: 'date' },
    { key: 'actualFinish', name: 'Actual Finish', type: 'date', get: r => r.actualFinish, edit: 'actualFinish', editor: 'date' },
    { key: 'constraintDate', name: 'Constraint Date', type: 'date', get: r => r.task.constraintDate, edit: 'constraintDate', editor: 'date' },
    { key: 'deadline', name: 'Deadline', type: 'date', get: r => r.task.deadline, edit: 'deadline', editor: 'date' },
    { key: 'baselineStart', name: 'Baseline Start', type: 'date', get: r => r.baseline?.start ?? null },
    { key: 'baselineFinish', name: 'Baseline Finish', type: 'date', get: r => r.baseline?.finish ?? null },
    { key: 'preStart', name: 'Preleveled Start', type: 'date', get: r => r.preStart },
    { key: 'preFinish', name: 'Preleveled Finish', type: 'date', get: r => r.preFinish },
    { key: 'completeThrough', name: 'Complete Through', type: 'date', get: r => (r.percent > 0 ? r.completeThrough : null) },
    { key: 'resume', name: 'Resume', type: 'date', get: r => (r.percent > 0 && r.percent < 100 ? r.completeThrough : null) },
    { key: 'stop', name: 'Stop', type: 'date', get: r => (r.percent > 0 && r.percent < 100 ? r.completeThrough : null) }
  ]),
  ...F('Durations', [
    { key: 'duration', name: 'Duration', type: 'duration', get: r => r.duration, edit: 'duration' },
    { key: 'actualDuration', name: 'Actual Duration', type: 'duration', edit: 'actualDuration', get: r => r.duration - r.remaining },
    { key: 'remainingDuration', name: 'Remaining Duration', type: 'duration', edit: 'remainingDuration', get: r => r.remaining },
    { key: 'baselineDuration', name: 'Baseline Duration', type: 'duration', get: r => r.baseline?.duration ?? 0 },
    { key: 'durationVariance', name: 'Duration Variance', type: 'duration', get: r => r.duration - (r.baseline?.duration ?? r.duration) },
    { key: 'startVariance', name: 'Start Variance', type: 'duration', get: (r, c) => work(r, c, r.baseline?.start, r.start) },
    { key: 'finishVariance', name: 'Finish Variance', type: 'duration', get: (r, c) => work(r, c, r.baseline?.finish, r.finish) },
    { key: 'totalSlack', name: 'Total Slack', title: 'Total float', type: 'duration', get: r => r.totalSlack },
    { key: 'freeSlack', name: 'Free Slack', title: 'Free float', type: 'duration', get: r => r.freeSlack },
    { key: 'startSlack', name: 'Start Slack', type: 'duration', get: (r, c) => work(r, c, r.es, r.ls) },
    { key: 'finishSlack', name: 'Finish Slack', type: 'duration', get: (r, c) => work(r, c, r.ef, r.lf) },
    { key: 'levelDelay', name: 'Leveling Delay', title: 'Balancing delay', type: 'duration', edit: 'levelDelay', get: r => r.task.levelDelay }
  ]),
  ...F('Work and progress', [
    { key: 'percent', name: '% Complete', title: '% done', type: 'percent', get: r => r.percent, edit: 'percent' },
    { key: 'percentWork', name: '% Work Complete', type: 'percent', edit: 'percentWork', get: r => (r.work ? r.actualWork / r.work * 100 : r.percent) },
    { key: 'physPercent', name: 'Physical % Complete', type: 'percent', edit: 'physPercent', get: (r, c) => physical(r, c) },
    { key: 'work', name: 'Work', type: 'work', get: r => r.work, edit: 'work' },
    { key: 'actualWork', name: 'Actual Work', type: 'work', edit: 'actualWork', get: r => r.actualWork },
    { key: 'remainingWork', name: 'Remaining Work', type: 'work', edit: 'remainingWork', get: r => r.work - r.actualWork },
    { key: 'overtimeWork', name: 'Overtime Work', type: 'work', get: (r, c) => sumAssign(r, c, a => a.ovt || 0) },
    { key: 'regularWork', name: 'Regular Work', type: 'work', get: (r, c) => r.work - sumAssign(r, c, a => a.ovt || 0) },
    { key: 'baselineWork', name: 'Baseline Work', type: 'work', get: r => r.baseline?.work ?? 0 },
    { key: 'workVariance', name: 'Work Variance', type: 'work', get: r => r.work - (r.baseline?.work ?? 0) }
  ]),
  ...F('Costs', [
    { key: 'cost', name: 'Cost', type: 'cost', get: r => r.cost },
    { key: 'fixedCost', name: 'Fixed Cost', type: 'cost', get: r => r.task.fixedCost, edit: 'fixedCost' },
    { key: 'actualCost', name: 'Actual Cost', type: 'cost', get: r => r.actualCost },
    { key: 'remainingCost', name: 'Remaining Cost', type: 'cost', get: r => r.cost - r.actualCost },
    { key: 'baselineCost', name: 'Baseline Cost', type: 'cost', get: r => r.baseline?.cost ?? 0 },
    { key: 'costVariance', name: 'Cost Variance', type: 'cost', get: r => r.cost - (r.baseline?.cost ?? 0) }
  ]),
  ...F('Earned value', [
    { key: 'bcws', name: 'BCWS', type: 'cost', get: (r, c) => earnedValue(r, c).bcws },
    { key: 'bcwp', name: 'BCWP', type: 'cost', get: (r, c) => earnedValue(r, c).bcwp },
    { key: 'acwp', name: 'ACWP', type: 'cost', get: (r, c) => earnedValue(r, c).acwp },
    { key: 'bac', name: 'BAC', type: 'cost', get: (r, c) => earnedValue(r, c).bac },
    { key: 'sv', name: 'SV', type: 'cost', get: (r, c) => { const e = earnedValue(r, c); return e.bcwp - e.bcws; } },
    { key: 'svp', name: 'SV%', type: 'percent', get: (r, c) => { const e = earnedValue(r, c); return e.bcws ? (e.bcwp - e.bcws) / e.bcws * 100 : 0; } },
    { key: 'cvp', name: 'CV%', type: 'percent', get: (r, c) => { const e = earnedValue(r, c); return e.bcwp ? (e.bcwp - e.acwp) / e.bcwp * 100 : 0; } },
    { key: 'cv', name: 'CV', type: 'cost', get: (r, c) => { const e = earnedValue(r, c); return e.bcwp - e.acwp; } },
    { key: 'spi', name: 'SPI', type: 'number', get: (r, c) => { const e = earnedValue(r, c); return e.bcws ? e.bcwp / e.bcws : 0; } },
    { key: 'cpi', name: 'CPI', type: 'number', get: (r, c) => { const e = earnedValue(r, c); return e.acwp ? e.bcwp / e.acwp : 0; } },
    { key: 'eac', name: 'EAC', type: 'cost', get: (r, c) => { const e = earnedValue(r, c); const cpi = e.acwp ? e.bcwp / e.acwp : 0; return cpi ? e.acwp + (e.bac - e.bcwp) / cpi : r.cost; } },
    { key: 'vac', name: 'VAC', type: 'cost', get: (r, c) => { const e = earnedValue(r, c); const cpi = e.acwp ? e.bcwp / e.acwp : 0; return e.bac - (cpi ? e.acwp + (e.bac - e.bcwp) / cpi : r.cost); } },
    { key: 'tcpi', name: 'TCPI', type: 'number', get: (r, c) => { const e = earnedValue(r, c); return e.bac - e.acwp ? (e.bac - e.bcwp) / (e.bac - e.acwp) : 0; } }
  ]),
  // Baselines 1–10
  ...Array.from({ length: 10 }, (_, j) => j + 1).flatMap(k => F('Baselines 1–10', [
    { key: 'b' + k + 'Start', name: 'Baseline' + k + ' Start', type: 'date', get: (r, c) => blAt(c, r, k)?.start ?? null },
    { key: 'b' + k + 'Finish', name: 'Baseline' + k + ' Finish', type: 'date', get: (r, c) => blAt(c, r, k)?.finish ?? null },
    { key: 'b' + k + 'Duration', name: 'Baseline' + k + ' Duration', type: 'duration', get: (r, c) => blAt(c, r, k)?.duration ?? 0 },
    { key: 'b' + k + 'Work', name: 'Baseline' + k + ' Work', type: 'work', get: (r, c) => blAt(c, r, k)?.work ?? 0 },
    { key: 'b' + k + 'Cost', name: 'Baseline' + k + ' Cost', type: 'cost', get: (r, c) => blAt(c, r, k)?.cost ?? 0 }
  ]))
];

const CF_FTYPE: Record<CFType, FType> = { Text: 'text', Number: 'number', Flag: 'flag', Cost: 'cost', Date: 'date', Duration: 'duration', Start: 'date', Finish: 'date' };
const CUSTOM: FieldDef[] = ALL_CUSTOM_FIELDS.map(key => {
  const t = cfType(key)!;
  return {
    key, name: key, type: CF_FTYPE[t], group: 'Custom fields', width: defaultWidth(CF_FTYPE[t]), custom: t,
    edit: ('custom:' + key) as EditField, editor: t === 'Flag' ? 'bool' : CF_FTYPE[t] === 'date' ? 'date' : undefined,
    get: (r, c) => customValue(r, c, key)
  };
});

export const FIELDS: FieldDef[] = [...BUILT_IN, ...CUSTOM];
export const FIELD = new Map(FIELDS.map(f => [f.key, f]));

// The name to show for a field: its alias for renamed custom fields ("Risk (Text1)" in lists).
export function fieldName(key: string, p: Project, forList = false): string {
  const f = FIELD.get(key);
  if (!f) return key;
  const alias = f.custom ? p.fields[key]?.alias : '';
  if (alias) return forList ? alias + ' (' + key + ')' : alias;
  return f.title || f.name;
}

// Finds a field by the name used in a formula: built-in name, custom field key or custom alias (any case).
export function findField(name: string, p: Project): FieldDef | undefined {
  const n = name.trim().toLowerCase();
  return FIELDS.find(f => f.name.toLowerCase() === n || f.key.toLowerCase() === n) ||
    FIELDS.find(f => f.custom && p.fields[f.key]?.alias.toLowerCase() === n) ||
    FIELDS.find(f => (f.title || '').toLowerCase() === n);
}

/* ---------- custom field values: typed in, from a formula, or rolled up ---------- */

const EMPTY: Record<FType, FRaw> = { text: '', number: 0, int: 0, percent: 0, duration: 0, work: 0, date: null, cost: 0, flag: false };

function stored(r: Row, key: string, t: FType): FRaw {
  const v: CustomValue | undefined = r.task.custom[key];
  if (v == null) return EMPTY[t];
  return v;
}

// Formula evaluation guards against fields that refer to each other.
const evaluating = new Set<string>();

// A formula applies to ordinary tasks; summary rows show their own value (None), a rollup of their
// subtasks, or the formula ("Use formula"). An error in a formula shows as #ERROR.
export function customValue(r: Row, c: FCtx, key: string): FRaw {
  const f = FIELD.get(key)!, def = c.p.fields[key];
  if (!def) return stored(r, key, f.type);
  const formula = () => { const out = evalFormula(def.formula, r, c, key); return out instanceof FormulaError ? '#ERROR' : out; };
  if (r.summary) {
    if (def.summary === 'formula') return def.formula ? formula() : stored(r, key, f.type);
    if (def.summary === 'none') return stored(r, key, f.type);
    return rollup(r, c, key, def);
  }
  return def.formula ? formula() : stored(r, key, f.type);
}

function rollup(r: Row, c: FCtx, key: string, def: CustomFieldDef): FRaw {
  const f = FIELD.get(key)!;
  const kids = r.children.map(i => c.s.rows[i]).filter(k => !(def.summary === 'countNon' && k.summary));
  const vals = kids.map(k => customValue(k, c, key));
  const nums = vals.filter((v): v is number | boolean => typeof v === 'number' || typeof v === 'boolean').map(v => Number(v));
  if (f.type === 'flag') {
    if (def.summary === 'max' || def.summary === 'or') return vals.some(v => v === true);
    if (def.summary === 'min' || def.summary === 'and') return vals.every(v => v === true);
  }
  switch (def.summary) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'max': return f.type === 'date' ? maxDate(vals) : nums.length ? Math.max(...nums) : EMPTY[f.type];
    case 'min': return f.type === 'date' ? minDate(vals) : nums.length ? Math.min(...nums) : EMPTY[f.type];
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'count': case 'countNon': {
      // Count All counts every subtask below; Count Nonsummary counts leaf tasks only.
      let n = 0;
      const walk = (row: Row) => row.children.forEach(i => { const k = c.s.rows[i]; if (!(def.summary === 'countNon' && k.summary)) n++; if (k.summary) walk(k); });
      walk(r);
      return n;
    }
    case 'and': return vals.every(v => v === true);
    case 'or': return vals.some(v => v === true);
  }
  return stored(r, key, f.type);
}
const maxDate = (v: FRaw[]) => { const d = v.filter((x): x is number => typeof x === 'number'); return d.length ? Math.max(...d) : null; };
const minDate = (v: FRaw[]) => { const d = v.filter((x): x is number => typeof x === 'number'); return d.length ? Math.min(...d) : null; };

export function formulaEnv(r: Row, c: FCtx): FormulaEnv {
  const set = c.p.settings;
  const cal = (name?: string) => (name ? c.s.calendars.get(c.p.calendars.find(x => x.name.toLowerCase() === name.toLowerCase())?.id ?? c.p.calendar) : c.s.calendars.get(r.task.calendar, c.p.calendar));
  return {
    field(name) {
      if (name.toLowerCase() === 'project summary task' || name.toLowerCase() === 'project') return c.p.name;
      const f = findField(name, c.p);
      if (!f) throw new FormulaError('Unknown field [' + name + '].');
      const v = f.key === 'preds' || f.key === 'succs' ? predText(r, c, f.key) : f.get(r, c);
      return toVal(v, f.type);
    },
    dateAdd: (t, m, n) => (m >= 0 ? cal(n).add(t, m) : cal(n).sub(t, -m)),
    workBetween: (a, b, n) => cal(n).workBetween(a, b),
    formatDate: t => fmtDate(t, { time: true, format: set.dateFormat, weekday: false }),
    formatDuration: (m, unit) => formatDuration({ minutes: m, unit: UNIT_OF[unit ?? 7] ?? set.durationUnit, elapsed: unit != null && unit % 2 === 0 && unit < 13, estimated: false }, set),
    parseDuration: t => parseDuration(t, set, set.durationUnit)?.minutes ?? null,
    parseDate: t => { const d = parseDateText(t, set.dateFormat); return d ? atDay(d.day, d.minute ?? set.defaultStart) : null; },
    now: () => Math.round(Date.now() / 60000) - new Date().getTimezoneOffset()
  };
}
const UNIT_OF: Record<number, DurUnit> = { 3: 'm', 4: 'm', 5: 'h', 6: 'h', 7: 'd', 8: 'd', 9: 'w', 10: 'w', 11: 'mo', 12: 'mo' };

function predText(r: Row, c: FCtx, key: string): string {
  const id = (u: number) => c.s.byUid.get(u)?.id;
  if (key === 'preds') return r.task.preds.map(l => id(l.pred)).filter(x => x != null).join(',');
  const out: number[] = [];
  c.s.rows.forEach(x => { if (x.task.preds.some(l => l.pred === r.task.uid)) out.push(x.id); });
  return out.join(',');
}

export function toVal(v: FRaw, t: FType): Val {
  if (t === 'date') return typeof v === 'number' ? new DateV(v) : null;
  return v;
}

// Converts a formula result to the custom field's type.
export function fromVal(v: Val, t: FType): FRaw {
  if (t === 'text') return toStr(v);
  if (t === 'flag') return toBool(v);
  if (t === 'date') return v == null ? null : v instanceof DateV ? v.t : typeof v === 'string' && /^na$/i.test(v.trim()) ? null : Math.round(toNum(v) * 1440);
  return toNum(v);
}

export function evalFormula(src: string, r: Row, c: FCtx, key?: string): FRaw | FormulaError {
  const guard = key ? key + ':' + r.task.uid : '';
  if (guard && evaluating.has(guard)) return new FormulaError('The formula refers to itself.');
  try {
    if (guard) evaluating.add(guard);
    const env = formulaEnv(r, c);
    const v = evaluate(compile(src), env);
    const type = key ? FIELD.get(key)!.type : null;
    if (!type) return v instanceof DateV ? v.t : (v as FRaw);
    if (type === 'text' && v instanceof DateV) return env.formatDate!(v.t);
    if (type === 'text' && v === null) return 'NA';
    return fromVal(v, type);
  } catch (e) {
    return e instanceof FormulaError ? e : new FormulaError(e instanceof Error ? e.message : String(e));
  } finally {
    if (guard) evaluating.delete(guard);
  }
}

/* ---------- graphical indicators ---------- */

export function indicatorFor(def: CustomFieldDef, raw: FRaw, summary: boolean, type: FType): string | null {
  const rules = summary && def.summaryIndicators ? def.summaryIndicators : def.indicators;
  for (const rule of rules) if (testRule(rule.test, raw, rule.value, rule.value2, type)) return rule.icon;
  return null;
}

function testRule(test: string, raw: FRaw, a: string, b: string, type: FType): boolean {
  if (test === 'any') return true;
  const asNum = (s: string): number | null => {
    if (type === 'date') { const d = parseDateText(s, 'dmy'); return d ? atDay(d.day, d.minute ?? 0) : null; }
    if (type === 'duration' || type === 'work') { const d = parseDuration(s); return d ? d.minutes : null; }
    if (type === 'flag') return /^(yes|true|1)$/i.test(s.trim()) ? 1 : 0;
    const n = Number(s.replace(/[$,%]/g, ''));
    return isFinite(n) ? n : null;
  };
  if (type === 'text') {
    const v = String(raw ?? '').toLowerCase(), x = a.toLowerCase(), y = b.toLowerCase();
    switch (test) {
      case 'eq': return v === x; case 'ne': return v !== x; case 'gt': return v > x; case 'ge': return v >= x; case 'lt': return v < x; case 'le': return v <= x;
      case 'between': return v >= x && v <= y; case 'notBetween': return v < x || v > y;
      case 'contains': return v.includes(x); case 'notContains': return !v.includes(x);
    }
    return false;
  }
  const v = raw == null ? null : Number(raw);
  const x = asNum(a), y = asNum(b);
  if (test === 'contains' || test === 'notContains') { const has = String(raw ?? '').toLowerCase().includes(a.toLowerCase()); return test === 'contains' ? has : !has; }
  if (v == null || x == null) return test === 'ne' ? v !== x : test === 'eq' ? v === x : false;
  switch (test) {
    case 'eq': return Math.abs(v - x) < 1e-9; case 'ne': return Math.abs(v - x) >= 1e-9;
    case 'gt': return v > x; case 'ge': return v >= x; case 'lt': return v < x; case 'le': return v <= x;
    case 'between': return y != null && v >= x && v <= y; case 'notBetween': return y != null && (v < x || v > y);
  }
  return false;
}

/* ---------- parsing typed values for custom fields ---------- */

export function parseCustom(type: CFType, text: string, p: Project): { value: CustomValue } | { error: string } {
  const tx = text.trim(), s = p.settings;
  if (tx === '') return { value: null };
  switch (type) {
    case 'Text': return { value: text };
    case 'Flag': return /^(yes|true|1|y)$/i.test(tx) ? { value: true } : /^(no|false|0|n)$/i.test(tx) ? { value: false } : { error: 'Enter Yes or No.' };
    case 'Number': case 'Cost': { const n = Number(tx.replace(/[^\d.eE+-]/g, '')); return isFinite(n) && /\d/.test(tx) ? { value: n } : { error: 'Enter a number.' }; }
    case 'Duration': { const d = parseDuration(tx, s, s.durationUnit); return d ? { value: d.minutes } : { error: 'Enter a duration such as 3d or 4h.' }; }
    default: {
      if (/^na$/i.test(tx)) return { value: null };
      const d = parseDateText(tx, s.dateFormat);
      return d ? { value: atDay(d.day, d.minute ?? (type === 'Finish' ? s.defaultFinish : s.defaultStart)) } : { error: 'Enter a date such as 12 Jan 26.' };
    }
  }
}

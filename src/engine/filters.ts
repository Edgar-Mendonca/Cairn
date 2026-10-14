// Filters and groups (View › Filter, View › Group By), with standard names. Built-in filters are code;
// your own filters are criteria on any field (AND/OR, as in the filter editor) and are saved with the plan.
// Values written as "?Prompt" ask for a value when the filter is applied (interactive filters).
import type { Criterion, FilterDef, FilterTest, GroupDef, Project } from './model';
import { FIELD, type FCtx, type FRaw, type FType } from './fields';
import type { Row } from './schedule';
import { parseDuration } from './duration';
import { atDay, parseDateText, todayMinutes } from './time';

export interface Ask { label: string; kind: 'date' | 'text' | 'number' | 'resource' | 'id' }
export interface BuiltinFilter { id: string; name: string; ask?: Ask[]; summaries?: boolean; noParents?: boolean; hidden?: boolean; test: (r: Row, c: FCtx, args: string[]) => boolean }

const statusOf = (c: FCtx) => c.p.statusDate ?? todayMinutes();
const isLate = (r: Row, c: FCtx) => {
  if (r.percent >= 100) return false;
  const st = statusOf(c);
  const cal = c.s.calendars.get(r.task.calendar, c.p.calendar);
  const expected = r.duration > 0 ? Math.min(1, Math.max(0, cal.workBetween(r.start, st) / r.duration)) : st >= r.start ? 1 : 0;
  return r.percent / 100 < expected - 1e-6;
};
const resNames = (r: Row, c: FCtx) => r.task.assignments.map(a => c.p.resources.find(x => x.uid === a.res)?.name || '');
const dateArg = (c: FCtx, s: string, end = false): number | null => { const d = parseDateText(s, c.p.settings.dateFormat); return d ? atDay(d.day, d.minute ?? (end ? 1440 : 0)) : null; };

export const BUILTIN_FILTERS: BuiltinFilter[] = [
  { id: 'all', name: 'All tasks', test: () => true },
  { id: 'active', name: 'Tasks that are on', test: r => r.task.active },
  { id: 'completed', name: 'Completed tasks', test: r => r.percent >= 100 },
  { id: 'costOver', name: 'Cost overbudget', test: r => !!r.baseline && r.cost > r.baseline.cost + 0.005 },
  { id: 'costGreater', name: 'Cost greater than…', ask: [{ label: 'Show tasks whose cost is greater than', kind: 'number' }], test: (r, _c, a) => r.cost > Number(a[0].replace(/[^\d.-]/g, '')) },
  { id: 'createdAfter', name: 'Created after…', ask: [{ label: 'Show tasks created on or after', kind: 'date' }], test: (r, c, a) => { const d = dateArg(c, a[0]); return !!r.task.created && d != null && Date.parse(r.task.created) / 60000 >= d - 1440; } },
  { id: 'critical', name: 'Critical', test: r => r.critical },
  { id: 'dateRange', name: 'Date range…', ask: [{ label: 'Show tasks that start or finish after', kind: 'date' }, { label: 'And before', kind: 'date' }], test: (r, c, a) => { const x = dateArg(c, a[0]), y = dateArg(c, a[1], true); return x != null && y != null && r.finish >= x && r.start <= y; } },
  { id: 'inactive', name: 'Turned-off tasks', test: r => !r.task.active },
  { id: 'incomplete', name: 'Incomplete tasks', test: r => r.percent < 100 },
  { id: 'inProgress', name: 'In progress tasks', test: r => r.percent > 0 && r.percent < 100 },
  { id: 'late', name: 'Late tasks', test: isLate },
  { id: 'lateMilestones', name: 'Late milestones', test: (r, c) => !r.summary && r.duration === 0 && (isLate(r, c) || (!!r.baseline && r.finish > r.baseline.finish)) },
  { id: 'manual', name: 'Pinned tasks', test: r => r.task.mode === 'manual' },
  { id: 'milestones', name: 'Milestones', test: r => !r.summary && r.duration === 0 },
  { id: 'overallocated', name: 'Over-capacity tasks', test: r => r.indicators.includes('overallocated') },
  { id: 'resourceGroup', name: 'Resource group…', ask: [{ label: 'Group name', kind: 'text' }], test: (r, c, a) => r.task.assignments.some(x => (c.p.resources.find(y => y.uid === x.res)?.group || '').toLowerCase() === a[0].trim().toLowerCase()) },
  { id: 'shouldStart', name: 'Should start by…', ask: [{ label: 'Show tasks that should have started by', kind: 'date' }], test: (r, c, a) => { const d = dateArg(c, a[0], true); return d != null && r.start <= d && r.actualStart == null; } },
  { id: 'slipping', name: 'Slipping tasks', test: r => r.percent < 100 && !!r.baseline && r.finish > r.baseline.finish },
  { id: 'summary', name: 'Phases', summaries: true, test: r => r.summary },
  { id: 'taskRange', name: 'Task range…', ask: [{ label: 'Show tasks with IDs from', kind: 'id' }, { label: 'To', kind: 'id' }], test: (r, _c, a) => r.id >= Number(a[0]) && r.id <= Number(a[1]) },
  { id: 'estimated', name: 'Tasks with estimated durations', test: r => r.task.estimated && !r.summary },
  { id: 'deadlines', name: 'Tasks with deadlines', test: r => r.task.deadline != null },
  { id: 'fixedDates', name: 'Tasks with fixed dates', test: r => (r.task.constraint !== 'ASAP' && r.task.constraint !== 'ALAP') || r.actualStart != null },
  { id: 'taskCalendar', name: 'Tasks with their own calendar', test: r => !!r.task.calendar },
  { id: 'attachments', name: 'Tasks with notes or links', test: r => !!r.task.notes || !!r.task.hyperlink },
  { id: 'topLevel', name: 'Top-level tasks', summaries: true, test: r => r.task.level === 1 },
  { id: 'unstarted', name: 'Unstarted tasks', test: r => r.percent === 0 && r.actualStart == null },
  { id: 'usingResource', name: 'Assigned to…', ask: [{ label: 'Show tasks using', kind: 'resource' }], test: (r, c, a) => resNames(r, c).some(n => n.toLowerCase() === a[0].trim().toLowerCase()) },
  { id: 'usingResourceRange', name: 'Assigned to, in a date range…', ask: [{ label: 'Show tasks using', kind: 'resource' }, { label: 'Between', kind: 'date' }, { label: 'And', kind: 'date' }], test: (r, c, a) => { const x = dateArg(c, a[1]), y = dateArg(c, a[2], true); return resNames(r, c).some(n => n.toLowerCase() === a[0].trim().toLowerCase()) && x != null && y != null && r.finish >= x && r.start <= y; } },
  { id: 'workOver', name: 'Work overbudget', test: r => !!r.baseline && r.work > r.baseline.work + 0.5 },
  { id: 'nonSummary', name: 'Hide phases', hidden: true, noParents: true, test: r => !r.summary }
];
export const FILTER_BY_ID = new Map(BUILTIN_FILTERS.map(f => [f.id, f]));

/* ---------- criteria (your own filters) ---------- */

export const TEST_NAMES: Record<FilterTest, string> = {
  eq: 'equals', ne: 'does not equal', gt: 'is greater than', ge: 'is greater than or equal to', lt: 'is less than', le: 'is less than or equal to',
  within: 'is within', notWithin: 'is not within', contains: 'contains', notContains: 'does not contain', exact: 'contains exactly'
};

// Turns typed text into a comparable value of the field's type.
export function valueOf(text: string, type: FType, p: Project): number | string | null {
  const t = text.trim();
  if (type === 'date') { if (/^na$/i.test(t)) return null; const d = parseDateText(t, p.settings.dateFormat); return d ? atDay(d.day, d.minute ?? 0) : null; }
  if (type === 'duration' || type === 'work') { const d = parseDuration(t, p.settings, type === 'work' ? p.settings.workUnit : p.settings.durationUnit); return d ? d.minutes : null; }
  if (type === 'flag') return /^(yes|true|1)$/i.test(t) ? 1 : 0;
  if (type === 'text') return t.toLowerCase();
  const n = Number(t.replace(/[^\d.eE+-]/g, ''));
  return t !== '' && isFinite(n) ? n : null;
}

function cmpRaw(v: FRaw, type: FType): number | string | null {
  if (v == null) return null;
  if (type === 'text') return String(v).toLowerCase();
  if (type === 'flag') return v ? 1 : 0;
  return typeof v === 'number' ? v : Number(v);
}

export function testCriterion(r: Row, c: FCtx, cr: Criterion, args: Map<string, string>): boolean {
  const f = FIELD.get(cr.field);
  if (!f) return false;
  const resolve = (s: string) => (s.startsWith('?') ? args.get(s) ?? '' : s);
  const raw = f.key === 'resources' ? resNames(r, c).join(', ') : f.get(r, c);
  const v = cmpRaw(raw, f.type);
  const a = valueOf(resolve(cr.value), f.type, c.p), b = valueOf(resolve(cr.value2), f.type, c.p);
  const text = String(raw ?? '').toLowerCase(), needle = resolve(cr.value).trim().toLowerCase();
  switch (cr.test) {
    case 'contains': return text.includes(needle);
    case 'notContains': return !text.includes(needle);
    case 'exact': return text.split(/\s*,\s*/).includes(needle);
  }
  // Number of minutes for date "equals" compares the whole day.
  if (f.type === 'date' && (cr.test === 'eq' || cr.test === 'ne') && typeof v === 'number' && typeof a === 'number') {
    const same = Math.floor(v / 1440) === Math.floor(a / 1440);
    return cr.test === 'eq' ? same : !same;
  }
  if (v == null || a == null) return cr.test === 'eq' ? v === a : cr.test === 'ne' ? v !== a : false;
  switch (cr.test) {
    case 'eq': return typeof v === 'number' ? Math.abs(v - (a as number)) < 1e-6 : v === a;
    case 'ne': return typeof v === 'number' ? Math.abs(v - (a as number)) >= 1e-6 : v !== a;
    case 'gt': return v > a; case 'ge': return v >= a; case 'lt': return v < a; case 'le': return v <= a;
    case 'within': return b != null && v >= a && v <= b;
    case 'notWithin': return b != null && (v < a || v > b);
  }
  return false;
}

// AND binds tighter than OR.
export function testFilter(r: Row, c: FCtx, f: FilterDef, args: Map<string, string>): boolean {
  if (!f.criteria.length) return true;
  let any = false, all = true;
  f.criteria.forEach((cr, k) => {
    if (k > 0 && cr.join === 'or') { any = any || all; all = true; }
    all = all && testCriterion(r, c, cr, args);
  });
  return any || all;
}

export function promptsOf(f: FilterDef): string[] {
  const out: string[] = [];
  f.criteria.forEach(c => [c.value, c.value2].forEach(v => { if (v.startsWith('?') && !out.includes(v)) out.push(v); }));
  return out;
}

/* ---------- groups ---------- */

export const BUILTIN_GROUPS: GroupDef[] = [
  { id: 'activeInactive', name: 'On vs off', keys: [{ field: 'active', desc: true }], summaries: false },
  { id: 'autoManual', name: 'Auto vs pinned', keys: [{ field: 'mode', desc: false }], summaries: false },
  { id: 'completion', name: 'Complete and incomplete tasks', keys: [{ field: 'completion', desc: false }], summaries: false },
  { id: 'constraint', name: 'Constraint type', keys: [{ field: 'constraint', desc: false }], summaries: false },
  { id: 'critical', name: 'Critical', keys: [{ field: 'critical', desc: true }], summaries: false },
  { id: 'duration', name: 'Duration', keys: [{ field: 'duration', desc: false }], summaries: false },
  { id: 'durationPriority', name: 'Duration then priority', keys: [{ field: 'duration', desc: false }, { field: 'priority', desc: true }], summaries: false },
  { id: 'milestones', name: 'Milestones', keys: [{ field: 'milestone', desc: true }], summaries: false },
  { id: 'priority', name: 'Priority', keys: [{ field: 'priority', desc: true }], summaries: false },
  { id: 'resource', name: 'Assigned to', keys: [{ field: 'resources', desc: false }], summaries: false },
  { id: 'status', name: 'Status', keys: [{ field: 'status', desc: false }], summaries: false },
  { id: 'level1', name: 'Outline level', keys: [{ field: 'outlineLevel', desc: false }], summaries: true }
];
export const GROUP_BY_ID = new Map(BUILTIN_GROUPS.map(g => [g.id, g]));

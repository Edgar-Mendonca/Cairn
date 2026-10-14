// Project XML (MSPDI) import and export.
//
// MSPDI is the XML exchange format most desktop schedulers read and write. Units used by the format:
// durations are ISO 8601 ("PT16H0M0S", clock hours for elapsed durations), lags and balancing delay are tenths
// of a minute, currency amounts are hundredths, resource units are fractions (1 = 100%), rates are per hour.
// Cairn stores time in minutes, so most values map directly. Anything that cannot be
// represented is listed in the import report.
import { cleanTimes, type CalendarDef, type CalendarException, type WorkingTime } from './calendar';
import type { DurUnit } from './duration';
import { ALL_CUSTOM_FIELDS, blankFieldDef, blankProject, cfType, newResource, newTask, normalizeProject, type SummaryCalc, type Baseline, type ConstraintType, type LinkType, type Project, type Resource, type Task, type TaskType } from './model';
import { schedule, type Schedule } from './schedule';
import { isoDateTime, parseIso, todayMinutes } from './time';
import { child, children, escXml, flag, num, parseXml, text, type XmlNode } from './xml';

// Field IDs of the task custom fields (ExtendedAttribute FieldID).
const ID_RANGES: [string, number[]][] = [
  ['Text', [188743731, 188743734, 188743737, 188743740, 188743743, 188743746, 188743747, 188743748, 188743749, 188743750, ...range(188743997, 20)]],
  ['Number', [188743767, 188743768, 188743769, 188743770, 188743771, ...range(188743982, 15)]],
  ['Flag', [...range(188743752, 10), ...range(188743972, 10)]],
  ['Cost', [188743786, 188743787, 188743788, ...range(188743938, 7)]],
  ['Date', range(188743945, 10)],
  ['Duration', [188743783, 188743784, 188743785, ...range(188743955, 7)]],
  ['Start', [188743732, 188743735, 188743738, 188743741, 188743744, 188743962, 188743964, 188743966, 188743968, 188743970]],
  ['Finish', [188743733, 188743736, 188743739, 188743742, 188743745, 188743963, 188743965, 188743967, 188743969, 188743971]]
];
function range(from: number, n: number) { return Array.from({ length: n }, (_, i) => from + i); }
export const FIELD_ID: Record<string, number> = Object.fromEntries(ID_RANGES.flatMap(([t, ids]) => ids.map((id, i) => [t + (i + 1), id])));
const FIELD_KEY_BY_ID = new Map(Object.entries(FIELD_ID).map(([k, id]) => [String(id), k]));
// MSPDI RollupType: 0 maximum/OR, 1 minimum/AND, 2 count all, 3 sum, 4 average, 7 count nonsummaries.
const ROLLUP_FROM_XML: Record<number, SummaryCalc> = { 0: 'max', 1: 'min', 2: 'count', 3: 'sum', 4: 'avg', 5: 'avg', 6: 'count', 7: 'countNon' };
const ROLLUP_TO_XML: Partial<Record<SummaryCalc, number>> = { max: 0, or: 0, min: 1, and: 1, count: 2, sum: 3, avg: 4, countNon: 7 };

export interface ImportReport { source: string; tasks: number; resources: number; assignments: number; links: number; calendars: number; notes: string[] }

const CONSTRAINTS: ConstraintType[] = ['ASAP', 'ALAP', 'MSO', 'MFO', 'SNET', 'SNLT', 'FNET', 'FNLT'];
const LINK_FROM_XML: LinkType[] = ['FF', 'FS', 'SF', 'SS'];
const LINK_TO_XML: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const TASK_TYPES: TaskType[] = ['FixedUnits', 'FixedDuration', 'FixedWork'];

// Duration formats: 3 m, 4 em, 5 h, 6 eh, 7 d, 8 ed, 9 w, 10 ew, 11 mo, 12 emo, 19 %, 20 e%; 35–44 are the estimated versions; 53 = days.
function fmtInfo(code: number): { unit: DurUnit; elapsed: boolean; estimated: boolean; percent: boolean } {
  let c = code, estimated = false;
  if (c >= 35 && c <= 44) { c -= 32; estimated = true; }
  if (c === 53) c = 7;
  const map: Record<number, [DurUnit, boolean]> = { 3: ['m', false], 4: ['m', true], 5: ['h', false], 6: ['h', true], 7: ['d', false], 8: ['d', true], 9: ['w', false], 10: ['w', true], 11: ['mo', false], 12: ['mo', true] };
  if (c === 19 || c === 20) return { unit: 'd', elapsed: c === 20, estimated, percent: true };
  const [unit, elapsed] = map[c] || ['d', false];
  return { unit, elapsed, estimated, percent: false };
}
function fmtCode(unit: DurUnit, elapsed: boolean, estimated: boolean): number {
  const base = { m: 3, h: 5, d: 7, w: 9, mo: 11 }[unit] + (elapsed ? 1 : 0);
  return estimated ? base + 32 : base;
}

// ISO 8601 duration -> minutes. A "D" part counts as working days of `mpd` minutes.
export function isoMinutes(s: string, mpd = 480): number | null {
  const m = /^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m || s.trim() === 'P' || s.trim() === 'PT') return null;
  const v = (+m[2] || 0) * mpd + (+m[3] || 0) * 60 + (+m[4] || 0) + (+m[5] || 0) / 60;
  return m[1] ? -v : v;
}
export function minutesIso(min: number): string {
  const total = Math.round(Math.max(0, min) * 60);
  return 'PT' + Math.floor(total / 3600) + 'H' + Math.floor((total % 3600) / 60) + 'M' + (total % 60) + 'S';
}

const timeOf = (s: string) => { const m = /^(\d{2}):(\d{2})/.exec(s); return m ? +m[1] * 60 + +m[2] : null; };
function readTimes(el: XmlNode | undefined): WorkingTime[] {
  const out: WorkingTime[] = [];
  children(child(el, 'WorkingTimes'), 'WorkingTime').forEach(w => {
    const a = timeOf(text(w, 'FromTime')), b = timeOf(text(w, 'ToTime'));
    if (a == null || b == null) return;
    out.push({ from: a, to: b <= a ? b + 1440 : b }); // a shift ending at midnight is written 00:00
  });
  return cleanTimes(out);
}
const dateOnly = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');
const when = (s: string) => parseIso(s);

export function looksLikeProjectXml(content: string): boolean {
  return /<Project[\s>]/.test(content.slice(0, 3000)) && /schemas\.microsoft\.com\/project|<SaveVersion>|<Tasks>/.test(content.slice(0, 30000));
}

export function fromProjectXml(xmlText: string, sourceName = 'Project XML'): { p: Project; report: ImportReport } {
  const proj = parseXml(xmlText);
  if (proj.name !== 'Project' || !child(proj, 'Tasks')) throw new Error('This is not a project XML file (expected a <Project> with <Tasks>).');
  const notes: string[] = [];
  const p = blankProject();
  const st = p.settings;
  st.minutesPerDay = num(proj, 'MinutesPerDay', 480) || 480;
  st.minutesPerWeek = num(proj, 'MinutesPerWeek', st.minutesPerDay * 5) || 2400;
  st.daysPerMonth = num(proj, 'DaysPerMonth', 20) || 20;
  st.defaultStart = timeOf(text(proj, 'DefaultStartTime')) ?? 480;
  st.defaultFinish = timeOf(text(proj, 'DefaultFinishTime')) ?? 1020;
  if (child(proj, 'NewTasksAreManual')) st.newTaskMode = flag(proj, 'NewTasksAreManual') ? 'manual' : 'auto';
  st.defaultType = TASK_TYPES[num(proj, 'DefaultTaskType', 0)] || 'FixedUnits';
  st.effortDriven = flag(proj, 'NewTasksEffortDriven');
  if (child(proj, 'HonorConstraints')) st.honorConstraints = flag(proj, 'HonorConstraints');
  st.criticalSlack = num(proj, 'CriticalSlackLimit', 0) * st.minutesPerDay;
  st.currency = text(proj, 'CurrencySymbol') || text(proj, 'CurrencyCode') || st.currency;
  p.name = text(proj, 'Title') || text(proj, 'Name').replace(/\.(xml|mpp)$/i, '') || 'Imported project';
  p.subject = text(proj, 'Subject');
  p.company = text(proj, 'Company');
  p.manager = text(proj, 'Manager') || text(proj, 'Author');
  p.start = when(text(proj, 'StartDate')) ?? p.start;
  p.statusDate = when(text(proj, 'StatusDate'));
  if (child(proj, 'ScheduleFromStart') && !flag(proj, 'ScheduleFromStart')) notes.push('The project was scheduled from its finish date. Cairn schedules forward from the start date, so dates may differ.');

  // Calendars
  let recurring = 0;
  const calId = (uid: string) => 'cal-' + uid;
  const cals: CalendarDef[] = children(child(proj, 'Calendars'), 'Calendar').map(c => {
    const base = text(c, 'BaseCalendarUID');
    const def: CalendarDef = { id: calId(text(c, 'UID')), name: text(c, 'Name') || 'Calendar ' + text(c, 'UID'), base: base && base !== '-1' ? calId(base) : null, week: [null, null, null, null, null, null, null], exceptions: [] };
    const seen = new Set<string>();
    const addEx = (ex: CalendarException) => { const k = ex.start + ex.finish; if (!seen.has(k)) { seen.add(k); def.exceptions.push(ex); } };
    children(child(c, 'WeekDays'), 'WeekDay').forEach(wd => {
      const type = num(wd, 'DayType', -1);
      if (type >= 1 && type <= 7) {
        if (!child(wd, 'DayWorking')) return;
        def.week[type - 1] = flag(wd, 'DayWorking') ? readTimes(wd) : [];
      } else if (type === 0) {
        const tp = child(wd, 'TimePeriod');
        if (tp) addEx({ name: 'Exception', start: dateOnly(text(tp, 'FromDate')), finish: dateOnly(text(tp, 'ToDate')), times: flag(wd, 'DayWorking') ? readTimes(wd) : [] });
      }
    });
    children(child(c, 'Exceptions'), 'Exception').forEach(ex => {
      const tp = child(ex, 'TimePeriod');
      if (!tp) return;
      if (num(ex, 'Type', 1) !== 1) { recurring++; return; }
      addEx({ name: text(ex, 'Name') || 'Exception', start: dateOnly(text(tp, 'FromDate')), finish: dateOnly(text(tp, 'ToDate')), times: flag(ex, 'DayWorking') ? readTimes(ex) : [] });
    });
    if (!def.base) def.week = def.week.map((w, i) => w ?? (i === 0 || i === 6 ? [] : [{ from: 480, to: 720 }, { from: 780, to: 1020 }]));
    return def;
  });
  if (cals.length) {
    p.calendars = cals;
    const pc = calId(text(proj, 'CalendarUID') || '1');
    p.calendar = cals.some(c => c.id === pc) ? pc : cals.find(c => !c.base)?.id || cals[0].id;
  }
  if (recurring) notes.push(recurring + ' recurring calendar exception(s) were not imported. One-off exceptions were.');

  // Custom fields (task fields only): definitions with alias, formula and summary calculation, then task values.
  const fieldMap = new Map<string, string>();
  let otherFields = 0;
  const defsEl = children(child(proj, 'ExtendedAttributes'), 'ExtendedAttribute');
  defsEl.forEach(ea => {
    const id = text(ea, 'FieldID');
    const key = FIELD_KEY_BY_ID.get(id) || (cfType(text(ea, 'FieldName').replace(/\s/g, '')) ? text(ea, 'FieldName').replace(/\s/g, '') : '');
    if (!key) { if (+id >= 188743680 && +id < 205520896) otherFields++; return; }
    fieldMap.set(id, key);
    const def = blankFieldDef();
    def.alias = text(ea, 'Alias');
    def.formula = text(ea, 'Formula');
    const calc = num(ea, 'CalculationType', 0), roll = num(ea, 'RollupType', -1);
    def.summary = calc === 2 ? 'formula' : calc === 1 ? (ROLLUP_FROM_XML[roll] ?? 'none') : 'none';
    def.restrict = flag(ea, 'RestrictValues');
    def.values = children(child(ea, 'ValueList'), 'Value').map(v => ({ value: text(v, 'Value'), desc: text(v, 'Description') })).filter(v => v.value);
    if (def.alias || def.formula || def.summary !== 'none' || def.values.length) p.fields[key] = def;
  });
  if (otherFields) notes.push(otherFields + ' custom field type(s) such as outline codes were not imported.');
  let formulas = 0;
  Object.values(p.fields).forEach(f => { if (f.formula) formulas++; });
  if (formulas) notes.push(formulas + ' custom field formula(s) were imported. Check their results: Cairn supports the common functions, and #ERROR marks any it does not.');

  // Tasks in ID order; UID 0 / outline level 0 is the project phase.
  const xmlTasks = children(child(proj, 'Tasks'), 'Task').filter(t => text(t, 'UID') !== '' && num(t, 'OutlineLevel', 1) >= 1).sort((a, b) => num(a, 'ID') - num(b, 'ID'));
  const uidMap = new Map<string, Task>();
  const pairs: [XmlNode, Task][] = [];
  let blanks = 0, external = 0, levelDelay = 0;
  xmlTasks.forEach(xt => {
    if (flag(xt, 'IsNull')) { blanks++; return; }
    const manual = flag(xt, 'Manual');
    const fi = fmtInfo(num(xt, 'DurationFormat', 7));
    const durText = manual && text(xt, 'ManualDuration') ? text(xt, 'ManualDuration') : text(xt, 'Duration');
    const minutes = Math.max(0, isoMinutes(durText, st.minutesPerDay) ?? 0);
    const t = newTask(p, {
      name: text(xt, 'Name'), level: Math.max(1, num(xt, 'OutlineLevel', 1)), active: !child(xt, 'Active') || flag(xt, 'Active'),
      mode: manual ? 'manual' : 'auto', type: TASK_TYPES[num(xt, 'Type', 0)] || 'FixedUnits', effortDriven: flag(xt, 'EffortDriven') || num(xt, 'Type', 0) === 2,
      duration: minutes, durUnit: fi.unit, elapsed: fi.elapsed, estimated: flag(xt, 'Estimated') || fi.estimated, milestone: flag(xt, 'Milestone'),
      start: manual ? when(text(xt, 'ManualStart') || text(xt, 'Start')) : null,
      priority: Math.max(0, Math.min(1000, num(xt, 'Priority', 500))), percent: Math.max(0, Math.min(100, num(xt, 'PercentComplete'))),
      actualStart: when(text(xt, 'ActualStart')), actualFinish: when(text(xt, 'ActualFinish')), fixedCost: num(xt, 'FixedCost') / 100,
      deadline: when(text(xt, 'Deadline')), notes: text(xt, 'Notes')
    });
    t.constraint = CONSTRAINTS[num(xt, 'ConstraintType', 0)] || 'ASAP';
    t.constraintDate = t.constraint === 'ASAP' || t.constraint === 'ALAP' ? null : when(text(xt, 'ConstraintDate'));
    if (t.constraintDate == null && t.constraint !== 'ALAP') t.constraint = 'ASAP';
    const cal = text(xt, 'CalendarUID');
    if (cal && cal !== '-1' && p.calendars.some(c => c.id === calId(cal))) t.calendar = calId(cal);
    const ld = num(xt, 'LevelingDelay') / 10;
    // Hyperlink, contact, accrual, earned value method and display flags.
    if (text(xt, 'Hyperlink') || text(xt, 'HyperlinkAddress')) t.hyperlink = { text: text(xt, 'Hyperlink'), address: text(xt, 'HyperlinkAddress'), sub: text(xt, 'HyperlinkSubAddress') };
    if (text(xt, 'Contact')) t.contact = text(xt, 'Contact');
    const acc = num(xt, 'FixedCostAccrual', 2);
    if (acc === 1 || acc === 3) t.accrual = acc === 1 ? 'start' : 'end';
    if (num(xt, 'EarnedValueMethod', 0) === 1) t.evMethod = 'physical';
    if (num(xt, 'PhysicalPercentComplete', 0) > 0) t.physPercent = Math.min(100, num(xt, 'PhysicalPercentComplete', 0));
    if (flag(xt, 'HideBar')) t.hideBar = true;
    if (flag(xt, 'Rollup')) t.rollup = true;
    if (child(xt, 'DisplayOnTimeline') && flag(xt, 'DisplayOnTimeline')) t.timeline = true;
    if (ld > 0) { levelDelay++; t.levelDelay = fmtInfo(num(xt, 'LevelingDelayFormat', 8)).elapsed ? ld * st.minutesPerDay / 1440 : ld; }
    if (flag(xt, 'IsSubproject') || flag(xt, 'ExternalTask')) external++;
    children(xt, 'ExtendedAttribute').forEach(ea => {
      const key = fieldMap.get(text(ea, 'FieldID')) || FIELD_KEY_BY_ID.get(text(ea, 'FieldID'));
      const type = key ? cfType(key) : null;
      if (!key || !type) return;
      const v = text(ea, 'Value');
      if (v === '') return;
      if (type === 'Text') t.custom[key] = v;
      else if (type === 'Flag') t.custom[key] = v === '1' || /^(true|yes)$/i.test(v);
      else if (type === 'Number') { if (isFinite(+v)) t.custom[key] = +v; }
      else if (type === 'Cost') { if (isFinite(+v)) t.custom[key] = +v / 100; }
      else if (type === 'Duration') { const m = isoMinutes(v, st.minutesPerDay); if (m != null) t.custom[key] = m; }
      else { const d = when(v); if (d != null) t.custom[key] = d; }
    });
    uidMap.set(text(xt, 'UID'), t);
    p.tasks.push(t);
    pairs.push([xt, t]);
  });

  // Links
  let links = 0, dropped = 0;
  pairs.forEach(([xt, t]) => {
    children(xt, 'PredecessorLink').forEach(pl => {
      const from = uidMap.get(text(pl, 'PredecessorUID'));
      if (!from || flag(pl, 'CrossProject') || from === t) { dropped++; return; }
      const fi = fmtInfo(num(pl, 'LagFormat', 7));
      const raw = num(pl, 'LinkLag');
      t.preds.push({ pred: from.uid, type: LINK_FROM_XML[num(pl, 'Type', 1)] || 'FS', lag: fi.percent ? raw / 10 : raw / 10, lagUnit: fi.unit, lagElapsed: fi.elapsed, lagPercent: fi.percent });
      links++;
    });
  });

  // Baselines 0–10
  pairs.forEach(([xt, t]) => {
    children(xt, 'Baseline').forEach(b => {
      const k = num(b, 'Number', 0), bs = when(text(b, 'Start')), bf = when(text(b, 'Finish'));
      if (k < 0 || k > 10 || bs == null || bf == null) return;
      const bl: Baseline = p.baselines[k] || (p.baselines[k] = { savedAt: text(proj, 'LastSaved') || new Date().toISOString(), tasks: {} });
      bl.tasks[t.uid] = { start: bs, finish: bf, duration: isoMinutes(text(b, 'Duration'), st.minutesPerDay) ?? 0, work: isoMinutes(text(b, 'Work'), st.minutesPerDay) ?? 0, cost: num(b, 'Cost') / 100 };
    });
  });

  // Resources (UID 0 is the placeholder for unassigned work).
  const resMap = new Map<string, Resource>();
  children(child(proj, 'Resources'), 'Resource').forEach(xr => {
    const ruid = text(xr, 'UID');
    if (ruid === '0' || flag(xr, 'IsNull') || !text(xr, 'Name')) return;
    const type = (['Material', 'Work', 'Cost'] as const)[num(xr, 'Type', 1)] || 'Work';
    const cal = text(xr, 'CalendarUID');
    const r = newResource(p, {
      name: text(xr, 'Name'), initials: text(xr, 'Initials'), group: text(xr, 'Group'), type, materialLabel: text(xr, 'MaterialLabel'),
      maxUnits: type === 'Work' ? num(xr, 'MaxUnits', 1) : 1, stdRate: Math.max(0, num(xr, 'StandardRate')), ovtRate: Math.max(0, num(xr, 'OvertimeRate')),
      costPerUse: Math.max(0, num(xr, 'CostPerUse') / 100), notes: text(xr, 'Notes'),
      calendar: cal && cal !== '-1' && p.calendars.some(c => c.id === calId(cal)) ? calId(cal) : p.calendar
    });
    const rates = children(child(xr, 'Rates'), 'Rate').filter(x => num(x, 'RateTable', 0) === 0);
    const first = rates.find(x => (text(x, 'RatesFrom') || '') <= '1985');
    if (first) r.stdRate = Math.max(0, num(first, 'StandardRate'));
    r.rates = rates.map(x => ({ from: when(text(x, 'RatesFrom')) ?? 0, rate: Math.max(0, num(x, 'StandardRate')) })).filter(x => x.from > (parseIso('1985-01-01') as number)).sort((a, b) => a.from - b.from);
    p.resources.push(r);
    resMap.set(ruid, r);
  });

  // Assignments
  let assignments = 0, contoured = 0;
  children(child(proj, 'Assignments'), 'Assignment').forEach(xa => {
    const r = resMap.get(text(xa, 'ResourceUID')), t = uidMap.get(text(xa, 'TaskUID'));
    if (!r || !t) return;
    const units = num(xa, 'Units', 1);
    const work = isoMinutes(text(xa, 'Work'), st.minutesPerDay);
    if (num(xa, 'WorkContour', 0) > 0) contoured++;
    t.assignments.push({
      res: r.uid,
      units: r.type === 'Cost' ? 1 : units,
      work: r.type === 'Work' ? (work ?? t.duration * units) : 0,
      cost: r.type === 'Cost' ? num(xa, 'Cost') / 100 : 0
    });
    assignments++;
  });

  const out = normalizeProject(JSON.parse(JSON.stringify(p)));
  const resCalUsed = out.tasks.some(t => t.mode === 'auto' && t.assignments.some(a => { const r = out.resources.find(x => x.uid === a.res); return r && r.type === 'Work' && r.calendar !== (t.calendar || out.calendar); }));
  if (blanks) notes.push(blanks + ' blank row(s) were skipped.');
  if (dropped) notes.push(dropped + ' link(s) to other projects or missing tasks were not imported.');
  if (contoured) notes.push(contoured + ' assignment(s) used work contours; work is spread evenly in Cairn.');
  if (external) notes.push(external + ' subproject or external task(s) were imported as ordinary tasks.');
  if (levelDelay) notes.push(levelDelay + ' balancing delay(s) were imported. Elapsed delays were converted to working time.');
  if (resCalUsed) notes.push('Some resources have their own calendars. The source scheduled their tasks on those calendars; Cairn uses the task or project calendar for now, so some dates may differ.');
  return { p: out, report: { source: sourceName, tasks: out.tasks.length, resources: out.resources.length, assignments, links, calendars: out.calendars.length, notes } };
}

/* ---------- export ---------- */

const pad = (n: number) => (n < 10 ? '0' : '') + n;
const clockOf = (m: number) => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60) + ':00';

export function toProjectXml(p: Project, s: Schedule = schedule(p)): { xml: string; notes: string[] } {
  const notes: string[] = [];
  const st = p.settings, mpd = st.minutesPerDay;
  const out: string[] = [];
  const el = (name: string, v: unknown) => { if (v !== '' && v != null) out.push('<' + name + '>' + escXml(v) + '</' + name + '>'); };
  const dt = (t: number | null) => (t == null ? '' : isoDateTime(t));
  const cur = (v: number) => Math.round((+v || 0) * 100);
  const lagCode = (u: DurUnit, e: boolean) => fmtCode(u, e, false);
  const calUid = new Map(p.calendars.map((c, i) => [c.id, i + 1]));
  const resCalUid = new Map<number, number>();

  // Element order follows the MSPDI schema (xs:sequence), which schedulers check when opening the file.
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<Project xmlns="http://schemas.microsoft.com/project">'); // the format's standard namespace
  el('SaveVersion', 14);
  el('Name', p.name.replace(/[\\/:*?"<>|]+/g, '-') + '.xml');
  el('Title', p.name);
  el('Subject', p.subject);
  el('Company', p.company);
  el('Manager', p.manager);
  el('CreationDate', dt(todayMinutes() + st.defaultStart));
  el('ScheduleFromStart', 1);
  el('StartDate', dt(s.start));
  el('FinishDate', dt(s.finish));
  el('CriticalSlackLimit', Math.round(st.criticalSlack / mpd));
  el('CurrencySymbol', st.currency);
  if (/^[A-Z]{3}$/.test(st.currency)) el('CurrencyCode', st.currency);
  el('CalendarUID', calUid.get(p.calendar) ?? 1);
  el('DefaultStartTime', clockOf(st.defaultStart));
  el('DefaultFinishTime', clockOf(st.defaultFinish));
  el('MinutesPerDay', mpd);
  el('MinutesPerWeek', st.minutesPerWeek);
  el('DaysPerMonth', st.daysPerMonth);
  el('DefaultTaskType', Math.max(0, TASK_TYPES.indexOf(st.defaultType)));
  el('DurationFormat', fmtCode(st.durationUnit, false, false));
  el('HonorConstraints', st.honorConstraints ? 1 : 0);
  el('NewTasksEffortDriven', st.effortDriven ? 1 : 0);
  if (p.statusDate != null) el('StatusDate', dt(p.statusDate));
  el('NewTaskStartDate', 0);

  // Custom field definitions (only fields that are renamed, calculated or used).
  const used = new Set<string>(Object.keys(p.fields));
  p.tasks.forEach(t => Object.keys(t.custom).forEach(k => used.add(k)));
  const defKeys = ALL_CUSTOM_FIELDS.filter(k => used.has(k) && FIELD_ID[k]);
  if (defKeys.length) {
    out.push('<ExtendedAttributes>');
    defKeys.forEach(k => {
      const d = p.fields[k];
      out.push('<ExtendedAttribute>'); el('FieldID', FIELD_ID[k]); el('FieldName', k);
      if (d?.alias) el('Alias', d.alias);
      if (d && d.summary !== 'none') { el('RollupType', d.summary === 'formula' ? 3 : ROLLUP_TO_XML[d.summary] ?? 3); el('CalculationType', d.summary === 'formula' ? 2 : 1); }
      else el('CalculationType', 0);
      if (d?.formula) el('Formula', d.formula);
      if (d?.restrict) el('RestrictValues', 1);
      if (d?.values.length) {
        out.push('<ValueList>');
        d.values.forEach((v, i) => { out.push('<Value>'); el('ID', i + 1); el('Value', v.value); el('Description', v.desc); out.push('</Value>'); });
        out.push('</ValueList>');
      }
      out.push('</ExtendedAttribute>');
    });
    out.push('</ExtendedAttributes>');
  }

  // Calendars: project calendars, then one derived calendar per work resource.
  const times = (list: WorkingTime[]) => {
    out.push('<WorkingTimes>');
    list.forEach(w => { out.push('<WorkingTime>'); el('FromTime', clockOf(w.from)); el('ToTime', clockOf(w.to % 1440)); out.push('</WorkingTime>'); });
    out.push('</WorkingTimes>');
  };
  const writeCal = (uid: number, name: string, base: number | null, week: (WorkingTime[] | null)[], exceptions: CalendarException[]) => {
    out.push('<Calendar>'); el('UID', uid); el('Name', name); el('IsBaseCalendar', base == null ? 1 : 0); el('BaseCalendarUID', base ?? -1);
    if (week.some(w => w)) {
      out.push('<WeekDays>');
      week.forEach((w, d) => { if (!w) return; out.push('<WeekDay>'); el('DayType', d + 1); el('DayWorking', w.length ? 1 : 0); if (w.length) times(w); out.push('</WeekDay>'); });
      out.push('</WeekDays>');
    }
    if (exceptions.length) {
      out.push('<Exceptions>');
      exceptions.forEach(ex => {
        out.push('<Exception>'); el('EnteredByOccurrences', 0);
        out.push('<TimePeriod>'); el('FromDate', ex.start + 'T00:00:00'); el('ToDate', (ex.finish || ex.start) + 'T23:59:00'); out.push('</TimePeriod>');
        el('Occurrences', 1); el('Name', ex.name); el('Type', 1); el('DayWorking', ex.times.length ? 1 : 0);
        if (ex.times.length) times(ex.times);
        out.push('</Exception>');
      });
      out.push('</Exceptions>');
    }
    out.push('</Calendar>');
  };
  out.push('<Calendars>');
  p.calendars.forEach(c => writeCal(calUid.get(c.id)!, c.name, c.base ? calUid.get(c.base) ?? 1 : null, c.week, c.exceptions));
  let next = p.calendars.length + 1;
  p.resources.forEach(r => {
    if (r.type !== 'Work') return;
    const uid = next++;
    resCalUid.set(r.uid, uid);
    writeCal(uid, r.name || 'Resource ' + r.uid, calUid.get(r.calendar) ?? calUid.get(p.calendar) ?? 1, [null, null, null, null, null, null, null], []);
  });
  out.push('</Calendars>');

  // Tasks
  out.push('<Tasks>');
  out.push('<Task>'); el('UID', 0); el('ID', 0); el('Name', p.name); el('Active', 1); el('Manual', 0); el('Type', 1); el('IsNull', 0);
  el('OutlineNumber', 0); el('OutlineLevel', 0); el('Start', dt(s.start)); el('Finish', dt(s.finish)); el('Summary', 1);
  out.push('</Task>');
  s.rows.forEach(r => {
    const t = r.task, ms = r.duration === 0 && !r.summary;
    const manual = t.mode === 'manual';
    out.push('<Task>');
    el('UID', t.uid); el('ID', r.id); el('Name', t.name); el('Active', t.active ? 1 : 0); el('Manual', manual ? 1 : 0);
    el('Type', Math.max(0, TASK_TYPES.indexOf(t.type))); el('IsNull', 0);
    if (t.contact) el('Contact', t.contact);
    el('WBS', r.wbs); el('OutlineNumber', r.outline); el('OutlineLevel', t.level); el('Priority', t.priority);
    el('Start', dt(r.start)); el('Finish', dt(r.finish));
    el('Duration', minutesIso(r.duration));
    if (manual && !r.summary) { el('ManualStart', dt(r.start)); el('ManualFinish', dt(r.finish)); el('ManualDuration', minutesIso(r.duration)); }
    el('DurationFormat', r.summary ? fmtCode(st.durationUnit, false, false) : fmtCode(t.durUnit, t.elapsed, t.estimated));
    el('Work', minutesIso(r.work));
    el('EffortDriven', t.effortDriven ? 1 : 0); el('Estimated', t.estimated ? 1 : 0);
    el('Milestone', t.milestone || ms ? 1 : 0); el('Summary', r.summary ? 1 : 0); el('Critical', r.critical ? 1 : 0);
    el('FixedCost', cur(t.fixedCost)); el('FixedCostAccrual', t.accrual === 'start' ? 1 : t.accrual === 'end' ? 3 : 2);

    el('PercentComplete', Math.round(r.summary ? r.percent : t.percent));
    if (t.actualStart != null) el('ActualStart', dt(t.actualStart));
    if (t.actualFinish != null) el('ActualFinish', dt(t.actualFinish));
    el('ConstraintType', Math.max(0, CONSTRAINTS.indexOf(t.constraint)));
    if (t.calendar) el('CalendarUID', calUid.get(t.calendar) ?? -1);
    if (t.constraintDate != null && t.constraint !== 'ASAP' && t.constraint !== 'ALAP') el('ConstraintDate', dt(t.constraintDate));
    if (t.deadline != null) el('Deadline', dt(t.deadline));
    if (t.levelDelay > 0) { el('LevelingDelay', Math.round(t.levelDelay * 10)); el('LevelingDelayFormat', 7); }
    // Elements follow the order of the MSPDI schema.
    if (t.hyperlink) { el('Hyperlink', t.hyperlink.text); el('HyperlinkAddress', t.hyperlink.address); el('HyperlinkSubAddress', t.hyperlink.sub); }
    el('Notes', t.notes);
    el('HideBar', t.hideBar ? 1 : 0); el('Rollup', t.rollup ? 1 : 0);
    if (t.physPercent) el('PhysicalPercentComplete', Math.round(t.physPercent));
    el('EarnedValueMethod', t.evMethod === 'physical' ? 1 : 0);
    t.preds.forEach(l => {
      if (!s.byUid.has(l.pred)) return;
      out.push('<PredecessorLink>'); el('PredecessorUID', l.pred); el('Type', LINK_TO_XML[l.type]); el('CrossProject', 0);
      el('LinkLag', Math.round(l.lag * 10)); el('LagFormat', l.lagPercent ? (l.lagElapsed ? 20 : 19) : lagCode(l.lagUnit, l.lagElapsed));
      out.push('</PredecessorLink>');
    });
    // Custom field values typed in (formula results are recalculated by the program that opens the file).
    ALL_CUSTOM_FIELDS.forEach(k => {
      const v = t.custom[k];
      if (v == null || !FIELD_ID[k] || p.fields[k]?.formula) return;
      const type = cfType(k)!;
      let val: string;
      if (type === 'Text') val = String(v);
      else if (type === 'Flag') val = v ? '1' : '0';
      else if (type === 'Cost') val = String(Math.round(Number(v) * 100));
      else if (type === 'Duration') val = minutesIso(Number(v));
      else if (type === 'Number') val = String(v);
      else val = dt(Number(v));
      out.push('<ExtendedAttribute>'); el('FieldID', FIELD_ID[k]); el('Value', val);
      if (type === 'Duration') el('DurationFormat', fmtCode(st.durationUnit, false, false));
      out.push('</ExtendedAttribute>');
    });
    p.baselines.forEach((bl, k) => {
      const b = bl?.tasks[t.uid];
      if (!b) return;
      out.push('<Baseline>'); el('Number', k); el('Start', dt(b.start)); el('Finish', dt(b.finish)); el('Duration', minutesIso(b.duration));
      el('DurationFormat', fmtCode(st.durationUnit, false, false)); el('Work', minutesIso(b.work)); el('Cost', cur(b.cost)); out.push('</Baseline>');
    });
    out.push('</Task>');
  });
  out.push('</Tasks>');

  // Resources
  out.push('<Resources>');
  p.resources.forEach((r, i) => {
    out.push('<Resource>');
    el('UID', r.uid); el('ID', i + 1); el('Name', r.name); el('Type', r.type === 'Material' ? 0 : r.type === 'Cost' ? 2 : 1); el('IsNull', 0);
    el('Initials', r.initials);
    if (r.type === 'Material') el('MaterialLabel', r.materialLabel);
    el('Group', r.group);
    if (r.type === 'Work') el('MaxUnits', +r.maxUnits.toFixed(4));
    if (r.type !== 'Cost') { el('StandardRate', r.stdRate); el('StandardRateFormat', r.type === 'Material' ? 7 : 2); el('OvertimeRate', r.ovtRate); el('OvertimeRateFormat', 2); el('CostPerUse', cur(r.costPerUse)); }
    if (resCalUid.has(r.uid)) el('CalendarUID', resCalUid.get(r.uid));
    el('Notes', r.notes);
    if (r.type !== 'Cost' && r.rates.length) {
      const periods = [{ from: parseIso('1984-01-01')!, rate: r.stdRate }].concat(r.rates);
      out.push('<Rates>');
      periods.forEach((x, k) => {
        const nx = periods[k + 1];
        out.push('<Rate>'); el('RatesFrom', dt(x.from)); el('RatesTo', nx ? dt(nx.from - 1) : '2049-12-31T23:59:00'); el('RateTable', 0);
        el('StandardRate', x.rate); el('StandardRateFormat', 2); el('OvertimeRate', r.ovtRate); el('OvertimeRateFormat', 2); el('CostPerUse', cur(r.costPerUse)); out.push('</Rate>');
      });
      out.push('</Rates>');
    }
    out.push('</Resource>');
  });
  out.push('</Resources>');

  // Assignments
  out.push('<Assignments>');
  let auid = 1;
  const resBy = new Map(p.resources.map(r => [r.uid, r]));
  s.rows.forEach(row => {
    if (row.summary) return;
    row.task.assignments.forEach(a => {
      const r = resBy.get(a.res);
      if (!r) return;
      out.push('<Assignment>');
      el('UID', auid++); el('TaskUID', row.task.uid); el('ResourceUID', r.uid);
      if (r.type === 'Cost') el('Cost', cur(a.cost));
      el('Finish', dt(row.finish)); el('Start', dt(row.start));
      el('Units', r.type === 'Cost' ? 1 : +a.units.toFixed(4));
      if (r.type === 'Work') el('Work', minutesIso(a.work));
      out.push('</Assignment>');
    });
  });
  out.push('</Assignments>');
  out.push('</Project>');
  return { xml: out.join('\n'), notes };
}

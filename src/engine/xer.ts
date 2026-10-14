// Primavera P6 XER files: import and export.
// An XER file is tab-separated text in tables: %T starts a table, %F lists its fields, %R is a row, %E ends the file.
// Cairn reads the project, WBS, activities, relationships, calendars (hours per day), resources and assignments.
// WBS elements become phases; activities sit under their WBS element.
import { blankProject, newResource, newTask, type ConstraintType, type LinkType, type Project, type Task } from './model';
import { atDay, dayFromYmd, dayOf, minuteOfDay, ymd, type Minutes } from './time';
import { schedule, type Schedule } from './schedule';
import type { ImportReport } from './projectxml';

type Table = Record<string, string>[];

export function parseXer(text: string): Record<string, Table> {
  const tables: Record<string, Table> = {};
  let cur: Table | null = null, fields: string[] = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const cells = line.split('\t');
    if (cells[0] === '%T') { cur = tables[cells[1]] = []; fields = []; }
    else if (cells[0] === '%F') fields = cells.slice(1);
    else if (cells[0] === '%R' && cur) { const row: Record<string, string> = {}; fields.forEach((f, i) => (row[f] = cells[i + 1] ?? '')); cur.push(row); }
  }
  return tables;
}

export const looksLikeXer = (text: string) => /^﻿?ERMHDR/.test(text) || /\n%T\tTASK\b/.test(text.slice(0, 200000));

function xerDate(v: string): Minutes | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(v || '');
  return m ? atDay(dayFromYmd(+m[1], +m[2], +m[3]), m[4] ? +m[4] * 60 + +m[5] : 0) : null;
}
const pad = (n: number) => String(n).padStart(2, '0');
function fmtXer(t: Minutes | null | undefined): string {
  if (t == null) return '';
  const [y, m, d] = ymd(dayOf(t)); const mm = minuteOfDay(t);
  return `${y}-${pad(m)}-${pad(d)} ${pad(Math.floor(mm / 60))}:${pad(mm % 60)}`;
}

const CSTR_IN: Record<string, ConstraintType> = { CS_MSO: 'MSO', CS_MANDSTART: 'MSO', CS_MEO: 'MFO', CS_MANDFIN: 'MFO', CS_MSOA: 'SNET', CS_MEOA: 'FNET', CS_MSOB: 'SNLT', CS_MEOB: 'FNLT', CS_ALAP: 'ALAP' };
const CSTR_OUT: Partial<Record<ConstraintType, string>> = { MSO: 'CS_MSO', MFO: 'CS_MEO', SNET: 'CS_MSOA', FNET: 'CS_MEOA', SNLT: 'CS_MSOB', FNLT: 'CS_MEOB', ALAP: 'CS_ALAP' };

export function fromXer(text: string, source = 'Primavera P6 (.xer)'): { p: Project; report: ImportReport } {
  const T = parseXer(text);
  if (!T.TASK) throw new Error('This XER file has no activities (TASK table).');
  const notes: string[] = [];
  const projects = T.PROJECT || [];
  // Several projects in one file: take the one with the most activities.
  const count = new Map<string, number>();
  T.TASK.forEach(t => count.set(t.proj_id, (count.get(t.proj_id) || 0) + 1));
  const projId = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (count.size > 1) notes.push('The file holds ' + count.size + ' projects; the one with the most activities was opened.');
  const proj = projects.find(x => x.proj_id === projId);
  const p = blankProject(proj?.proj_short_name || proj?.proj_name || 'Imported P6 project');
  const cal = (T.CALENDAR || []).find(c => c.default_flag === 'Y') || (T.CALENDAR || [])[0];
  const hpd = parseFloat(cal?.day_hr_cnt || '8') || 8;
  p.settings.minutesPerDay = Math.round(hpd * 60);
  p.settings.minutesPerWeek = Math.round(parseFloat(cal?.week_hr_cnt || String(hpd * 5)) * 60) || p.settings.minutesPerDay * 5;
  const start = xerDate(proj?.plan_start_date || '') ?? xerDate(proj?.last_recalc_date || '');
  if (start != null) p.start = atDay(dayOf(start), p.settings.defaultStart);
  if (proj?.last_recalc_date) p.statusDate = xerDate(proj.last_recalc_date);

  // WBS tree → phases.
  const wbs = (T.PROJWBS || []).filter(w => w.proj_id === projId && w.proj_node_flag !== 'Y');
  const kids = new Map<string, Record<string, string>[]>();
  const wbsIds = new Set(wbs.map(w => w.wbs_id));
  wbs.forEach(w => { const parent = wbsIds.has(w.parent_wbs_id) ? w.parent_wbs_id : ''; if (!kids.has(parent)) kids.set(parent, []); kids.get(parent)!.push(w); });
  kids.forEach(list => list.sort((a, b) => (+a.seq_num || 0) - (+b.seq_num || 0) || a.wbs_short_name.localeCompare(b.wbs_short_name)));
  const acts = T.TASK.filter(t => t.proj_id === projId && t.task_type !== 'TT_WBS');
  const actsByWbs = new Map<string, Record<string, string>[]>();
  acts.forEach(a => { const k = wbsIds.has(a.wbs_id) ? a.wbs_id : ''; if (!actsByWbs.has(k)) actsByWbs.set(k, []); actsByWbs.get(k)!.push(a); });
  actsByWbs.forEach(list => list.sort((a, b) => (xerDate(a.early_start_date || a.target_start_date) ?? 0) - (xerDate(b.early_start_date || b.target_start_date) ?? 0) || a.task_code.localeCompare(b.task_code)));

  const tasks: Task[] = [];
  const uidOf = new Map<string, number>();
  const resUid = new Map<string, number>();
  (T.RSRC || []).forEach(r => {
    const res = newResource(p, { name: r.rsrc_name || r.rsrc_short_name, initials: (r.rsrc_short_name || '').slice(0, 6), type: r.rsrc_type === 'RT_Mat' ? 'Material' : 'Work' });
    p.resources.push(res); resUid.set(r.rsrc_id, res.uid);
  });
  const addActs = (wbsId: string, level: number) => (actsByWbs.get(wbsId) || []).forEach(a => {
    const hours = parseFloat(a.target_drtn_hr_cnt || a.remain_drtn_hr_cnt || '0') || 0;
    const mile = a.task_type === 'TT_Mile' || a.task_type === 'TT_FinMile';
    const t = newTask(p, { name: a.task_name || a.task_code, level, mode: 'auto', estimated: false, duration: mile ? 0 : Math.round(hours * 60), durUnit: 'd', milestone: mile });
    t.wbsCode = a.task_code;
    const c = CSTR_IN[a.cstr_type];
    if (c) { t.constraint = c; t.constraintDate = c === 'ALAP' ? null : xerDate(a.cstr_date); }
    const pct = a.status_code === 'TK_Complete' ? 100 : parseFloat(a.phys_complete_pct || '0') || 0;
    t.percent = a.status_code === 'TK_NotStart' ? 0 : pct;
    t.actualStart = xerDate(a.act_start_date); t.actualFinish = xerDate(a.act_end_date);
    if (a.priority_type) t.priority = ({ PT_Top: 1000, PT_High: 750, PT_Normal: 500, PT_Low: 250, PT_Lowest: 0 } as Record<string, number>)[a.priority_type] ?? 500;
    uidOf.set(a.task_id, t.uid);
    tasks.push(t);
  });
  const phases = new Set<number>();
  const walk = (parent: string, level: number) => (kids.get(parent) || []).forEach(w => {
    phases.add(p.nextTaskUid);
    tasks.push(newTask(p, { name: w.wbs_name || w.wbs_short_name, level, mode: 'auto', estimated: false, wbsCode: w.wbs_short_name }));
    addActs(w.wbs_id, level + 1);
    walk(w.wbs_id, level + 1);
  });
  addActs('', 1);
  walk('', 1);
  // Drop WBS phases that ended up empty.
  // Repeat until stable: removing an empty phase can empty its parent.
  let list = tasks;
  for (let changed = true; changed;) {
    const next = list.filter((t, i) => !phases.has(t.uid) || (i + 1 < list.length && list[i + 1].level > t.level));
    changed = next.length !== list.length; list = next;
  }
  p.tasks = list;

  let links = 0, skipped = 0;
  (T.TASKPRED || []).forEach(r => {
    const a = uidOf.get(r.task_id), b = uidOf.get(r.pred_task_id);
    if (a == null || b == null) { skipped++; return; }
    const t = p.tasks.find(x => x.uid === a)!;
    const type = (r.pred_type || 'PR_FS').replace('PR_', '') as LinkType;
    t.preds.push({ pred: b, type: ['FS', 'SS', 'FF', 'SF'].includes(type) ? type : 'FS', lag: Math.round((parseFloat(r.lag_hr_cnt || '0') || 0) * 60), lagUnit: 'd', lagElapsed: false, lagPercent: false });
    links++;
  });
  if (skipped) notes.push(skipped + ' relationship(s) to activities in other projects were skipped.');
  let assigns = 0;
  (T.TASKRSRC || []).forEach(r => {
    const tu = uidOf.get(r.task_id), ru = resUid.get(r.rsrc_id);
    const t = tu != null ? p.tasks.find(x => x.uid === tu) : undefined;
    if (!t || ru == null) return;
    const qty = (parseFloat(r.target_qty || '0') || 0) * 60;
    t.assignments.push({ res: ru, units: 1, work: Math.round(qty), cost: parseFloat(r.target_cost || '0') || 0 });
    assigns++;
  });
  if (T.CALENDAR && T.CALENDAR.length > 1) notes.push('Calendars: working hours per day were taken from “' + (cal?.clndr_name || 'the default calendar') + '”; holidays and other calendars were not imported.');
  notes.push('Activity IDs are kept in the WBS column.');
  return { p, report: { source, tasks: p.tasks.length, resources: p.resources.length, assignments: assigns, links, calendars: 1, notes } };
}

// Writes the plan as an XER file with the tables P6 needs to import a project.
export function toXer(p: Project, s: Schedule = schedule(p)): string {
  const out: string[] = [];
  const today = fmtXer(p.statusDate ?? s.start);
  out.push(['ERMHDR', '19.12', today.slice(0, 10), 'Project', 'admin', 'Cairn', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t'));
  const table = (name: string, fields: string[], rows: (string | number)[][]) => {
    out.push('%T\t' + name); out.push('%F\t' + fields.join('\t'));
    rows.forEach(r => out.push('%R\t' + r.map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')));
  };
  const hpd = p.settings.minutesPerDay / 60;
  const projId = 1, calId = 1;
  table('CURRTYPE', ['curr_id', 'decimal_digit_cnt', 'curr_symbol', 'decimal_symbol', 'digit_group_symbol', 'pos_curr_fmt_type', 'neg_curr_fmt_type', 'curr_type', 'curr_short_name', 'group_digit_cnt', 'base_exch_rate'],
    [[1, 2, p.settings.currency || '$', '.', ',', '#1.1', '(#1.1)', 'US Dollar', 'USD', 3, 1]]);
  table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'],
    [[calId, 'Y', 'Standard', '', '', today, 'CA_Base', hpd, p.settings.minutesPerWeek / 60, hpd * p.settings.daysPerMonth, hpd * p.settings.daysPerMonth * 12, 'N', '']]);
  table('PROJECT', ['proj_id', 'proj_short_name', 'clndr_id', 'plan_start_date', 'scd_end_date', 'last_recalc_date', 'def_duration_type', 'task_code_base', 'task_code_step', 'def_complete_pct_type'],
    [[projId, p.name.slice(0, 40), calId, fmtXer(s.start), fmtXer(s.finish), today, 'DT_FixedDUR2', 1000, 10, 'CP_Phys']]);
  // Phases become WBS elements; other tasks become activities under the nearest phase.
  const wbsRows: (string | number)[][] = [[100, projId, 'Y', 1, p.name.slice(0, 40), p.name, '']];
  const wbsOf = new Map<number, number>();
  const stack: { level: number; id: number }[] = [{ level: 0, id: 100 }];
  const taskRows: (string | number)[][] = [];
  let seq = 0, code = 1000;
  const taskIdOf = new Map<number, number>();
  s.rows.forEach(r => {
    const t = r.task;
    while (stack.length > 1 && stack[stack.length - 1].level >= t.level) stack.pop();
    const parent = stack[stack.length - 1].id;
    if (r.summary) {
      const id = 100 + t.uid;
      wbsRows.push([id, projId, 'N', ++seq, (t.wbsCode || String(r.id)).slice(0, 20), t.name, parent]);
      stack.push({ level: t.level, id });
      wbsOf.set(t.uid, id);
      return;
    }
    const id = 10000 + t.uid;
    taskIdOf.set(t.uid, id);
    code += 10;
    // Elapsed (calendar-time) durations have no P6 equivalent on a working calendar: they become working days, 5 for every 7.
    const work = t.elapsed ? r.duration / 1440 * (5 / 7) * p.settings.minutesPerDay : r.duration;
    const hours = (work / 60).toFixed(2);
    const mile = r.duration === 0 ? (t.preds.length ? 'TT_FinMile' : 'TT_Mile') : 'TT_Task';
    const status = r.percent >= 100 ? 'TK_Complete' : r.percent > 0 ? 'TK_Active' : 'TK_NotStart';
    taskRows.push([id, projId, parent, calId, t.wbsCode && /^[A-Z0-9-]+$/i.test(t.wbsCode) ? t.wbsCode : 'A' + code, t.name, mile, 'DT_FixedDUR2', status, 'CP_Phys', r.percent,
      hours, (work * (1 - r.percent / 100) / 60).toFixed(2), fmtXer(r.start), fmtXer(r.finish), fmtXer(r.start), fmtXer(r.finish), '', '',
      fmtXer(t.actualStart), fmtXer(t.actualFinish), CSTR_OUT[t.constraint] || '', fmtXer(t.constraintDate), (r.totalSlack / 60).toFixed(2)]);
  });
  table('PROJWBS', ['wbs_id', 'proj_id', 'proj_node_flag', 'seq_num', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'], wbsRows);
  table('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'task_code', 'task_name', 'task_type', 'duration_type', 'status_code', 'complete_pct_type', 'phys_complete_pct',
    'target_drtn_hr_cnt', 'remain_drtn_hr_cnt', 'target_start_date', 'target_end_date', 'early_start_date', 'early_end_date', 'late_start_date', 'late_end_date',
    'act_start_date', 'act_end_date', 'cstr_type', 'cstr_date', 'total_float_hr_cnt'], taskRows);
  // P6 links activities only, so a link to or from a phase is carried by the activities inside it.
  const leaves = (uid: number): number[] => {
    const r = s.byUid.get(uid);
    if (!r) return [];
    if (!r.summary) return [uid];
    const out: number[] = [];
    for (let i = r.i + 1; i < s.rows.length && s.rows[i].task.level > r.task.level; i++) if (!s.rows[i].summary) out.push(s.rows[i].task.uid);
    return out;
  };
  const predRows: (string | number)[][] = [];
  const seen = new Set<string>();
  let pid = 1;
  p.tasks.forEach(t => t.preds.forEach(l => {
    const fromStart = l.type === 'SS' || l.type === 'SF', toStart = l.type === 'FS' || l.type === 'SS';
    let from = leaves(l.pred), to = leaves(t.uid);
    if (fromStart && from.length > 1) from = [from.reduce((a, b) => (s.byUid.get(a)!.start <= s.byUid.get(b)!.start ? a : b))];
    if (!toStart && to.length > 1) to = [to.reduce((a, b) => (s.byUid.get(a)!.finish >= s.byUid.get(b)!.finish ? a : b))];
    const lagH = l.lagPercent ? 0 : (l.lagElapsed ? l.lag / 1440 * (5 / 7) * p.settings.minutesPerDay : l.lag) / 60;
    from.forEach(fu => to.forEach(tu => {
      const a = taskIdOf.get(tu), b = taskIdOf.get(fu), key = a + '-' + b;
      if (a == null || b == null || a === b || seen.has(key)) return;
      seen.add(key);
      predRows.push([pid++, a, b, projId, projId, 'PR_' + l.type, lagH.toFixed(2)]);
    }));
  }));
  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], predRows);
  table('RSRC', ['rsrc_id', 'rsrc_name', 'rsrc_short_name', 'rsrc_type', 'clndr_id', 'def_qty_per_hr', 'cost_qty_type'],
    p.resources.map(r => [r.uid, r.name, (r.initials || r.name).replace(/\s+/g, '').slice(0, 20) || 'R' + r.uid, r.type === 'Material' ? 'RT_Mat' : 'RT_Labor', calId, r.maxUnits, 'QT_Hour']));
  const asg: (string | number)[][] = [];
  let aid = 1;
  p.tasks.forEach(t => t.assignments.forEach(a => {
    const tid = taskIdOf.get(t.uid);
    if (tid == null) return;
    asg.push([aid++, tid, projId, a.res, (a.work / 60).toFixed(2), (a.work / 60).toFixed(2), a.cost.toFixed(2)]);
  }));
  table('TASKRSRC', ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'target_qty', 'remain_qty', 'target_cost'], asg);
  out.push('%E');
  void wbsOf;
  return out.join('\r\n') + '\r\n';
}

// Task lists from spreadsheets (CSV, Excel) and other row-based files become plans here.
// A mapping says which column holds the name, duration, start, finish, links, people and outline level;
// guessMapping() proposes one from the header names, and the import screen lets you correct it.
import { blankProject, newResource, newTask, type Link, type LinkType, type Project, type Task } from './model';
import { parseDuration, type DurUnit } from './duration';
import { atDay, dayFromYmd, parseDateText, weekday, type DateFormat, type Minutes } from './time';
import type { ImportReport } from './projectxml';

export type ColumnRole = 'skip' | 'name' | 'duration' | 'start' | 'finish' | 'preds' | 'resources' | 'level' | 'wbs' | 'id' | 'percent' | 'notes' | 'milestone' | 'deadline' | 'cost' | 'priority';
export const ROLE_LABELS: Record<ColumnRole, string> = {
  skip: '(ignore)', name: 'Task name', duration: 'Duration', start: 'Start', finish: 'Finish', preds: 'Depends on (predecessors)', resources: 'Assigned to',
  level: 'Outline level', wbs: 'WBS / outline number', id: 'Task ID used in “depends on”', percent: '% done', notes: 'Notes', milestone: 'Milestone (yes/no)',
  deadline: 'Deadline', cost: 'Fixed cost', priority: 'Priority'
};
export type Mapping = ColumnRole[];

const GUESS: [ColumnRole, RegExp][] = [
  ['id', /^(id|#|no\.?|task ?id|activity ?id|unique ?id|ref|key)$/i],
  ['wbs', /^(wbs|outline ?number|wbs ?code|outline ?no)/i],
  ['level', /^(outline ?level|level|indent|depth)$/i],
  ['preds', /pred|depend|after|blocked by/i],
  ['resources', /resource|assign|owner|who|responsible|people|crew/i],
  ['percent', /%|percent|progress|complete|done/i],
  ['duration', /^(dur|duration|original duration|days|length|effort)/i],
  ['deadline', /deadline|due date/i],
  ['start', /^(start|begin|planned start|start date|from)/i],
  ['finish', /^(finish|end|planned finish|finish date|end date|to|due)/i],
  ['milestone', /^milestone/i],
  ['notes', /note|comment|remark|description/i],
  ['cost', /cost|budget/i],
  ['priority', /priority/i],
  ['name', /name|task|activity|title|summary|item|subject/i]
];

export function guessMapping(header: string[]): Mapping {
  const used = new Set<ColumnRole>();
  return header.map(h => {
    const t = String(h || '').trim();
    for (const [role, re] of GUESS) if (!used.has(role) && re.test(t)) { used.add(role); return role; }
    return 'skip';
  });
}

// Comma, semicolon or tab separated text, with quotes; the separator is guessed from the first line.
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const sep = [',', ';', '\t'].map(c => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// Day/month order of the date column: decided by any value whose first number is above 12.
export function guessDateFormat(values: string[]): DateFormat {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = /^\s*(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(v || '');
    if (!m) continue;
    if (m[1].length === 4) return 'iso';
    if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'nmdy' : 'ndmy';
}

const excelSerial = (v: string): Minutes | null => {
  const n = Number(v);
  if (!v || !isFinite(n) || n < 20000 || n > 80000) return null;   // 1954–2119
  const day = Math.floor(n) - 25569;                               // days from 1899-12-30 to 1970-01-01
  return atDay(day, Math.round((n - Math.floor(n)) * 1440));
};

function parseWhen(v: string, fmt: DateFormat, minute: number): Minutes | null {
  if (!v || !v.trim()) return null;
  const serial = excelSerial(v.trim());
  if (serial != null) return serial % 1440 ? serial : serial + minute;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(v.trim());
  if (iso) return atDay(dayFromYmd(+iso[1], +iso[2], +iso[3]), iso[4] ? +iso[4] * 60 + +iso[5] : minute);
  const d = parseDateText(v, fmt);
  return d ? atDay(d.day, d.minute ?? minute) : null;
}

const workdaysBetween = (a: number, b: number) => { let n = 0; for (let d = a; d <= b; d++) if (weekday(d) % 6 !== 0) n++; return Math.max(1, n); };

export interface TabularOptions { name: string; source: string; dateFormat?: DateFormat }

export function fromTable(rows: string[][], map: Mapping, opt: TabularOptions): { p: Project; report: ImportReport } {
  const p = blankProject(opt.name);
  const notes: string[] = [];
  const col = (role: ColumnRole) => map.indexOf(role);
  const get = (r: string[], role: ColumnRole) => { const i = col(role); return i >= 0 ? String(r[i] ?? '').trim() : ''; };
  const fmt = opt.dateFormat || guessDateFormat(rows.flatMap(r => [get(r, 'start'), get(r, 'finish')]));
  const keyToUid = new Map<string, number>();
  const tasks: Task[] = [];
  const resByName = new Map<string, number>();
  let earliest = Infinity, badDates = 0, badDur = 0, badLinks = 0;
  const predText: [Task, string][] = [];
  rows.forEach((r, i) => {
    let name = col('name') >= 0 ? String(r[col('name')] ?? '') : '';
    const indentSpaces = /^\s*/.exec(name)![0].replace(/\t/g, '    ').length;
    name = name.trim();
    if (!name) return;
    const t = newTask(p, { name, mode: 'auto', estimated: false });
    // Outline level: a level column, a WBS number (1.2.3), or indentation in the name.
    const lv = get(r, 'level'), wbs = get(r, 'wbs');
    t.level = lv && /^\d+$/.test(lv) ? Math.max(1, +lv) : wbs && /^\d+(\.\d+)*$/.test(wbs) ? wbs.split('.').length : 1 + Math.floor(indentSpaces / 2);
    const dur = get(r, 'duration');
    const start = parseWhen(get(r, 'start'), fmt, p.settings.defaultStart), finish = parseWhen(get(r, 'finish'), fmt, p.settings.defaultFinish);
    if ((get(r, 'start') && start == null) || (get(r, 'finish') && finish == null)) badDates++;
    if (dur) {
      const d = parseDuration(/^\d+(\.\d+)?$/.test(dur) ? dur + 'd' : dur, p.settings, 'd' as DurUnit);
      if (d) { t.duration = d.minutes; t.durUnit = d.unit; t.elapsed = d.elapsed; } else badDur++;
    } else if (start != null && finish != null && finish >= start) {
      t.duration = workdaysBetween(Math.floor(start / 1440), Math.floor((finish - 1) / 1440)) * p.settings.minutesPerDay;
    }
    if (/^(y|yes|true|1|x)$/i.test(get(r, 'milestone')) || (dur && /^0+(\.0+)?\s*[a-z]*$/i.test(dur))) { t.duration = 0; t.milestone = true; }
    if (start != null) { t.constraint = 'SNET'; t.constraintDate = start; earliest = Math.min(earliest, start); }
    else if (finish != null && !dur) { t.constraint = 'FNLT'; t.constraintDate = finish; }
    const dl = parseWhen(get(r, 'deadline'), fmt, p.settings.defaultFinish);
    if (dl != null) t.deadline = dl;
    const pct = parseFloat(get(r, 'percent').replace('%', ''));
    if (isFinite(pct)) t.percent = Math.max(0, Math.min(100, pct <= 1 && get(r, 'percent').indexOf('%') < 0 && pct > 0 ? pct * 100 : pct));
    const cost = parseFloat(get(r, 'cost').replace(/[^\d.-]/g, ''));
    if (isFinite(cost)) t.fixedCost = cost;
    const pri = parseInt(get(r, 'priority'), 10);
    if (isFinite(pri)) t.priority = Math.max(0, Math.min(1000, pri));
    t.notes = get(r, 'notes');
    const people = get(r, 'resources');
    if (people) people.split(/[,;]/).map(x => x.trim()).filter(Boolean).forEach(part => {
      const m = /^(.*?)\s*(?:\[\s*([\d.]+)\s*%?\s*\])?$/.exec(part)!;
      const nm = m[1].trim();
      if (!nm) return;
      let uid = resByName.get(nm.toLowerCase());
      if (uid == null) { const res = newResource(p, { name: nm }); res.initials = nm.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase(); p.resources.push(res); uid = res.uid; resByName.set(nm.toLowerCase(), uid); }
      t.assignments.push({ res: uid, units: m[2] ? +m[2] / 100 : 1, work: 0, cost: 0 });
    });
    const key = get(r, 'id') || get(r, 'wbs');
    if (key) keyToUid.set(key, t.uid);
    keyToUid.set('#' + (tasks.length + 1), t.uid);
    tasks.push(t);
    const pt = get(r, 'preds');
    if (pt) predText.push([t, pt]);
    void i;
  });
  // Links: task IDs from the ID column if there is one, otherwise row numbers of the imported tasks.
  const hasId = col('id') >= 0 || col('wbs') >= 0;
  predText.forEach(([t, text]) => {
    text.split(/[,;]/).map(x => x.trim()).filter(Boolean).forEach(part => {
      const m = /^(.+?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*([\d.]+)\s*([a-z]*))?$/i.exec(part);
      if (!m) { badLinks++; return; }
      const ref = m[1].trim();
      const uid = (hasId ? keyToUid.get(ref) : undefined) ?? keyToUid.get('#' + ref);
      if (uid == null || uid === t.uid) { badLinks++; return; }
      let lag = 0, lagUnit: DurUnit = 'd';
      if (m[3]) { const d = parseDuration(m[4] + (m[5] || 'd'), p.settings, 'd'); if (d) { lag = d.minutes * (m[3] === '-' ? -1 : 1); lagUnit = d.unit; } }
      const link: Link = { pred: uid, type: (m[2]?.toUpperCase() || 'FS') as LinkType, lag, lagUnit, lagElapsed: false, lagPercent: false };
      if (!t.preds.some(l => l.pred === uid)) t.preds.push(link);
    });
  });
  // Tasks with predecessors follow them; their typed start date is kept only when there are no links.
  tasks.forEach(t => { if (t.preds.length && t.constraint === 'SNET') { t.constraint = 'ASAP'; t.constraintDate = null; } });
  // A phase (a task with subtasks) takes its dates from them.
  for (let i = 0; i < tasks.length; i++) {
    tasks[i].level = Math.min(tasks[i].level, i ? tasks[i - 1].level + 1 : 1);
    if (i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level) { tasks[i].constraint = 'ASAP'; tasks[i].constraintDate = null; tasks[i].milestone = false; }
  }
  p.tasks = tasks;
  if (isFinite(earliest)) p.start = atDay(Math.floor(earliest / 1440), p.settings.defaultStart);
  if (badDates) notes.push(badDates + ' date(s) could not be read and were left empty.');
  if (badDur) notes.push(badDur + ' duration(s) could not be read; those tasks got 1 day.');
  if (badLinks) notes.push(badLinks + ' link(s) pointed to tasks that were not found and were skipped.');
  if (!tasks.length) throw new Error('No tasks found. Check that a column is set to “Task name”.');
  const links = tasks.reduce((a, t) => a + t.preds.length, 0), assignments = tasks.reduce((a, t) => a + t.assignments.length, 0);
  return { p, report: { source: opt.source, tasks: tasks.length, resources: p.resources.length, assignments, links, calendars: 0, notes } };
}

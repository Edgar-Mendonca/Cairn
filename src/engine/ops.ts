// Editing operations. Each takes a project and returns a new one, copying only what changes, so undo can keep
// earlier versions cheaply. Duration, work and units follow the task-type rules (see docs/scheduling-rules.md).
import { CONSTRAINT_NAMES, cfType, type Recurrence, type Contour, fixLevels, initials, newResource, newTask, subtreeEnd, type Assignment, type ConstraintType, type Link, type LinkType, type Project, type Resource, type Task, type TaskMode } from './model';
import { formatShort, parseDuration, unitMinutes, type DurUnit } from './duration';
import { baselineFrom, type Row, type Schedule } from './schedule';
import { parseCustom } from './fields';
import { atDay, dayOf, parseDateText, type Minutes } from './time';
import { occurrences } from './recur';

export class Draft {
  p: Project;
  private touched = new Set<number>();
  private resTouched = new Set<number>();
  constructor(p: Project) { this.p = { ...p, tasks: p.tasks.slice(), resources: p.resources.slice() }; }
  index(uid: number) { return this.p.tasks.findIndex(t => t.uid === uid); }
  task(uid: number): Task {
    const i = this.index(uid);
    if (i < 0) throw new Error('Task not found');
    if (!this.touched.has(uid)) {
      const t = this.p.tasks[i];
      this.p.tasks[i] = { ...t, preds: t.preds.map(l => ({ ...l })), assignments: t.assignments.map(a => ({ ...a })), custom: { ...t.custom }, style: t.style ? { ...t.style, cells: t.style.cells ? { ...t.style.cells } : undefined } : undefined };
      this.touched.add(uid);
    }
    return this.p.tasks[i];
  }
  resource(uid: number): Resource {
    const i = this.p.resources.findIndex(r => r.uid === uid);
    if (i < 0) throw new Error('Resource not found');
    if (!this.resTouched.has(uid)) { const r = this.p.resources[i]; this.p.resources[i] = { ...r, rates: r.rates.map(x => ({ ...x })) }; this.resTouched.add(uid); }
    return this.p.resources[i];
  }
}

export type Result = { p: Project; error?: string; message?: string };

const resMapOf = (p: Project) => new Map(p.resources.map(r => [r.uid, r]));
const isWorkRes = (p: Project, a: Assignment) => p.resources.find(r => r.uid === a.res)?.type === 'Work';

/* ---------- duration, work and units (task-type rules) ---------- */

function workAssignments(p: Project, t: Task) { return t.assignments.filter(a => isWorkRes(p, a)); }
export const taskWork = (p: Project, t: Task) => workAssignments(p, t).reduce((a, x) => a + x.work, 0);

export function applyDuration(p: Project, t: Task, minutes: number) {
  const d = Math.max(0, minutes);
  t.duration = d;
  if (t.splits) { t.splits = t.splits.filter(x => x.after < d); if (!t.splits.length) delete t.splits; }
  if (d === 0 && t.mode === 'auto') t.milestone = true;
  else if (d > 0) t.milestone = false;
  workAssignments(p, t).forEach(a => {
    if (t.type === 'FixedWork' && d > 0) a.units = a.work / d;
    else a.work = d * a.units;
  });
}

export function applyWork(p: Project, t: Task, minutes: number): string | undefined {
  const as = workAssignments(p, t);
  if (!as.length) return 'Assign a work resource before entering work.';
  const W = Math.max(0, minutes), sumUnits = as.reduce((a, x) => a + x.units, 0) || 1;
  if (t.type === 'FixedDuration') {
    const old = as.reduce((a, x) => a + x.work, 0);
    as.forEach(a => { a.work = old > 0 ? a.work * W / old : W * a.units / sumUnits; a.units = t.duration > 0 ? a.work / t.duration : a.units; });
  } else {
    const d = W / sumUnits;
    t.duration = d; t.milestone = d === 0; t.estimated = false;
    as.forEach(a => { a.work = d * a.units; });
  }
}

// Replaces the task's assignments. Units for work resources are fractions (1 = 100%).
export function applyAssignments(p: Project, t: Task, list: { res: number; units: number; cost?: number }[]) {
  const res = resMapOf(p);
  const oldWork = workAssignments(p, t);
  const oldW = oldWork.reduce((a, x) => a + x.work, 0);
  const oldUnits = oldWork.reduce((a, x) => a + x.units, 0);
  const prev = new Map(t.assignments.map(a => [a.res, a]));
  const next: Assignment[] = [];
  list.forEach(x => {
    const r = res.get(x.res);
    if (!r || next.some(a => a.res === x.res)) return;
    const old = prev.get(x.res);
    if (r.type === 'Cost') { next.push({ res: x.res, units: 1, work: 0, cost: x.cost ?? old?.cost ?? 0 }); return; }
    if (r.type === 'Material') { next.push({ res: x.res, units: Math.max(0, x.units), work: 0, cost: 0 }); return; }
    next.push({ res: x.res, units: Math.max(0, x.units), work: old ? old.work : 0, cost: 0 });
  });
  t.assignments = next;
  const nowWork = next.filter(a => res.get(a.res)?.type === 'Work');
  const newUnits = nowWork.reduce((a, x) => a + x.units, 0);
  const setChanged = oldWork.length !== nowWork.length || nowWork.some(a => !prev.has(a.res));
  const effort = t.type === 'FixedWork' || t.effortDriven;
  if (effort && oldWork.length && setChanged && oldW > 0 && newUnits > 0) {
    // Effort driven: total work stays the same.
    if (t.type === 'FixedDuration') {
      const f = oldW / (t.duration * newUnits);
      nowWork.forEach(a => { a.units *= f; a.work = t.duration * a.units; });
    } else {
      const d = oldW / newUnits;
      t.duration = d; t.estimated = false;
      nowWork.forEach(a => { a.work = d * a.units; });
    }
    return;
  }
  // Not effort driven, or only units changed.
  if (t.type === 'FixedDuration' || setChanged || !oldWork.length || oldUnits === newUnits) {
    nowWork.forEach(a => { if (!prev.has(a.res) || t.type === 'FixedDuration' || a.work === 0) a.work = t.duration * a.units; });
    return;
  }
  // Units changed on Fixed Units / Fixed Work tasks: work stays, duration follows the longest assignment.
  let d = 0;
  nowWork.forEach(a => { if (a.units > 0) d = Math.max(d, a.work / a.units); });
  t.duration = d; t.estimated = false;
  nowWork.forEach(a => { if (a.units > 0 && a.work / a.units < d - 1e-6 && t.type !== 'FixedWork') a.work = d * a.units; });
}

/* ---------- Predecessors and Resource Names text ---------- */

// "3, 5SS+2d, 7FF-1w, 4FS+50%" using row IDs.
export function parsePredecessors(p: Project, s: Schedule, text: string, selfUid: number): { links: Link[]; bad: string[] } {
  const links: Link[] = [], bad: string[] = [];
  String(text || '').split(/[,;]/).map(x => x.trim()).filter(Boolean).forEach(part => {
    const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(.+))?$/i.exec(part);
    const row = m ? s.rows[+m[1] - 1] : undefined;
    if (!m || !row || row.task.uid === selfUid) { bad.push(part); return; }
    let lag = 0, lagUnit: DurUnit = p.settings.durationUnit, lagElapsed = false, lagPercent = false;
    if (m[3]) {
      const sign = m[3] === '-' ? -1 : 1, lt = m[4].trim();
      const pc = /^(\d+(?:\.\d+)?)\s*%$/.exec(lt);
      if (pc) { lag = sign * +pc[1]; lagPercent = true; }
      else {
        const d = parseDuration(lt, p.settings, p.settings.durationUnit);
        if (!d) { bad.push(part); return; }
        lag = sign * d.minutes; lagUnit = d.unit; lagElapsed = d.elapsed;
      }
    }
    if (links.some(l => l.pred === row.task.uid)) { bad.push(part); return; }
    links.push({ pred: row.task.uid, type: (m[2] || 'FS').toUpperCase() as LinkType, lag, lagUnit, lagElapsed, lagPercent });
  });
  return { links, bad };
}

export function formatLink(p: Project, l: Link, id: number | string): string {
  let out = String(id);
  if (l.type !== 'FS' || l.lag) out += l.type;
  if (l.lag) out += (l.lag > 0 ? '+' : '-') + (l.lagPercent ? Math.abs(l.lag) + '%' : formatShort(Math.abs(l.lag), l.lagUnit, l.lagElapsed, p.settings));
  return out;
}

export function formatPredecessors(p: Project, s: Schedule, t: Task): string {
  return t.preds.map(l => { const r = s.byUid.get(l.pred); return r ? formatLink(p, l, r.id) : ''; }).filter(Boolean).join(',');
}

export function formatSuccessors(p: Project, s: Schedule, t: Task): string {
  const out: string[] = [];
  s.rows.forEach(r => r.task.preds.forEach(l => { if (l.pred === t.uid) out.push(formatLink(p, l, r.id)); }));
  return out.join(',');
}

export function formatResourceNames(p: Project, t: Task): string {
  const res = resMapOf(p);
  return t.assignments.map(a => {
    const r = res.get(a.res);
    if (!r) return '';
    if (r.type === 'Material') return r.name + '[' + +a.units.toFixed(2) + (r.materialLabel ? ' ' + r.materialLabel : '') + ']';
    if (r.type === 'Cost') return r.name + (a.cost ? '[' + p.settings.currency + a.cost.toLocaleString() + ']' : '');
    return r.name + (Math.abs(a.units - 1) > 1e-6 ? '[' + +(a.units * 100).toFixed(1) + '%]' : '');
  }).filter(Boolean).join(',');
}

// "Ann, Bob[50%], Cement[20 tons], Permits[$500]". Unknown names create new work resources.
export function parseResourceNames(d: Draft, text: string): { list: { res: number; units: number; cost?: number }[]; created: string[] } {
  const list: { res: number; units: number; cost?: number }[] = [], created: string[] = [];
  // Split on commas that are not inside brackets.
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of String(text || '')) {
    if (ch === '[') depth++;
    if (ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  parts.map(x => x.trim()).filter(Boolean).forEach(part => {
    const m = /^(.*?)\s*(?:\[([^\]]*)\])?$/.exec(part)!;
    const name = m[1].trim();
    if (!name) return;
    let r = d.p.resources.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!r) {
      d.p.nextResUid = Math.max(d.p.nextResUid, ...d.p.resources.map(x => x.uid + 1));
      r = newResource(d.p, { name, initials: initials(name) });
      d.p.resources.push(r);
      created.push(name);
    }
    const arg = (m[2] || '').trim();
    const n = parseFloat(arg.replace(/[^\d.-]/g, ''));
    if (r.type === 'Cost') list.push({ res: r.uid, units: 1, cost: isFinite(n) ? n : 0 });
    else if (r.type === 'Material') list.push({ res: r.uid, units: isFinite(n) ? n : 1 });
    else list.push({ res: r.uid, units: isFinite(n) ? n / 100 : 1 });
  });
  return { list, created };
}

/* ---------- cell edits ---------- */

export type Field = 'name' | 'duration' | 'start' | 'finish' | 'preds' | 'resources' | 'percent' | 'mode' | 'work' | 'cost' | 'fixedCost' |
  'constraint' | 'constraintDate' | 'deadline' | 'notes' | 'priority' | 'type' | 'actualStart' | 'actualFinish' | 'milestone' | 'active' | 'effortDriven' | 'wbs' |
  'actualDuration' | 'remainingDuration' | 'actualWork' | 'remainingWork' | 'percentWork' | 'physPercent' | 'hyperlink' | 'hyperlinkAddress' | 'hyperlinkSub' |
  'contact' | 'accrual' | 'evMethod' | 'calendar' | 'rollup' | 'hideBar' | 'marked' | 'ignoreResCal' | 'levelDelay' | 'outlineLevel' | `custom:${string}`;

function parseWhen(p: Project, text: string, defaultMinute: number): Minutes | null | 'invalid' {
  const tx = text.trim();
  if (!tx || /^na$/i.test(tx)) return null;
  const d = parseDateText(tx, p.settings.dateFormat);
  if (!d) return 'invalid';
  return atDay(d.day, d.minute ?? defaultMinute);
}

export function editCell(p: Project, s: Schedule, uid: number, field: Field, text: string): Result {
  const d = new Draft(p), t = d.task(uid), set = p.settings;
  const row = s.byUid.get(uid);
  const summary = !!row?.summary;
  switch (field) {
    case 'name': t.name = text.trim(); break;
    case 'notes': t.notes = text; break;
    case 'duration': {
      if (summary && t.mode === 'auto') return { p, error: 'The duration of a phase comes from its subtasks.' };
      const v = parseDuration(text, set, set.durationUnit);
      if (!v || v.minutes < 0) return { p, error: 'Enter a duration such as 3d, 2w, 4h or 1mo. Add “e” for elapsed time (3ed) or “?” for an estimate.' };
      t.durUnit = v.unit; t.elapsed = v.elapsed; t.estimated = v.estimated;
      applyDuration(d.p, t, v.minutes);
      break;
    }
    case 'work': {
      const v = parseDuration(text, set, set.workUnit);
      if (!v) return { p, error: 'Enter work such as 40h or 5d.' };
      const err = applyWork(d.p, t, v.minutes);
      if (err) return { p, error: err };
      break;
    }
    case 'start': case 'finish': {
      const isStart = field === 'start';
      const v = parseWhen(p, text, isStart ? set.defaultStart : set.defaultFinish);
      if (v === 'invalid' || v == null) return { p, error: 'Enter a date such as 12 Jan 26 or 12 Jan 26 13:00.' };
      if (summary) {
        // A start typed on a phase holds back all its subtasks (Start No Earlier Than).
        if (!isStart) return { p, error: 'A phase finishes when its last subtask finishes. Change a subtask instead.' };
        t.constraint = 'SNET'; t.constraintDate = v;
        break;
      }
      if (t.actualStart != null) {
        // Started tasks: the date typed becomes the actual date (Actual Start / Actual Finish change).
        const c = s.calendars.get(t.calendar, p.calendar);
        if (isStart) {
          if (t.actualFinish != null && v > t.actualFinish) return { p, error: 'The actual start cannot be after the actual finish.' };
          t.actualStart = v;
        } else if (t.actualFinish != null) {
          if (v < t.actualStart) return { p, error: 'The actual finish cannot be before the actual start.' };
          t.actualFinish = v;
          applyDuration(d.p, t, Math.max(0, t.elapsed ? v - t.actualStart : c.workBetween(t.actualStart, v)));
        } else {
          if (v < t.actualStart) return { p, error: 'The finish cannot be before the actual start.' };
          applyDuration(d.p, t, Math.max(0, t.elapsed ? v - t.actualStart : c.workBetween(t.actualStart, v)));
        }
        break;
      }
      if (t.mode === 'manual') {
        if (isStart) t.start = v;
        else {
          const st = t.start ?? row?.start ?? p.start;
          const c = s.calendars.get(t.calendar, p.calendar);
          const w = Math.max(0, t.elapsed ? v - st : c.workBetween(st, v));
          applyDuration(d.p, t, w);
        }
      } else {
        // Typing a date sets a constraint: Start No Earlier Than / Finish No Earlier Than.
        t.constraint = isStart ? 'SNET' : 'FNET';
        t.constraintDate = v;
      }
      break;
    }
    case 'preds': {
      const { links, bad } = parsePredecessors(p, s, text, uid);
      if (bad.length) return { p, error: 'Could not read: ' + bad.join(', ') + '. Use row IDs such as 3, 5SS+2d or 7FF-1w.' };
      t.preds = links;
      const rowsOfSub = row ? s.rows.slice(row.i + 1, subtreeEndRows(s, row.i)).map(r => r.task.uid) : [];
      if (t.preds.some(l => rowsOfSub.includes(l.pred))) return { p, error: 'A phase cannot be linked to its own subtasks.' };
      if (createsCycle(p, uid, t.preds)) return { p, error: 'That link would create a loop: the task would depend on itself.' };
      break;
    }
    case 'resources': {
      const { list, created } = parseResourceNames(d, text);
      applyAssignments(d.p, d.task(uid), list);
      return { p: d.p, message: created.length ? 'Added to the People view: ' + created.join(', ') : undefined };
    }
    case 'percent': {
      const v = parseFloat(text);
      if (!isFinite(v) || v < 0 || v > 100) return { p, error: 'Enter a percentage from 0 to 100.' };
      return setPercent(p, s, [uid], v);
    }
    case 'mode': return setMode(p, s, [uid], /man|pin/i.test(text) ? 'manual' : 'auto');
    case 'fixedCost': {
      const v = parseFloat(text.replace(/[^\d.-]/g, ''));
      if (!isFinite(v)) return { p, error: 'Enter an amount.' };
      t.fixedCost = v;
      break;
    }
    case 'priority': {
      const v = Math.round(+text);
      if (!isFinite(v) || v < 0 || v > 1000) return { p, error: 'Priority is a number from 0 to 1000.' };
      t.priority = v;
      break;
    }
    case 'constraint': {
      const key = (Object.keys(CONSTRAINT_NAMES) as ConstraintType[]).find(k => k === text || CONSTRAINT_NAMES[k] === text);
      if (!key) return { p, error: 'Unknown constraint type.' };
      t.constraint = key;
      if (key === 'ASAP' || key === 'ALAP') t.constraintDate = null;
      else if (t.constraintDate == null && row) t.constraintDate = /^(F|MFO)/.test(key) ? row.finish : row.start;
      break;
    }
    case 'constraintDate': case 'deadline': case 'actualStart': case 'actualFinish': {
      const v = parseWhen(p, text, field === 'actualStart' ? set.defaultStart : field === 'constraintDate' && /^S|MSO/.test(t.constraint) ? set.defaultStart : set.defaultFinish);
      if (v === 'invalid') return { p, error: 'Enter a date such as 12 Jan 26, or NA to clear it.' };
      if (field === 'constraintDate') { t.constraintDate = v; if (v == null) t.constraint = 'ASAP'; else if (t.constraint === 'ASAP' || t.constraint === 'ALAP') t.constraint = 'SNET'; }
      else if (field === 'deadline') t.deadline = v;
      else if (field === 'actualStart') { t.actualStart = v; if (v != null && t.percent === 0) t.percent = 0; }
      else { t.actualFinish = v; if (v != null) { t.percent = 100; if (t.actualStart == null) t.actualStart = row?.start ?? null; } }
      break;
    }
    case 'type': {
      const v = text.replace(/\s/g, '');
      if (v !== 'FixedUnits' && v !== 'FixedWork' && v !== 'FixedDuration') return { p, error: 'Unknown task type.' };
      t.type = v;
      if (v === 'FixedWork') t.effortDriven = true;
      break;
    }
    case 'milestone': t.milestone = /^(1|true|yes)$/i.test(text); if (t.milestone && t.mode === 'auto') applyDuration(d.p, t, 0); break;
    case 'actualDuration': case 'remainingDuration': {
      if (summary) return { p, error: 'Enter progress on the subtasks.' };
      const v = parseDuration(text, set, t.durUnit || set.durationUnit);
      if (!v || v.minutes < 0) return { p, error: 'Enter a duration such as 3d.' };
      const dur = row ? row.duration : t.duration;
      const act = field === 'actualDuration' ? v.minutes : dur * (row ? row.percent : t.percent) / 100;
      const rem = field === 'remainingDuration' ? v.minutes : Math.max(0, dur - act);
      // Actual duration beyond the duration extends it; remaining duration sets duration = actual + remaining.
      const total = field === 'actualDuration' ? Math.max(dur, act) : act + rem;
      if (Math.abs(total - dur) > 0.01) applyDuration(d.p, t, total);
      const pct = total > 0 ? Math.round(act / total * 100) : act > 0 ? 100 : 0;
      setProgress(t, pct, row);
      break;
    }
    case 'actualWork': case 'remainingWork': case 'percentWork': {
      if (summary) return { p, error: 'Enter progress on the subtasks.' };
      const total = row ? row.work : taskWork(d.p, t);
      if (field === 'percentWork') {
        const v = parseFloat(text);
        if (!isFinite(v) || v < 0 || v > 100) return { p, error: 'Enter a percentage from 0 to 100.' };
        setProgress(t, v, row);
        break;
      }
      const v = parseDuration(text, set, set.workUnit);
      if (!v || v.minutes < 0) return { p, error: 'Enter work such as 16h.' };
      if (!total && field === 'actualWork') return { p, error: 'Assign a work resource before entering work.' };
      const act = field === 'actualWork' ? v.minutes : total * (row ? row.percent : t.percent) / 100;
      const rem = field === 'remainingWork' ? v.minutes : Math.max(0, total - act);
      const newTotal = field === 'actualWork' ? Math.max(total, act) : act + rem;
      if (Math.abs(newTotal - total) > 0.01) { const err = applyWork(d.p, t, newTotal); if (err) return { p, error: err }; }
      setProgress(t, newTotal > 0 ? Math.round(act / newTotal * 1000) / 10 : 0, row);
      break;
    }
    case 'physPercent': {
      const v = parseFloat(text);
      if (!isFinite(v) || v < 0 || v > 100) return { p, error: 'Enter a percentage from 0 to 100.' };
      if (v) t.physPercent = v; else delete t.physPercent;
      break;
    }
    case 'hyperlink': case 'hyperlinkAddress': case 'hyperlinkSub': {
      const h = { text: '', address: '', sub: '', ...(t.hyperlink || {}) };
      if (field === 'hyperlink') h.text = text.trim(); else if (field === 'hyperlinkAddress') h.address = text.trim(); else h.sub = text.trim();
      if (!h.address && !h.sub) delete t.hyperlink; else t.hyperlink = h;
      break;
    }
    case 'contact': if (text.trim()) t.contact = text.trim(); else delete t.contact; break;
    case 'accrual': { const v = /^s/i.test(text) ? 'start' : /^e/i.test(text) ? 'end' : 'prorated'; if (v === 'prorated') delete t.accrual; else t.accrual = v; break; }
    case 'evMethod': if (/phys/i.test(text)) t.evMethod = 'physical'; else delete t.evMethod; break;
    case 'calendar': { const c = p.calendars.find(x => x.name.toLowerCase() === text.trim().toLowerCase() || x.id === text); t.calendar = c && !/^none$/i.test(text.trim()) ? c.id : null; break; }
    case 'rollup': case 'hideBar': case 'marked': case 'ignoreResCal': { const v = /^(1|true|yes)$/i.test(text); if (v) t[field] = true; else delete t[field]; break; }
    case 'levelDelay': { const v = parseDuration(text, set, set.durationUnit); if (!v || v.minutes < 0) return { p, error: 'Enter a duration such as 2d.' }; t.levelDelay = v.minutes; break; }
    case 'wbs': if (text.trim()) t.wbsCode = text.trim(); else delete t.wbsCode; break;
    case 'active': t.active = /^(1|true|yes)$/i.test(text); break;
    case 'effortDriven': t.effortDriven = t.type === 'FixedWork' || /^(1|true|yes)$/i.test(text); break;
    default:
      if (field.startsWith('custom:')) {
        const key = field.slice(7), type = cfType(key);
        if (!type) return { p, error: 'Unknown field.' };
        const def = p.fields[key];
        if (def?.formula && (!summary || def.summary === 'formula')) return { p, error: (def.alias || key) + ' is calculated by a formula. Change the formula in Plan › Custom Fields.' };
        if (summary && def && def.summary !== 'none' && def.summary !== 'formula') return { p, error: (def.alias || key) + ' on phases is rolled up from the subtasks.' };
        if (def?.restrict && type === 'Text' && text.trim() && !def.values.some(v => v.value === text)) return { p, error: 'Choose a value from the list for ' + (def.alias || key) + '.' };
        const out = parseCustom(type, text, p);
        if ('error' in out) return { p, error: out.error };
        if (out.value == null) delete t.custom[key]; else t.custom[key] = out.value;
        break;
      }
      return { p, error: 'This field cannot be edited.' };
  }
  return { p: d.p };
}

// Sets % complete and the actual dates that go with it.
function setProgress(t: Task, pct: number, row: Row | undefined) {
  const v = Math.max(0, Math.min(100, pct));
  t.percent = v;
  if (v > 0 && t.actualStart == null) t.actualStart = row ? row.start : null;
  if (v === 0) { t.actualStart = null; t.actualFinish = null; }
  if (v >= 100) t.actualFinish = t.actualFinish ?? (row ? row.finish : null); else t.actualFinish = null;
}

function subtreeEndRows(s: Schedule, i: number) {
  let j = i + 1;
  while (j < s.rows.length && s.rows[j].task.level > s.rows[i].task.level) j++;
  return j;
}

// True when giving task `uid` these predecessors would make it depend on itself. Links on a phase apply
// to all its subtasks, so a task also depends on its phases' predecessors and a summary on its subtasks'.
export function createsCycle(p: Project, uid: number, preds: Link[]): boolean {
  const tasks = p.tasks;
  const parent = new Map<number, number>(), kids = new Map<number, number[]>();
  const stack: Task[] = [];
  tasks.forEach(t => {
    while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    if (stack.length) { const pu = stack[stack.length - 1].uid; parent.set(t.uid, pu); kids.set(pu, (kids.get(pu) || []).concat(t.uid)); }
    stack.push(t);
  });
  const byUid = new Map(tasks.map(t => [t.uid, t]));
  const direct = (u: number) => (u === uid ? preds : byUid.get(u)?.preds || []).map(l => l.pred);
  const ancestors = (u: number) => { const out: number[] = []; for (let q = parent.get(u); q != null; q = parent.get(q)) out.push(q); return out; };
  const descendants = (u: number): number[] => (kids.get(u) || []).flatMap(c => [c, ...descendants(c)]);
  const related = new Set([uid, ...ancestors(uid), ...descendants(uid)]);
  const expand = (u: number) => [u, ...ancestors(u), ...descendants(u)].flatMap(direct);
  const seen = new Set<number>();
  const todo = expand(uid);
  while (todo.length) {
    const q = todo.pop()!;
    if (related.has(q)) return true;
    if (seen.has(q)) continue;
    seen.add(q);
    todo.push(...expand(q));
  }
  return false;
}

/* ---------- row operations ---------- */

// Inserts `count` new tasks before row index `at` (at the end when at >= length), at the outline level of the row there.
export function insertTasks(p: Project, at: number, count = 1, fields: Partial<Task> = {}): { p: Project; uids: number[] } {
  const d = new Draft(p);
  const idx = Math.max(0, Math.min(at, d.p.tasks.length));
  const level = fields.level ?? (idx < d.p.tasks.length ? d.p.tasks[idx].level : idx > 0 ? d.p.tasks[idx - 1].level : 1);
  const made: Task[] = [];
  for (let k = 0; k < count; k++) {
    const t = newTask(d.p, { level, ...fields });
    if (t.mode === 'manual' && fields.start === undefined) t.start = null;
    made.push(t);
  }
  d.p.tasks.splice(idx, 0, ...made);
  d.p.tasks = fixLevels(d.p.tasks);
  return { p: d.p, uids: made.map(t => t.uid) };
}

// The rows to act on: the selected tasks plus all their subtasks, in outline order.
function withSubtrees(p: Project, uids: number[]): number[] {
  const set = new Set(uids), out: number[] = [];
  for (let i = 0; i < p.tasks.length; i++) {
    if (set.has(p.tasks[i].uid)) {
      const e = subtreeEnd(p.tasks, i);
      for (let j = i; j < e; j++) out.push(p.tasks[j].uid);
      i = e - 1;
    }
  }
  return out;
}

export function deleteTasks(p: Project, uids: number[]): Result {
  const gone = new Set(withSubtrees(p, uids));
  if (!gone.size) return { p };
  const tasks = p.tasks.filter(t => !gone.has(t.uid)).map(t => (t.preds.some(l => gone.has(l.pred)) ? { ...t, preds: t.preds.filter(l => !gone.has(l.pred)) } : t));
  return { p: { ...p, tasks: fixLevels(tasks) } };
}

export function indent(p: Project, uids: number[], dir: 1 | -1): Result {
  const tasks = p.tasks.slice();
  const sel = new Set(uids);
  // Each selected task moves with its subtasks; a task can be at most one level below the task above it.
  for (let i = 0; i < tasks.length; i++) {
    if (!sel.has(tasks[i].uid)) continue;
    const e = subtreeEnd(tasks, i);
    if (dir > 0 && (i === 0 || tasks[i].level > tasks[i - 1].level)) { i = e - 1; continue; }
    if (dir < 0 && tasks[i].level === 1) { i = e - 1; continue; }
    for (let j = i; j < e; j++) tasks[j] = { ...tasks[j], level: tasks[j].level + dir };
    i = e - 1;
  }
  const out = fixLevels(tasks);
  return out.every((t, i) => t === p.tasks[i]) ? { p } : { p: { ...p, tasks: out } };
}

export function moveTasks(p: Project, uids: number[], dir: 1 | -1): Result {
  const tasks = p.tasks.slice();
  const first = tasks.findIndex(t => uids.includes(t.uid));
  if (first < 0) return { p };
  const block = withSubtrees(p, [tasks[first].uid]);
  const end = first + block.length;
  if (dir < 0) {
    // Move above the previous sibling (with its subtasks).
    let k = first - 1;
    while (k >= 0 && tasks[k].level > tasks[first].level) k--;
    if (k < 0 || tasks[k].level < tasks[first].level) return { p };
    const moved = tasks.splice(first, block.length);
    tasks.splice(k, 0, ...moved);
  } else {
    if (end >= tasks.length || tasks[end].level < tasks[first].level) return { p };
    const nextEnd = subtreeEnd(tasks, end);
    const moved = tasks.splice(first, block.length);
    tasks.splice(nextEnd - block.length, 0, ...moved);
  }
  return { p: { ...p, tasks: fixLevels(tasks) } };
}

// Links the selected tasks finish-to-start in the order they appear (Ctrl+F2).
export function linkTasks(p: Project, uids: number[], type: LinkType = 'FS'): Result {
  const ordered = p.tasks.filter(t => uids.includes(t.uid)).map(t => t.uid);
  if (ordered.length < 2) return { p, error: 'Select two or more tasks to link.' };
  const d = new Draft(p);
  for (let k = 1; k < ordered.length; k++) {
    const t = d.task(ordered[k]);
    if (t.preds.some(l => l.pred === ordered[k - 1])) continue;
    const next = t.preds.concat([{ pred: ordered[k - 1], type, lag: 0, lagUnit: p.settings.durationUnit, lagElapsed: false, lagPercent: false }]);
    if (createsCycle(d.p, t.uid, next)) return { p, error: 'Those links would create a loop.' };
    t.preds = next;
  }
  return { p: d.p };
}

// Removes links between the selected tasks; with one task selected, removes all its links (Ctrl+Shift+F2).
export function unlinkTasks(p: Project, uids: number[]): Result {
  const sel = new Set(uids), single = uids.length === 1;
  const tasks = p.tasks.map(t => {
    const keep = t.preds.filter(l => single ? !(sel.has(t.uid) || sel.has(l.pred)) : !(sel.has(t.uid) && sel.has(l.pred)));
    return keep.length === t.preds.length ? t : { ...t, preds: keep };
  });
  return { p: { ...p, tasks } };
}

export function setMode(p: Project, s: Schedule, uids: number[], mode: TaskMode): Result {
  const d = new Draft(p);
  uids.forEach(u => {
    const t = d.task(u), r = s.byUid.get(u);
    if (t.mode === mode) return;
    t.mode = mode;
    // A task switched to manual keeps its current dates; switched to auto, it is rescheduled.
    if (mode === 'manual') t.start = r ? r.start : p.start;
    else { t.start = null; t.estimated = false; }
  });
  return { p: d.p };
}

export function setPercent(p: Project, s: Schedule, uids: number[], pct: number): Result {
  const d = new Draft(p);
  const v = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  uids.forEach(u => {
    const r = s.byUid.get(u);
    if (!r) return;
    const targets = r.summary ? s.rows.slice(r.i + 1, subtreeEndRows(s, r.i)).filter(x => !x.summary) : [r];
    targets.forEach(x => {
      const t = d.task(x.task.uid);
      t.percent = v;
      if (v > 0 && t.actualStart == null) t.actualStart = x.start;
      if (v === 0) { t.actualStart = null; t.actualFinish = null; }
      if (v >= 100) t.actualFinish = t.actualFinish ?? x.finish; else t.actualFinish = null;
    });
  });
  return { p: d.p };
}

// Mark as on schedule: progress up to the status date (or today) as scheduled.
export function markOnTrack(p: Project, s: Schedule, uids: number[], now: Minutes): Result {
  const d = new Draft(p);
  const status = p.statusDate ?? now;
  uids.forEach(u => {
    const r = s.byUid.get(u);
    if (!r) return;
    const targets = r.summary ? s.rows.slice(r.i + 1, subtreeEndRows(s, r.i)).filter(x => !x.summary) : [r];
    targets.forEach(x => {
      const t = d.task(x.task.uid), c = s.calendars.get(t.calendar, p.calendar);
      let pct: number;
      if (x.duration === 0) pct = status >= x.start ? 100 : 0;
      else {
        const done = t.elapsed ? status - x.start : c.workBetween(x.start, Math.min(status, x.finish));
        pct = Math.max(0, Math.min(100, Math.round(done / x.duration * 100)));
      }
      t.percent = pct;
      t.actualStart = pct > 0 ? x.start : null;
      t.actualFinish = pct >= 100 ? x.finish : null;
    });
  });
  return { p: d.p };
}

export function updateTask(p: Project, uid: number, patch: Partial<Task>): Project {
  const d = new Draft(p);
  Object.assign(d.task(uid), patch);
  return d.p;
}

export function setBaseline(p: Project, s: Schedule, index: number, uids?: number[]): Project {
  const all = baselineFrom(s);
  const prev = p.baselines[index]?.tasks || {};
  const tasks = uids ? { ...prev, ...Object.fromEntries(uids.filter(u => all[u]).map(u => [u, all[u]])) } : all;
  const baselines = p.baselines.slice();
  baselines[index] = { savedAt: new Date().toISOString(), tasks };
  return { ...p, baselines };
}

export function clearBaseline(p: Project, index: number): Project {
  const baselines = p.baselines.slice();
  baselines[index] = null;
  return { ...p, baselines };
}

/* ---------- resources ---------- */

export function addResources(p: Project, count = 1, fields: Partial<Resource> = {}): { p: Project; uids: number[] } {
  const d = new Draft(p);
  const uids: number[] = [];
  for (let k = 0; k < count; k++) { const r = newResource(d.p, { ...fields, initials: fields.initials || (fields.name ? initials(fields.name) : '') }); d.p.resources.push(r); uids.push(r.uid); }
  return { p: d.p, uids };
}

export function updateResource(p: Project, uid: number, patch: Partial<Resource>): Project {
  const d = new Draft(p);
  const r = d.resource(uid);
  const wasType = r.type;
  Object.assign(r, patch);
  if (patch.name != null && !r.initials) r.initials = initials(r.name);
  if (wasType !== r.type) {
    // Assignments keep their meaning only within a type; recalculate work for changed resources.
    d.p.tasks.forEach(t => { if (t.assignments.some(a => a.res === uid)) { const tt = d.task(t.uid); tt.assignments.forEach(a => { if (a.res === uid) { a.work = r.type === 'Work' ? tt.duration * a.units : 0; } }); } });
  }
  return d.p;
}

export function deleteResources(p: Project, uids: number[]): Project {
  const gone = new Set(uids);
  return {
    ...p,
    resources: p.resources.filter(r => !gone.has(r.uid)),
    tasks: p.tasks.map(t => (t.assignments.some(a => gone.has(a.res)) ? { ...t, assignments: t.assignments.filter(a => !gone.has(a.res)) } : t))
  };
}

export const unitLabel = (u: DurUnit) => ({ m: 'minutes', h: 'hours', d: 'days', w: 'weeks', mo: 'months' }[u]);
export const minutesPer = (u: DurUnit, p: Project) => unitMinutes(u, false, p.settings);


/* ---------- moving rows by dragging ---------- */

// Moves the selected tasks (with their subtasks) so they sit before the task at `before` (a uid), or at the end
// when `before` is null. They take the outline level of the place they are dropped.
export function moveBlock(p: Project, uids: number[], before: number | null, level?: number): Result {
  const block = new Set(withSubtrees(p, uids));
  if (!block.size) return { p };
  if (before != null && block.has(before)) return { p };
  const moving = p.tasks.filter(t => block.has(t.uid));
  const rest = p.tasks.filter(t => !block.has(t.uid));
  let at = before == null ? rest.length : rest.findIndex(t => t.uid === before);
  if (at < 0) at = rest.length;
  const target = level ?? (at < rest.length ? rest[at].level : at > 0 ? rest[at - 1].level : 1);
  const root = moving[0].level;
  const shift = Math.max(1, Math.min(target, at > 0 ? rest[at - 1].level + 1 : 1)) - root;
  const moved = moving.map(t => (shift ? { ...t, level: Math.max(1, t.level + shift) } : t));
  const tasks = rest.slice(0, at).concat(moved, rest.slice(at));
  const out = fixLevels(tasks);
  return out.every((t, i) => t === p.tasks[i]) ? { p } : { p: { ...p, tasks: out } };
}

/* ---------- split tasks ---------- */

// Working minutes of the task done by time t (its pauses excluded).
function workAt(p: Project, s: Schedule, uid: number, t: Minutes): number {
  const r = s.byUid.get(uid)!;
  const cal = s.calendars.get(r.task.calendar, p.calendar);
  let w = 0;
  for (const [a, b] of r.segments || [[r.start, r.finish]]) { if (t <= a) break; w += cal.workBetween(a, Math.min(b, t)); }
  return w;
}

// Task › Split Task: pause the work at `at` for `gap` working minutes (one day by default).
export function splitTask(p: Project, s: Schedule, uid: number, at: Minutes, gap?: number): Result {
  const r = s.byUid.get(uid);
  if (!r || r.summary || r.duration <= 0) return { p, error: 'Only tasks with a duration can be split.' };
  if (r.task.elapsed) return { p, error: 'Tasks with an elapsed duration cannot be split.' };
  const after = Math.round(workAt(p, s, uid, at));
  if (after <= 0 || after >= r.duration) return { p, error: 'Click inside the bar, away from its ends, to split the task.' };
  const d = new Draft(p), t = d.task(uid);
  const g = gap ?? p.settings.minutesPerDay;
  const list = (t.splits || []).slice();
  const same = list.find(x => x.after === after);
  if (same) same.gap += g; else list.push({ after, gap: g });
  t.splits = list.sort((a, b) => a.after - b.after);
  return { p: d.p };
}

// Changes the pause before part k of a split task by `delta` working minutes (dragging that part of the bar).
// A pause reduced to nothing joins the two parts again.
export function moveSegment(p: Project, uid: number, k: number, delta: number): Result {
  const t0 = p.tasks.find(t => t.uid === uid);
  if (!t0?.splits?.length || k < 1) return { p };
  const d = new Draft(p), t = d.task(uid);
  const list = t.splits!.filter(x => x.after < t.duration).sort((a, b) => a.after - b.after);
  const x = list[k - 1];
  if (!x) return { p };
  x.gap = Math.max(0, x.gap + delta);
  t.splits = list.filter(y => y.gap > 0);
  if (!t.splits.length) delete t.splits;
  return { p: d.p };
}

export function removeSplits(p: Project, uids: number[]): Project {
  const set = new Set(uids);
  return { ...p, tasks: p.tasks.map(t => (set.has(t.uid) && t.splits ? (({ splits: _s, ...rest }) => rest as Task)(t) : t)) };
}

/* ---------- recurring tasks ---------- */

// The start of each occurrence, moved to working days when asked.
export function recurrenceDates(p: Project, s: Schedule, rec: Recurrence): Minutes[] {
  const cal = s.calendar;
  const until = rec.until != null ? dayOf(rec.until) : null;
  const days = occurrences(rec, dayOf(rec.from), until, rec.count, 999);
  const out: Minutes[] = [];
  for (const dd of days) {
    let day = dd;
    if (rec.workdaysOnly) { let k = 0; while (!cal.isWorkingDay(day) && k++ < 30) day++; }
    const t = atDay(day, p.settings.defaultStart);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// Inserts a recurring task: a phase with one subtask per occurrence, each held to its date
// with a Start No Earlier Than constraint.
export function insertRecurring(p: Project, s: Schedule, at: number, name: string, rec: Recurrence, replaceUid?: number): { p: Project; uid: number; count: number } | { error: string } {
  const dates = recurrenceDates(p, s, rec);
  if (!dates.length) return { error: 'The pattern gives no occurrences in that range.' };
  if (dates.length > 999) return { error: 'A recurring task can have at most 999 occurrences.' };
  let base = p, idx = at, level: number | undefined;
  if (replaceUid != null) {
    const i = p.tasks.findIndex(t => t.uid === replaceUid);
    if (i < 0) return { error: 'Task not found.' };
    idx = i; level = p.tasks[i].level;
    base = deleteTasks(p, [replaceUid]).p;
  }
  const d = new Draft(base);
  const lv = level ?? (idx < d.p.tasks.length ? d.p.tasks[idx].level : idx > 0 ? d.p.tasks[idx - 1].level : 1);
  const sum = newTask(d.p, { name, level: lv, mode: 'auto', recurrence: { ...rec }, estimated: false });
  const kids = dates.map((t, k) => newTask(d.p, {
    name: name + ' ' + (k + 1), level: lv + 1, mode: 'auto', duration: rec.duration, durUnit: rec.durUnit, estimated: false,
    milestone: rec.duration === 0, constraint: 'SNET', constraintDate: t
  }));
  d.p.tasks.splice(Math.max(0, Math.min(idx, d.p.tasks.length)), 0, sum, ...kids);
  d.p.tasks = fixLevels(d.p.tasks);
  return { p: d.p, uid: sum.uid, count: kids.length };
}

/* ---------- tracking ---------- */

// Plan › Update Plan › "Reschedule uncompleted work to start after": work not done by the status date
// moves after it. Tasks in progress are split; tasks that should have started get Start No Earlier Than.
export function rescheduleUncompleted(p: Project, s: Schedule, after: Minutes, uids?: number[]): Result {
  const d = new Draft(p);
  const set = uids ? new Set(uids) : null;
  let n = 0;
  s.rows.forEach(r => {
    if (r.summary || !r.task.active || (set && !set.has(r.task.uid)) || r.percent >= 100) return;
    const t0 = r.task;
    if (t0.mode === 'manual') return;
    const cal = s.calendars.get(t0.calendar, p.calendar);
    if (r.percent > 0) {
      if (r.completeThrough >= after) return;
      const done = Math.round(r.duration * r.percent / 100);
      const resume = cal.nextWorkStart(after);
      const gap = cal.workBetween(r.completeThrough, resume);
      if (gap <= 0) return;
      const t = d.task(t0.uid);
      const list = (t.splits || []).filter(x => x.after < done);
      list.push({ after: done, gap });
      t.splits = list.sort((a, b) => a.after - b.after);
      n++;
    } else if (r.start < after) {
      const t = d.task(t0.uid);
      t.constraint = 'SNET'; t.constraintDate = cal.nextWorkStart(after);
      n++;
    }
  });
  return { p: d.p, message: n ? 'Rescheduled ' + n + ' task(s) after ' + new Date(after * 60000).toISOString().slice(0, 10) + '.' : 'No uncompleted work was scheduled before that date.' };
}

// Plan › Set Baseline › Set interim plan: copies dates into Start1–10 / Finish1–10.
export function copyInterim(p: Project, s: Schedule, from: 'current' | number, to: number, uids?: number[]): Project {
  const set = uids ? new Set(uids) : null;
  const d = new Draft(p);
  s.rows.forEach(r => {
    if (set && !set.has(r.task.uid)) return;
    let a: Minutes | null, b: Minutes | null;
    if (from === 'current') { a = r.start; b = r.finish; }
    else { const bl = p.baselines[from]?.tasks[r.task.uid]; a = bl?.start ?? null; b = bl?.finish ?? null; }
    const t = d.task(r.task.uid);
    if (a == null) delete t.custom['Start' + to]; else t.custom['Start' + to] = a;
    if (b == null) delete t.custom['Finish' + to]; else t.custom['Finish' + to] = b;
  });
  return d.p;
}

/* ---------- assignments ---------- */

export interface AssignmentPatch { units?: number; work?: number; contour?: Contour; rateTable?: number; ovt?: number; delay?: number; cost?: number }

// Assignment Information: units, work, work contour, cost rate table, overtime work and delay of one assignment.
export function updateAssignment(p: Project, uid: number, res: number, patch: AssignmentPatch): Result {
  const d = new Draft(p), t = d.task(uid);
  const a = t.assignments.find(x => x.res === res);
  if (!a) return { p, error: 'That resource is not assigned to the task.' };
  const r = d.p.resources.find(x => x.uid === res);
  if (patch.contour !== undefined) { if (patch.contour === 'flat') delete a.contour; else a.contour = patch.contour; }
  if (patch.rateTable !== undefined) { if (patch.rateTable > 0) a.rateTable = Math.min(4, patch.rateTable); else delete a.rateTable; }
  if (patch.delay !== undefined) { if (patch.delay > 0) a.delay = patch.delay; else delete a.delay; }
  if (patch.cost !== undefined && r?.type === 'Cost') a.cost = patch.cost;
  if (patch.units !== undefined && Math.abs(patch.units - a.units) > 1e-9) {
    const list = t.assignments.map(x => ({ res: x.res, units: x.res === res ? patch.units! : x.units, cost: x.cost }));
    applyAssignments(d.p, t, list);
  }
  if (patch.work !== undefined && r?.type === 'Work') {
    const b = t.assignments.find(x => x.res === res)!;
    b.work = Math.max(0, patch.work);
    if (t.type === 'FixedDuration') { if (t.duration > 0) b.units = b.work / t.duration; }
    else {
      // Fixed Units and Fixed Work: the task lasts as long as its longest assignment.
      let dmax = 0;
      t.assignments.forEach(x => { if (d.p.resources.find(y => y.uid === x.res)?.type === 'Work' && x.units > 0) dmax = Math.max(dmax, x.work / x.units); });
      t.duration = dmax; t.estimated = false; t.milestone = dmax === 0 && t.mode === 'auto';
    }
  }
  if (patch.ovt !== undefined) { const b = t.assignments.find(x => x.res === res)!; if (patch.ovt > 0) b.ovt = Math.min(b.work, patch.ovt); else delete b.ovt; }
  return { p: d.p };
}

// Moves an assignment from one resource to another (dragging in the Team board).
export function reassign(p: Project, uid: number, from: number | null, to: number | null): Result {
  const d = new Draft(p), t = d.task(uid);
  if (from === to) return { p };
  const list = t.assignments.filter(a => a.res !== from).map(a => ({ res: a.res, units: a.units, cost: a.cost }));
  const old = t.assignments.find(a => a.res === from);
  if (to != null && !list.some(a => a.res === to)) list.push({ res: to, units: old?.units ?? 1, cost: old?.cost ?? 0 });
  applyAssignments(d.p, t, list);
  return { p: d.p };
}

/* ---------- autolink ---------- */

// "Autolink inserted or moved tasks": a task inserted between two linked tasks joins the chain.
export function autolinkInserted(p: Project, uid: number): Project {
  const i = p.tasks.findIndex(t => t.uid === uid);
  if (i <= 0 || i + 1 >= p.tasks.length) return p;
  const above = p.tasks[i - 1], below = p.tasks[i + 1], me = p.tasks[i];
  if (above.level !== me.level || below.level !== me.level) return p;
  const link = below.preds.find(l => l.pred === above.uid && l.type === 'FS');
  if (!link) return p;
  const d = new Draft(p);
  const b = d.task(below.uid), m = d.task(uid);
  b.preds = b.preds.map(l => (l.pred === above.uid ? { ...l, pred: uid } : l));
  if (!m.preds.some(l => l.pred === above.uid)) m.preds = m.preds.concat({ ...link });
  return d.p;
}

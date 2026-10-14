// Opens plans saved by versions 0.3 / 0.4 (whole-day schedules) and older .openplan files.
import { derivedCalendar, standardCalendar, STANDARD_TIMES, type CalendarDef } from './calendar';
import { blankProject, normalizeProject, type ConstraintType, type Project, type TaskType } from './model';
import { atDay, dayOf, parseIso } from './time';

const isObj = (o: unknown): o is Record<string, any> => o != null && typeof o === 'object' && !Array.isArray(o);
const n = (v: unknown, d = 0) => (isFinite(Number(v)) ? Number(v) : d);

export function isLegacy(raw: unknown): boolean {
  return isObj(raw) && raw.format !== 'plancraft' && raw.format !== 'cairn' && Array.isArray(raw.tasks) && Array.isArray(raw.resources);
}

export function fromLegacy(raw: Record<string, any>): Project {
  const p = blankProject(String(raw.name || 'Imported plan'));
  const hpd = Math.max(1, Math.min(24, n(raw.hoursPerDay, 8)));
  const mpd = Math.round(hpd * 60);
  const workDays: number[] = Array.isArray(raw.workDays) && raw.workDays.length ? raw.workDays.map(Number) : [1, 2, 3, 4, 5];
  p.company = String(raw.organization || '');
  p.manager = String(raw.manager || '');
  p.settings.minutesPerDay = mpd;
  p.settings.minutesPerWeek = mpd * workDays.length;
  p.settings.currency = String(raw.currency || p.settings.currency);
  // One working block per day of the plan's length, starting 8:00 (with lunch for a standard 8-hour day).
  const times = mpd === 480 ? STANDARD_TIMES.map(t => ({ ...t })) : [{ from: 480, to: Math.min(1440, 480 + mpd) }];
  const cal: CalendarDef = { ...standardCalendar(), week: [0, 1, 2, 3, 4, 5, 6].map(d => (workDays.includes(d) ? times.map(t => ({ ...t })) : [])) };
  cal.exceptions = (Array.isArray(raw.holidays) ? raw.holidays : []).filter((h: unknown) => parseIso(String(h)) != null).map((h: string) => ({ name: 'Holiday', start: h.slice(0, 10), finish: h.slice(0, 10), times: [] }));
  p.calendars = [cal, ...p.calendars.filter(c => c.id !== 'standard')];
  const startDay = parseIso(String(raw.start || '')) ;
  if (startDay != null) p.start = atDay(dayOf(startDay), 480);
  p.statusDate = raw.statusDate && parseIso(raw.statusDate) != null ? atDay(dayOf(parseIso(raw.statusDate)!), 1020) : null;
  const dateAt = (s: unknown, minute: number) => { const t = parseIso(String(s || '')); return t == null ? null : atDay(dayOf(t), minute); };
  // Old free-form custom fields move to Text/Number fields in normalizeProject.
  (p as any).customFields = (Array.isArray(raw.customFields) ? raw.customFields : []).filter(isObj).map((f: any) => ({ id: String(f.id), name: String(f.name), type: f.type === 'number' ? 'number' : 'text' }));

  const resources = (raw.resources as any[]).filter(isObj);
  p.resources = resources.map(r => {
    const kind = r.kind === 'Material' || r.kind === 'Cost' ? r.kind : 'Work';
    const own = Array.isArray(r.workDays) && r.workDays.length && r.workDays.join() !== workDays.join();
    const vac = Array.isArray(r.vacations) ? r.vacations.filter((v: unknown) => parseIso(String(v)) != null) : [];
    let calendar = 'standard';
    if (kind === 'Work' && (own || vac.length)) {
      const c = derivedCalendar('res-' + r.uid, String(r.name || 'Resource'), 'standard');
      if (own) c.week = [0, 1, 2, 3, 4, 5, 6].map(d => (r.workDays.map(Number).includes(d) ? times.map(t => ({ ...t })) : []));
      c.exceptions = vac.map((v: string) => ({ name: 'Leave', start: v.slice(0, 10), finish: v.slice(0, 10), times: [] }));
      p.calendars.push(c);
      calendar = c.id;
    }
    return {
      uid: n(r.uid), name: String(r.name || ''), initials: String(r.initials || ''), group: String(r.role || ''), type: kind as 'Work',
      materialLabel: String(r.materialLabel || ''), maxUnits: n(r.maxUnits, 100) / 100, stdRate: n(r.rate), ovtRate: 0, costPerUse: n(r.costPerUse),
      calendar, notes: '', rates: (Array.isArray(r.rates) ? r.rates : []).filter(isObj).map((x: any) => ({ from: dateAt(x.from, 0) ?? 0, rate: n(x.rate) }))
    };
  });
  const kindOf = new Map(p.resources.map(r => [r.uid, r.type]));
  const CON: ConstraintType[] = ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];
  p.tasks = (raw.tasks as any[]).filter(isObj).map(t => {
    const dur = t.milestone ? 0 : Math.max(0, n(t.duration, 1)) * mpd;
    const constraint: ConstraintType = CON.includes(t.constraint) ? t.constraint : t.snet ? 'SNET' : 'ASAP';
    const cdate = t.constraintDate || t.snet;
    return {
      uid: n(t.uid), name: String(t.name || ''), level: Math.max(1, n(t.level, 1)), active: true, mode: 'auto',
      type: (['FixedUnits', 'FixedWork', 'FixedDuration'].includes(t.type) ? t.type : 'FixedUnits') as TaskType, effortDriven: !!t.effortDriven,
      duration: dur, durUnit: 'd', elapsed: false, estimated: false, milestone: !!t.milestone || dur === 0, start: null,
      constraint, constraintDate: constraint === 'ASAP' || constraint === 'ALAP' ? null : dateAt(cdate, /^(F|MFO)/.test(constraint) ? 1020 : 480),
      deadline: dateAt(t.deadline, 1020), calendar: null, priority: n(t.priority, 500), levelDelay: Math.max(0, n(t.levelDelay)) * mpd,
      preds: (Array.isArray(t.preds) ? t.preds : []).filter(isObj).map((l: any) => ({ pred: n(l.uid), type: ['FS', 'SS', 'FF', 'SF'].includes(l.type) ? l.type : 'FS', lag: n(l.lag) * mpd, lagUnit: 'd', lagElapsed: false, lagPercent: false })),
      assignments: (Array.isArray(t.assignments) ? t.assignments : []).filter(isObj).map((a: any) => {
        const k = kindOf.get(n(a.res));
        if (k === 'Cost') return { res: n(a.res), units: 1, work: 0, cost: n(a.units) };
        if (k === 'Material') return { res: n(a.res), units: n(a.units), work: 0, cost: 0 };
        return { res: n(a.res), units: n(a.units, 100) / 100, work: dur * n(a.units, 100) / 100, cost: 0 };
      }),
      percent: n(t.percent), actualStart: dateAt(t.actualStart, 480), actualFinish: dateAt(t.actualFinish, 1020), fixedCost: n(t.fixedCost),
      notes: String(t.notes || ''), timeline: false, custom: isObj(t.custom) ? t.custom : {}
    };
  });
  if (isObj(raw.baseline) && isObj(raw.baseline.tasks)) {
    const tasks: Record<number, any> = {};
    Object.entries(raw.baseline.tasks).forEach(([uid, b]: [string, any]) => {
      const st = dateAt(b.start, 480), fi = dateAt(b.finish, 1020);
      if (st != null && fi != null) tasks[+uid] = { start: st, finish: fi, duration: n(b.duration) * mpd, work: n(b.work) * 60, cost: n(b.cost) };
    });
    p.baselines[0] = { savedAt: String(raw.baseline.savedAt || ''), tasks };
  }
  p.nextTaskUid = Math.max(1, ...p.tasks.map(t => t.uid + 1));
  p.nextResUid = Math.max(1, ...p.resources.map(r => r.uid + 1));
  return normalizeProject(JSON.parse(JSON.stringify(p)));
}

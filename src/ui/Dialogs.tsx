// Dialogs: Task details, Plan settings, Working days and holidays, Person details, Set Baseline and others.
import { useMemo, useState, type ReactNode } from 'react';
import { F, Modal } from './Modal';
import { ImportTableDialog, ExportDialog } from './ImportDialogs';
import { openFile } from './actions';
import { DateInput } from './DatePicker';
import { CustomFields, FieldSettings, TableColumns, TextStyles } from './FieldDialogs';
import { BarStylesDialog, FontDialog, FormatBarDialog, GridlinesDialog, LayoutDialog, ProgressLinesDialog, TimescaleDialog } from './FormatDialogs';
import { CopyPictureDialog, FindDialog, GoToDialog, HyperlinkDialog, MultiInfoDialog, NotesDialog, RecurringDialog, SaveViewDialog, UpdateTasksDialog } from './TaskDialogs';
import { FilterArgsDialog, FilterEditor, GroupEditor, MoreFiltersDialog, MoreGroupsDialog, SortDialog } from './DataDialogs';
import { AssignmentInfoDialog, BalancingOptionsDialog, LevelResourceDialog, WbsCodeDialog } from './ProjectDialogs';
import { CONSTRAINT_NAMES, TASK_TYPE_NAMES, type ConstraintType, type LinkType, type Project, type ResourceType, type TaskType } from '../engine/model';
import { addResources, clearBaseline, copyInterim, editCell, formatResourceNames, markOnTrack, rescheduleUncompleted, setBaseline, updateResource, updateTask } from '../engine/ops';
import { CalendarSet, cleanTimes, derivedCalendar, minutesIn, standardCalendar, STANDARD_TIMES, type CalendarDef, type WorkingTime } from '../engine/calendar';
import { formatDuration, formatShort } from '../engine/duration';
import { schedule } from '../engine/schedule';
import { atDay, clock, DATE_FORMAT_LABELS, DATE_FORMATS, DAYS_LONG, dayOf, fmtDate, isoDate, MONTHS_LONG, parseDateText, parseIso, weekday, ymd, type Minutes } from '../engine/time';
import type { ImportReport } from '../engine/projectxml';
import { S, useStore } from './store';
import { formatRaw, money } from './columns';
import { FIELDS, fieldName, customValue } from '../engine/fields';
import { cfType } from '../engine/model';
import Icon from './Icon';
import { moveSelected } from './commands';

const fmtD = (p: Project, t: Minutes | null | undefined, time = true) => (t == null ? '' : fmtDate(t, { time, format: p.settings.dateFormat }));
const parseD = (p: Project, text: string, minute: number): Minutes | null | 'bad' => {
  if (!text.trim() || /^na$/i.test(text.trim())) return null;
  const d = parseDateText(text, p.settings.dateFormat);
  return d ? atDay(d.day, d.minute ?? minute) : 'bad';
};

/* ---------- Task details ---------- */

// Values of the custom fields that are set up in this plan or used by this task, as text for editing.
function customTexts(p: Project, s: ReturnType<typeof schedule>, r: NonNullable<ReturnType<ReturnType<typeof schedule>['byUid']['get']>>): Record<string, string> {
  const keys = new Set([...Object.keys(p.fields), ...Object.keys(r.task.custom)]);
  const out: Record<string, string> = {};
  FIELDS.forEach(fd => {
    if (!fd.custom || !keys.has(fd.key)) return;
    const v = customValue(r, { p, s }, fd.key);
    if (fd.type === 'date') out[fd.key] = typeof v === 'number' ? fmtDate(v, { time: true, format: p.settings.dateFormat }) : r.task.custom[fd.key] == null ? '' : 'NA';
    else if (fd.type === 'text') out[fd.key] = String(v ?? '');
    else if (fd.type === 'flag') out[fd.key] = v ? 'Yes' : 'No';
    else out[fd.key] = r.task.custom[fd.key] == null && !p.fields[fd.key]?.formula ? '' : formatRaw(v, fd.type, { p });
  });
  return out;
}

interface PredRow { id: string; type: LinkType; lag: string }
interface ResRow { name: string; units: string }

function TaskInfo({ uid, tab: initialTab }: { uid: number; tab?: string }) {
  const st = useStore();
  const { p, s } = st;
  const r = s.byUid.get(uid);
  const [tab, setTab] = useState(initialTab || 'general');
  const t = r?.task;
  const durText = r ? formatDuration({ minutes: r.duration, unit: r.summary ? p.settings.durationUnit : r.task.durUnit, elapsed: r.task.elapsed, estimated: r.task.estimated }, p.settings) : '';
  const [f, setF] = useState(() => ({
    name: t?.name || '', duration: durText, percent: String(Math.round(r?.percent || 0)), priority: String(t?.priority ?? 500),
    start: fmtD(p, r?.start), finish: fmtD(p, r?.finish), mode: t?.mode || 'auto', active: t?.active ?? true, timeline: t?.timeline ?? false,
    deadline: fmtD(p, t?.deadline), constraint: (t?.constraint || 'ASAP') as ConstraintType, constraintDate: fmtD(p, t?.constraintDate),
    type: (t?.type || 'FixedUnits') as TaskType, effortDriven: t?.effortDriven ?? false, calendar: t?.calendar || '', milestone: !!t?.milestone,
    notes: t?.notes || '', fixedCost: String(t?.fixedCost ?? 0), custom: r ? customTexts(p, s, r) : {},
    rollup: !!t?.rollup, hideBar: !!t?.hideBar, evMethod: t?.evMethod || 'percent', physPercent: String(t?.physPercent ?? 0), accrual: t?.accrual || 'prorated', wbs: t?.wbsCode || ''
  }));
  const [customInit] = useState(() => ({ ...f.custom }));
  const [addField, setAddField] = useState('');
  const [preds, setPreds] = useState<PredRow[]>(() => (t?.preds || []).map(l => ({ id: String(s.byUid.get(l.pred)?.id ?? ''), type: l.type, lag: l.lag ? (l.lag > 0 ? '' : '-') + (l.lagPercent ? Math.abs(l.lag) + '%' : formatShort(Math.abs(l.lag), l.lagUnit, l.lagElapsed, p.settings)) : '0d' })));
  const [res, setRes] = useState<ResRow[]>(() => (t?.assignments || []).map(a => { const rr = p.resources.find(x => x.uid === a.res)!; return { name: rr.name, units: rr.type === 'Work' ? Math.round(a.units * 100) + '%' : rr.type === 'Cost' ? String(a.cost) : String(a.units) }; }));
  if (!r || !t) return <Modal title="Task details" noOk cancelLabel="Close"><p>Select a task first.</p></Modal>;
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const wd = (d: number) => s.calendar.isWorkingDay(d);
  const ok = () => {
    let pp = st.p;
    const errors: string[] = [];
    const run = (field: Parameters<typeof editCell>[3], text: string, before: string) => {
      if (text === before) return;
      const out = editCell(pp, schedule(pp), uid, field, text);
      if (out.error) errors.push(out.error); else pp = out.p;
    };
    run('name', f.name, t.name);
    if (f.mode !== t.mode) { run('mode', f.mode === 'manual' ? 'Pinned' : 'Auto', ''); }
    run('type', f.type, t.type);
    if (f.effortDriven !== t.effortDriven) run('effortDriven', String(f.effortDriven), '');
    if (f.calendar !== (t.calendar || '')) pp = updateTask(pp, uid, { calendar: f.calendar || null });
    if (!r.summary) run('duration', f.duration, durText);
    run('constraint', f.constraint, t.constraint);
    if (f.constraint !== 'ASAP' && f.constraint !== 'ALAP') run('constraintDate', f.constraintDate, fmtD(p, t.constraintDate));
    run('deadline', f.deadline, fmtD(p, t.deadline));
    if (f.start !== fmtD(p, r.start)) run('start', f.start, '');
    if (!r.summary && f.finish !== fmtD(p, r.finish)) run('finish', f.finish, '');
    run('priority', f.priority, String(t.priority));
    run('fixedCost', f.fixedCost, String(t.fixedCost));
    if (!t.notesHtml) run('notes', f.notes, t.notes);
    if (f.rollup !== !!t.rollup) run('rollup', String(f.rollup), '');
    if (f.hideBar !== !!t.hideBar) run('hideBar', String(f.hideBar), '');
    if (f.evMethod !== (t.evMethod || 'percent')) run('evMethod', f.evMethod === 'physical' ? 'Physical' : '% Complete', '');
    run('physPercent', f.physPercent, String(t.physPercent ?? 0));
    if (f.accrual !== (t.accrual || 'prorated')) run('accrual', f.accrual, '');
    run('wbs', f.wbs, t.wbsCode || '');
    if (f.active !== t.active || f.timeline !== t.timeline || f.milestone !== t.milestone) {
      pp = updateTask(pp, uid, { active: f.active, timeline: f.timeline });
      if (f.milestone !== t.milestone) run('milestone', String(f.milestone), '');
    }
    const predText = preds.filter(x => x.id.trim()).map(x => x.id.trim() + (x.type !== 'FS' || (x.lag && parseFloat(x.lag)) ? x.type : '') + (x.lag && parseFloat(x.lag) ? (x.lag.trim().startsWith('-') ? '' : '+') + x.lag.trim() : '')).join(',');
    run('preds', predText, (t.preds.length ? '\u0000' : ''));
    const resText = res.filter(x => x.name.trim()).map(x => {
      const rr = pp.resources.find(y => y.name === x.name.trim());
      if (rr?.type === 'Cost') return x.name.trim() + (x.units ? '[' + x.units.replace(/[^\d.]/g, '') + ']' : '');
      return x.name.trim() + (x.units ? '[' + x.units + ']' : '');
    }).join(',');
    if (resText !== formatResourceNames(pp, pp.tasks.find(x => x.uid === uid)!)) run('resources', resText, '\u0000');
    run('percent', f.percent, String(Math.round(r.percent)));
    Object.entries(f.custom).forEach(([k, v]) => run(('custom:' + k) as any, v, customInit[k] ?? ''));
    if (errors.length) { S().notify(errors[0], true); return false; }
    st.commit(pp);
  };
  const tabs: [string, string][] = [['general', 'General'], ['preds', 'Predecessors'], ['res', 'Resources'], ['advanced', 'Advanced'], ['notes', 'Notes'], ['custom', 'Custom fields']];
  const header = (
    <div className="ti-head">
      <F label="Name" wide><input className="inp" value={f.name} onChange={e => set({ name: e.target.value })} autoFocus /></F>
      <F label="Duration"><input className="inp" value={r.summary ? durText : f.duration} disabled={r.summary} onChange={e => set({ duration: e.target.value })} /></F>
    </div>
  );
  const taskOptions = s.rows.filter(x => x.task.uid !== uid);
  return (
    <Modal title={r.summary ? 'Phase details' : 'Task details'} onOk={ok} wide>
      <div className="tabs">{tabs.map(([k, l]) => <button type="button" key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {header}
      {tab === 'general' && <div className="grid2">
        <F label="% complete"><input className="inp" type="number" min={0} max={100} value={f.percent} onChange={e => set({ percent: e.target.value })} /></F>
        <F label="Priority"><input className="inp" type="number" min={0} max={1000} value={f.priority} onChange={e => set({ priority: e.target.value })} /></F>
        <F label="Schedule Mode"><select className="inp" value={f.mode} onChange={e => set({ mode: e.target.value as 'auto' | 'manual' })}><option value="manual">Pinned</option><option value="auto">Auto Scheduled</option></select></F>
        <label className="chk"><input type="checkbox" checked={!f.active} onChange={e => set({ active: !e.target.checked })} />Inactive</label>
        <F label="Start"><DateInput value={f.start} format={p.settings.dateFormat} defaultMinute={p.settings.defaultStart} workingDay={wd} onChange={v => set({ start: v })} /></F>
        <F label="Finish"><DateInput value={f.finish} format={p.settings.dateFormat} defaultMinute={p.settings.defaultFinish} workingDay={wd} disabled={r.summary} onChange={v => set({ finish: v })} /></F>
        <label className="chk"><input type="checkbox" checked={f.timeline} onChange={e => set({ timeline: e.target.checked })} />Display on Timeline</label>
        <label className="chk"><input type="checkbox" checked={f.hideBar} onChange={e => set({ hideBar: e.target.checked })} />Hide bar</label>
        <label className="chk"><input type="checkbox" checked={f.rollup} onChange={e => set({ rollup: e.target.checked })} />Roll up Gantt bar to summary</label>
        {t.recurrence && <button type="button" className="btn" onClick={() => S().open('recurring', { uid })}><Icon name="recur" />Repeating task…</button>}
        {t.hyperlink && <button type="button" className="btn" onClick={() => S().open('hyperlink', { uid })}><Icon name="hyperlink" />{t.hyperlink.text || t.hyperlink.address}</button>}
        {f.mode === 'auto' && !r.summary && <p className="hint">Typing a start or finish date on an auto-scheduled task sets a Start/Finish No Earlier Than constraint.</p>}
      </div>}
      {tab === 'preds' && <div>
        <table className="mini"><thead><tr><th>ID</th><th>Task Name</th><th>Type</th><th>Lag</th><th /></tr></thead><tbody>
          {preds.map((x, k) => (
            <tr key={k}>
              <td><input className="inp sm" value={x.id} onChange={e => setPreds(preds.map((y, j) => (j === k ? { ...y, id: e.target.value } : y)))} /></td>
              <td><select className="inp" value={x.id} onChange={e => setPreds(preds.map((y, j) => (j === k ? { ...y, id: e.target.value } : y)))}>
                <option value="">(choose a task)</option>{taskOptions.map(o => <option key={o.task.uid} value={String(o.id)}>{o.id} {o.task.name}</option>)}</select></td>
              <td><select className="inp" value={x.type} onChange={e => setPreds(preds.map((y, j) => (j === k ? { ...y, type: e.target.value as LinkType } : y)))}>
                <option value="FS">Finish-to-Start (FS)</option><option value="SS">Start-to-Start (SS)</option><option value="FF">Finish-to-Finish (FF)</option><option value="SF">Start-to-Finish (SF)</option></select></td>
              <td><input className="inp sm" value={x.lag} onChange={e => setPreds(preds.map((y, j) => (j === k ? { ...y, lag: e.target.value } : y)))} /></td>
              <td><button type="button" className="icon-btn" aria-label="Remove" onClick={() => setPreds(preds.filter((_, j) => j !== k))}><Icon name="x" /></button></td>
            </tr>
          ))}
        </tbody></table>
        <button type="button" className="btn" onClick={() => setPreds(preds.concat({ id: '', type: 'FS', lag: '0d' }))}><Icon name="plus" />Add predecessor</button>
        <p className="hint">Lag accepts durations (2d, 4h, 1w, 3ed) or a percentage of the predecessor (50%). A negative lag is a lead.</p>
      </div>}
      {tab === 'res' && <div>
        <table className="mini"><thead><tr><th>Resource Name</th><th>Units / Quantity / Cost</th><th /></tr></thead><tbody>
          {res.map((x, k) => (
            <tr key={k}>
              <td><input className="inp" list="pc-res" value={x.name} onChange={e => setRes(res.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)))} /></td>
              <td><input className="inp sm" value={x.units} onChange={e => setRes(res.map((y, j) => (j === k ? { ...y, units: e.target.value } : y)))} /></td>
              <td><button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRes(res.filter((_, j) => j !== k))}><Icon name="x" /></button></td>
            </tr>
          ))}
        </tbody></table>
        <datalist id="pc-res">{p.resources.map(x => <option key={x.uid} value={x.name} />)}</datalist>
        <div className="row-btns"><button type="button" className="btn" onClick={() => setRes(res.concat({ name: '', units: '100%' }))}><Icon name="plus" />Add resource</button>
          {t.assignments.length > 0 && <button type="button" className="btn" onClick={() => S().open('assignmentInfo', { uid })}><Icon name="assigninfo" />Assignment Information…</button>}</div>
        <p className="hint">Work resources take units (50%), material resources a quantity, cost resources an amount. New names are added to the People view.</p>
      </div>}
      {tab === 'advanced' && <div className="grid2">
        <F label="Deadline"><DateInput value={f.deadline} format={p.settings.dateFormat} defaultMinute={p.settings.defaultFinish} workingDay={wd} onChange={v => set({ deadline: v })} /></F>
        <span />
        <F label="Constraint type"><select className="inp" value={f.constraint} onChange={e => set({ constraint: e.target.value as ConstraintType })}>{Object.entries(CONSTRAINT_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Constraint date"><DateInput value={f.constraintDate} format={p.settings.dateFormat} defaultMinute={/^F|MFO/.test(f.constraint) ? p.settings.defaultFinish : p.settings.defaultStart} workingDay={wd} disabled={f.constraint === 'ASAP' || f.constraint === 'ALAP'} onChange={v => set({ constraintDate: v })} /></F>
        <F label="Task type"><select className="inp" value={f.type} onChange={e => set({ type: e.target.value as TaskType, effortDriven: e.target.value === 'FixedWork' ? true : f.effortDriven })}>{Object.entries(TASK_TYPE_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <label className="chk"><input type="checkbox" checked={f.effortDriven} disabled={f.type === 'FixedWork'} onChange={e => set({ effortDriven: e.target.checked })} />Effort driven</label>
        <F label="Calendar"><select className="inp" value={f.calendar} onChange={e => set({ calendar: e.target.value })}><option value="">None</option>{p.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        <F label="WBS code"><input className="inp" value={f.wbs} placeholder={r.wbs} onChange={e => set({ wbs: e.target.value })} /></F>
        <F label="Fixed cost"><input className="inp" value={f.fixedCost} onChange={e => set({ fixedCost: e.target.value })} /></F>
        <F label="Fixed cost accrual"><select className="inp" value={f.accrual} onChange={e => set({ accrual: e.target.value as 'start' | 'prorated' | 'end' })}><option value="start">Start</option><option value="prorated">Prorated</option><option value="end">End</option></select></F>
        <F label="Earned value method"><select className="inp" value={f.evMethod} onChange={e => set({ evMethod: e.target.value as 'percent' | 'physical' })}><option value="percent">% Complete</option><option value="physical">Physical % Complete</option></select></F>
        <F label="Physical % complete"><input className="inp" value={f.physPercent} onChange={e => set({ physPercent: e.target.value })} /></F>
        <label className="chk"><input type="checkbox" checked={f.milestone} onChange={e => set({ milestone: e.target.checked })} />Mark task as milestone</label>
      </div>}
      {tab === 'notes' && (t.notesHtml
        ? <div><div className="notes-view" dangerouslySetInnerHTML={{ __html: t.notesHtml }} /><button type="button" className="btn" onClick={() => S().open('notes', { uid })}><Icon name="note" />Edit formatted notes…</button></div>
        : <><textarea className="inp notes" rows={10} value={f.notes} onChange={e => set({ notes: e.target.value })} /><button type="button" className="linkbtn" onClick={() => S().open('notes', { uid })}>Format notes (bold, lists, colours, links, pictures)…</button></>)}
      {tab === 'custom' && <div>
        <table className="mini"><thead><tr><th>Custom field</th><th>Value</th></tr></thead><tbody>
          {Object.keys(f.custom).map(k => {
            const def = p.fields[k], calc = !!def?.formula && (!r.summary || def.summary === 'formula');
            const type = cfType(k);
            return (
              <tr key={k}>
                <td title={k}>{fieldName(k, p, true)}</td>
                <td>{calc ? <span className="muted">{f.custom[k]} <i>(formula)</i></span>
                  : type === 'Flag' ? <select className="inp" value={f.custom[k] || 'No'} onChange={e => set({ custom: { ...f.custom, [k]: e.target.value } })}><option>Yes</option><option>No</option></select>
                    : type === 'Date' || type === 'Start' || type === 'Finish' ? <DateInput value={f.custom[k]} format={p.settings.dateFormat} defaultMinute={type === 'Finish' ? p.settings.defaultFinish : p.settings.defaultStart} onChange={v => set({ custom: { ...f.custom, [k]: v } })} />
                      : <input className="inp" list={def?.values.length ? 'cf-' + k : undefined} value={f.custom[k]} onChange={e => set({ custom: { ...f.custom, [k]: e.target.value } })} />}
                  {def?.values.length ? <datalist id={'cf-' + k}>{def.values.map(v => <option key={v.value} value={v.value}>{v.desc}</option>)}</datalist> : null}
                </td>
              </tr>
            );
          })}
        </tbody></table>
        {!Object.keys(f.custom).length && <p className="muted">No custom fields are in use. Choose one below, or set them up with Plan › Custom Fields.</p>}
        <div className="row-btns">
          <select className="inp" value={addField} onChange={e => setAddField(e.target.value)}>
            <option value="">Add a value to another field…</option>
            {FIELDS.filter(x => x.custom && !(x.key in f.custom)).map(x => <option key={x.key} value={x.key}>{fieldName(x.key, p, true)}</option>)}
          </select>
          <button type="button" className="btn" disabled={!addField} onClick={() => { set({ custom: { ...f.custom, [addField]: '' } }); setAddField(''); }}><Icon name="plus" />Add</button>
        </div>
      </div>}
    </Modal>
  );
}

/* ---------- Plan settings and Options ---------- */

function ProjectInfo({ options }: { options?: boolean }) {
  const st = useStore();
  const p = st.p, set0 = p.settings;
  const [f, setF] = useState(() => ({
    name: p.name, company: p.company, manager: p.manager, subject: p.subject, start: fmtD(p, p.start), status: fmtD(p, p.statusDate, false), calendar: p.calendar,
    hpd: String(set0.minutesPerDay / 60), hpw: String(set0.minutesPerWeek / 60), dpm: String(set0.daysPerMonth), dstart: clock(set0.defaultStart), dfinish: clock(set0.defaultFinish),
    mode: set0.newTaskMode, type: set0.defaultType, effort: set0.effortDriven, honor: set0.honorConstraints, critical: String(set0.criticalSlack / set0.minutesPerDay),
    durUnit: set0.durationUnit, workUnit: set0.workUnit, currency: set0.currency, dateFormat: set0.dateFormat, showTime: set0.showTime,
    from: p.scheduleFrom, finish: fmtD(p, p.finish ?? st.s.finish), multi: set0.multipleCritical, autoLink: set0.autoLink, changes: set0.changeHighlight, splitIP: set0.splitInProgress
  }));
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const tm = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? +m[1] * 60 + +m[2] : null; };
  const ok = () => {
    const start = parseD(p, f.start, tm(f.dstart) ?? 480), status = parseD(p, f.status, tm(f.dfinish) ?? 1020), finish = parseD(p, f.finish, tm(f.dfinish) ?? 1020);
    if (f.from === 'finish' && (finish === 'bad' || finish == null)) { S().notify('Enter the project finish date.', true); return false; }
    if (start === 'bad' || start == null) { S().notify('Enter a valid start date.', true); return false; }
    if (status === 'bad') { S().notify('Enter a valid status date, or NA.', true); return false; }
    const hpd = +f.hpd, hpw = +f.hpw, dpm = +f.dpm, ds = tm(f.dstart), df = tm(f.dfinish);
    if (!(hpd > 0 && hpd <= 24 && hpw > 0 && hpw <= 168 && dpm > 0 && dpm <= 31) || ds == null || df == null) { S().notify('Check the calendar options.', true); return false; }
    st.commit({
      ...p, name: f.name.trim() || p.name, company: f.company, manager: f.manager, subject: f.subject, start, statusDate: status, calendar: f.calendar,
      scheduleFrom: f.from, finish: f.from === 'finish' && finish !== 'bad' ? finish : p.finish,
      settings: { ...set0, minutesPerDay: Math.round(hpd * 60), minutesPerWeek: Math.round(hpw * 60), daysPerMonth: dpm, defaultStart: ds, defaultFinish: df, newTaskMode: f.mode, defaultType: f.type,
        effortDriven: f.effort, honorConstraints: f.honor, criticalSlack: Math.round(+f.critical * hpd * 60) || 0, durationUnit: f.durUnit, workUnit: f.workUnit, currency: f.currency, dateFormat: f.dateFormat, showTime: f.showTime,
        multipleCritical: f.multi, autoLink: f.autoLink, changeHighlight: f.changes, splitInProgress: f.splitIP }
    });
  };
  return (
    <Modal title={options ? 'Preferences' : 'Plan settings'} onOk={ok} wide extra={<button type="button" className="btn" onClick={() => S().open('stats')}>Statistics…</button>}>
      <h3>Project</h3>
      <div className="grid2">
        <F label="Project name"><input className="inp" value={f.name} onChange={e => set({ name: e.target.value })} /></F>
        <F label="Subject"><input className="inp" value={f.subject} onChange={e => set({ subject: e.target.value })} /></F>
        <F label="Company"><input className="inp" value={f.company} onChange={e => set({ company: e.target.value })} /></F>
        <F label="Manager"><input className="inp" value={f.manager} onChange={e => set({ manager: e.target.value })} /></F>
        <F label="Schedule from"><select className="inp" value={f.from} onChange={e => set({ from: e.target.value as 'start' | 'finish' })}><option value="start">Project Start Date</option><option value="finish">Project Finish Date</option></select></F>
        {f.from === 'start' ? <F label="Start date"><DateInput value={f.start} format={p.settings.dateFormat} defaultMinute={p.settings.defaultStart} onChange={v => set({ start: v })} /></F>
          : <F label="Finish date"><DateInput value={f.finish} format={p.settings.dateFormat} defaultMinute={p.settings.defaultFinish} onChange={v => set({ finish: v })} /></F>}
        <F label="Status date"><DateInput value={f.status} format={p.settings.dateFormat} defaultMinute={p.settings.defaultFinish} onChange={v => set({ status: v })} /></F>
        <F label="Calendar"><select className="inp" value={f.calendar} onChange={e => set({ calendar: e.target.value })}>{p.calendars.filter(c => !c.base).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        <p className="hint">{f.from === 'finish' ? 'All tasks are scheduled as late as possible so the project ends on the finish date; the start date is calculated.' : 'All tasks start as soon as possible from the start date; the finish date is calculated.'}</p>
      </div>
      <h3>Schedule options</h3>
      <div className="grid2">
        <F label="New tasks created"><select className="inp" value={f.mode} onChange={e => set({ mode: e.target.value as 'auto' | 'manual' })}><option value="manual">Pinned</option><option value="auto">Auto Scheduled</option></select></F>
        <F label="Default task type"><select className="inp" value={f.type} onChange={e => set({ type: e.target.value as TaskType })}>{Object.entries(TASK_TYPE_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Duration is entered in"><select className="inp" value={f.durUnit} onChange={e => set({ durUnit: e.target.value as any })}><option value="m">Minutes</option><option value="h">Hours</option><option value="d">Days</option><option value="w">Weeks</option><option value="mo">Months</option></select></F>
        <F label="Work is entered in"><select className="inp" value={f.workUnit} onChange={e => set({ workUnit: e.target.value as any })}><option value="m">Minutes</option><option value="h">Hours</option><option value="d">Days</option><option value="w">Weeks</option><option value="mo">Months</option></select></F>
        <label className="chk"><input type="checkbox" checked={f.effort} onChange={e => set({ effort: e.target.checked })} />New tasks are effort driven</label>
        <label className="chk"><input type="checkbox" checked={f.honor} onChange={e => set({ honor: e.target.checked })} />Tasks will always honor their constraint dates</label>
        <F label="Tasks are critical if slack is less than or equal to (days)"><input className="inp" value={f.critical} onChange={e => set({ critical: e.target.value })} /></F>
        <label className="chk"><input type="checkbox" checked={f.multi} onChange={e => set({ multi: e.target.checked })} />Calculate multiple critical paths</label>
        <label className="chk"><input type="checkbox" checked={f.autoLink} onChange={e => set({ autoLink: e.target.checked })} />Autolink inserted tasks</label>
        <label className="chk"><input type="checkbox" checked={f.splitIP} onChange={e => set({ splitIP: e.target.checked })} />Split in-progress tasks when rescheduling</label>
        <label className="chk"><input type="checkbox" checked={f.changes} onChange={e => set({ changes: e.target.checked })} />Highlight cells changed by the last edit</label>
      </div>
      <h3>Calendar options</h3>
      <div className="grid2">
        <F label="Default start time"><input className="inp" value={f.dstart} onChange={e => set({ dstart: e.target.value })} /></F>
        <F label="Default end time"><input className="inp" value={f.dfinish} onChange={e => set({ dfinish: e.target.value })} /></F>
        <F label="Hours per day"><input className="inp" value={f.hpd} onChange={e => set({ hpd: e.target.value })} /></F>
        <F label="Hours per week"><input className="inp" value={f.hpw} onChange={e => set({ hpw: e.target.value })} /></F>
        <F label="Days per month"><input className="inp" value={f.dpm} onChange={e => set({ dpm: e.target.value })} /></F>
      </div>
      <h3>Display</h3>
      <div className="grid2">
        <F label="Currency symbol"><input className="inp" value={f.currency} onChange={e => set({ currency: e.target.value })} /></F>
        <F label="Date format"><select className="inp" value={f.dateFormat} onChange={e => set({ dateFormat: e.target.value as any })}>{DATE_FORMATS.map(k => <option key={k} value={k}>{DATE_FORMAT_LABELS[k]}</option>)}</select></F>
        <label className="chk"><input type="checkbox" checked={f.showTime} onChange={e => set({ showTime: e.target.checked })} />Show times with dates</label>
      </div>
    </Modal>
  );
}

function Stats() {
  const { p, s } = useStore();
  const bl = p.baselines[0];
  let bStart: number | null = null, bFinish: number | null = null, bWork = 0, bCost = 0;
  if (bl) Object.values(bl.tasks).forEach(b => { bStart = bStart == null ? b.start : Math.min(bStart, b.start); bFinish = bFinish == null ? b.finish : Math.max(bFinish, b.finish); });
  if (bl) s.rows.forEach(r => { if (r.parent === -1 && r.baseline) { bWork += r.baseline.work; bCost += r.baseline.cost; } });
  const aStart = s.rows.reduce<number | null>((a, r) => (r.actualStart != null ? (a == null ? r.actualStart : Math.min(a, r.actualStart)) : a), null);
  const ctx = { p, s, outlineNumber: false };
  const d = (m: number) => formatDuration({ minutes: m, unit: p.settings.durationUnit, elapsed: false, estimated: false }, p.settings);
  const w = (m: number) => formatDuration({ minutes: m, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings);
  return (
    <Modal title={'Plan summary for ‘' + p.name + '’'} noOk cancelLabel="Close" wide>
      <table className="mini stats"><thead><tr><th /><th>Start</th><th>Finish</th></tr></thead><tbody>
        <tr><th>Current</th><td>{fmtD(p, s.start)}</td><td>{fmtD(p, s.finish)}</td></tr>
        <tr><th>Baseline</th><td>{fmtD(p, bStart)}</td><td>{fmtD(p, bFinish)}</td></tr>
        <tr><th>Actual</th><td>{fmtD(p, aStart)}</td><td>{s.percent >= 100 ? fmtD(p, s.finish) : '—'}</td></tr>
        <tr><th>Variance</th><td>{bStart != null ? d(s.calendar.workBetween(bStart, s.start)) : '0 days'}</td><td>{bFinish != null ? d(s.calendar.workBetween(bFinish, s.finish)) : '0 days'}</td></tr>
      </tbody></table>
      <table className="mini stats"><thead><tr><th /><th>Duration</th><th>Work</th><th>Cost</th></tr></thead><tbody>
        <tr><th>Current</th><td>{d(s.duration)}</td><td>{w(s.work)}</td><td>{money(ctx, s.cost)}</td></tr>
        <tr><th>Baseline</th><td>{bStart != null && bFinish != null ? d(s.calendar.workBetween(bStart, bFinish)) : '0 days'}</td><td>{w(bWork)}</td><td>{money(ctx, bCost)}</td></tr>
        <tr><th>Actual</th><td>{d(s.duration * s.percent / 100)}</td><td>{w(s.rows.reduce((a, r) => a + (r.parent === -1 ? r.actualWork : 0), 0))}</td><td>{money(ctx, s.actualCost)}</td></tr>
        <tr><th>Remaining</th><td>{d(s.duration * (1 - s.percent / 100))}</td><td>{w(s.work - s.rows.reduce((a, r) => a + (r.parent === -1 ? r.actualWork : 0), 0))}</td><td>{money(ctx, s.cost - s.actualCost)}</td></tr>
      </tbody></table>
      <p>Percent complete: <b>{s.percent}%</b> · Tasks: {s.rows.filter(r => !r.summary).length} · Resources: {p.resources.length}</p>
    </Modal>
  );
}

/* ---------- Working days and holidays ---------- */

const timesText = (t: WorkingTime[]) => (t.length ? t.map(x => clock(x.from) + '-' + clock(x.to % 1440 === 0 && x.to ? 1440 : x.to).replace('24:00', '24:00')).join(', ') : 'Nonworking');
function parseTimes(text: string): WorkingTime[] | null {
  if (/^\s*(non|off|none|-)/i.test(text) || !text.trim()) return [];
  const out: WorkingTime[] = [];
  for (const part of text.split(/[,;]/)) {
    const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(part);
    if (!m) return null;
    const a = +m[1] * 60 + (+m[2] || 0), b = +m[3] * 60 + (+m[4] || 0);
    if (a >= (b || 1440) || b > 1440) return null;
    out.push({ from: a, to: b || 1440 });
  }
  return cleanTimes(out);
}

function MonthView({ cal, month, setMonth, onPick, picked }: { cal: ReturnType<CalendarSet['get']>; month: number; setMonth: (m: number) => void; onPick: (day: number) => void; picked: number | null }) {
  const [y, m] = ymd(month);
  const first = month;
  const days: (number | null)[] = Array(weekday(first)).fill(null);
  for (let d = first; ymd(d)[1] === m; d++) days.push(d);
  return (
    <div className="cal-month">
      <div className="cal-nav"><button type="button" className="icon-btn" onClick={() => setMonth(Math.round(Date.UTC(y, m - 2, 1) / 864e5))}>‹</button><b>{MONTHS_LONG[m - 1]} {y}</b><button type="button" className="icon-btn" onClick={() => setMonth(Math.round(Date.UTC(y, m, 1) / 864e5))}>›</button></div>
      <div className="cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="cal-h">{d}</span>)}
        {days.map((d, i) => d == null ? <span key={i} /> : (
          <button type="button" key={i} className={'cal-d' + (cal.isWorkingDay(d) ? '' : ' off') + (picked === d ? ' pick' : '')} onClick={() => onPick(d)} title={cal.isWorkingDay(d) ? timesText(cal.times(d)) : 'Nonworking'}>{ymd(d)[2]}</button>
        ))}
      </div>
      <div className="cal-legend"><span className="cal-d sw" />Working <span className="cal-d off sw" />Nonworking</div>
    </div>
  );
}

function WorkingTime({ calId }: { calId?: string }) {
  const st = useStore();
  const [cals, setCals] = useState<CalendarDef[]>(() => st.p.calendars.map(c => JSON.parse(JSON.stringify(c))));
  const [id, setId] = useState(calId || st.p.calendar);
  const [month, setMonth] = useState(() => { const [y, m] = ymd(dayOf(st.s.start)); return Math.round(Date.UTC(y, m - 1, 1) / 864e5); });
  const [picked, setPicked] = useState<number | null>(null);
  const [tab, setTab] = useState<'ex' | 'week'>('ex');
  const cal = cals.find(c => c.id === id) || cals[0];
  const live = useMemo(() => new CalendarSet(cals).get(cal.id), [cals, cal.id]);
  // Working times a weekday gets from this calendar or the calendars it is based on.
  const effWeek = (d: number): WorkingTime[] => { for (let c: CalendarDef | undefined = cal, g = 0; c && g < 10; c = c.base ? cals.find(x => x.id === c!.base) : undefined, g++) { const w = c.week[d]; if (w) return w; } return d === 0 || d === 6 ? [] : STANDARD_TIMES; };
  const upd = (c: CalendarDef) => setCals(cals.map(x => (x.id === c.id ? c : x)));
  const newCal = () => {
    const name = prompt('Name of the new base calendar:', 'Calendar ' + (cals.length + 1));
    if (!name) return;
    const c: CalendarDef = { ...JSON.parse(JSON.stringify(cal)), id: 'cal-' + Date.now().toString(36), name, base: null };
    if (cal.base) { const base = cals.find(x => x.id === cal.base) || standardCalendar(); c.week = base.week.map((w, i) => cal.week[i] ?? w); }
    setCals(cals.concat(c)); setId(c.id);
  };
  const ok = () => {
    st.commit({ ...st.p, calendars: cals });
    S().notify('Working time updated');
  };
  const pickedEx = picked != null ? cal.exceptions.findIndex(e => { const a = parseIso(e.start), b = parseIso(e.finish || e.start); return a != null && b != null && picked >= dayOf(a) && picked <= dayOf(b); }) : -1;
  return (
    <Modal title="Working days and holidays" onOk={ok} wide extra={<button type="button" className="btn" onClick={newCal}>Create New Calendar…</button>}>
      <div className="grid2">
        <F label="For calendar"><select className="inp" value={id} onChange={e => setId(e.target.value)}>{cals.map(c => <option key={c.id} value={c.id}>{c.name}{c.id === st.p.calendar ? ' (Project Calendar)' : c.base ? ' (resource or derived)' : ''}</option>)}</select></F>
        <F label="Based on"><input className="inp" disabled value={cal.base ? cals.find(c => c.id === cal.base)?.name || cal.base : 'Base calendar'} /></F>
      </div>
      <div className="wt">
        <MonthView cal={live} month={month} setMonth={setMonth} onPick={setPicked} picked={picked} />
        <div className="wt-side">
          {picked != null ? <>
            <p><b>{DAYS_LONG[weekday(picked)]} {fmtDate(atDay(picked), { weekday: false })}</b></p>
            <p>{live.isWorkingDay(picked) ? 'Working times: ' + timesText(live.times(picked)) : 'Nonworking day'}</p>
            <p className="hint">Based on: {pickedEx >= 0 ? 'exception “' + cal.exceptions[pickedEx].name + '”' : 'default work week on calendar “' + cal.name + '”'}</p>
            <div className="row-btns">
              {pickedEx < 0 && <button type="button" className="btn" onClick={() => upd({ ...cal, exceptions: cal.exceptions.concat({ name: live.isWorkingDay(picked) ? 'Nonworking day' : 'Working day', start: isoDate(atDay(picked)), finish: isoDate(atDay(picked)), times: live.isWorkingDay(picked) ? [] : standardCalendar().week[1]! }) })}>{live.isWorkingDay(picked) ? 'Make nonworking' : 'Make working'}</button>}
              {pickedEx >= 0 && <button type="button" className="btn" onClick={() => upd({ ...cal, exceptions: cal.exceptions.filter((_, i) => i !== pickedEx) })}>Remove exception</button>}
            </div>
          </> : <p className="hint">Click a date to see its working times or to make it a working or nonworking day.</p>}
        </div>
      </div>
      <div className="tabs">{([['ex', 'Exceptions'], ['week', 'Work Weeks']] as const).map(([k, l]) => <button type="button" key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'ex' && <>
        <table className="mini"><thead><tr><th>Name</th><th>Start</th><th>Finish</th><th>Working times (blank = nonworking)</th><th /></tr></thead><tbody>
          {cal.exceptions.map((ex, k) => (
            <tr key={k}>
              <td><input className="inp" value={ex.name} onChange={e => upd({ ...cal, exceptions: cal.exceptions.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></td>
              <td><input className="inp sm" type="date" value={ex.start} onChange={e => upd({ ...cal, exceptions: cal.exceptions.map((x, j) => (j === k ? { ...x, start: e.target.value, finish: x.finish < e.target.value ? e.target.value : x.finish } : x)) })} /></td>
              <td><input className="inp sm" type="date" value={ex.finish} onChange={e => upd({ ...cal, exceptions: cal.exceptions.map((x, j) => (j === k ? { ...x, finish: e.target.value } : x)) })} /></td>
              <td><input className="inp" defaultValue={ex.times.length ? timesText(ex.times) : ''} placeholder="Nonworking" onBlur={e => { const t = parseTimes(e.target.value); if (t == null) S().notify('Write working times like 08:00-12:00, 13:00-17:00.', true); else upd({ ...cal, exceptions: cal.exceptions.map((x, j) => (j === k ? { ...x, times: t } : x)) }); }} /></td>
              <td><button type="button" className="icon-btn" aria-label="Remove" onClick={() => upd({ ...cal, exceptions: cal.exceptions.filter((_, j) => j !== k) })}><Icon name="x" /></button></td>
            </tr>
          ))}
        </tbody></table>
        <button type="button" className="btn" onClick={() => { const d = isoDate(atDay(picked ?? dayOf(st.s.start))); upd({ ...cal, exceptions: cal.exceptions.concat({ name: 'Holiday', start: d, finish: d, times: [] }) }); }}><Icon name="plus" />Add exception</button>
      </>}
      {tab === 'week' && <>
        <table className="mini"><thead><tr><th>Day</th><th>Working times</th><th>Hours</th></tr></thead><tbody>
          {[1, 2, 3, 4, 5, 6, 0].map(d => {
            const w = cal.week[d];
            const eff = effWeek(d);
            return (
              <tr key={d}>
                <td>{DAYS_LONG[d]}</td>
                <td><input className="inp" key={id + d + JSON.stringify(w)} defaultValue={w ? timesText(w) : ''} placeholder={cal.base ? 'Use base calendar (' + timesText(eff) + ')' : 'Nonworking'}
                  onBlur={e => { const v = e.target.value.trim(); if (!v && cal.base) { upd({ ...cal, week: cal.week.map((x, i) => (i === d ? null : x)) }); return; } const t = parseTimes(v); if (t == null) S().notify('Write working times like 08:00-12:00, 13:00-17:00, or “Nonworking”.', true); else upd({ ...cal, week: cal.week.map((x, i) => (i === d ? t : x)) }); }} /></td>
                <td>{(minutesIn(w ?? eff) / 60).toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody></table>
        <p className="hint">Hours per day for durations is set in Plan settings (currently {st.p.settings.minutesPerDay / 60} h). Keep it equal to a normal working day.</p>
      </>}
    </Modal>
  );
}

/* ---------- Person details ---------- */

function ResourceInfo({ uid, create, tab: tab0 }: { uid?: number; create?: ResourceType; tab?: string }) {
  const st = useStore();
  const r = uid != null ? st.p.resources.find(x => x.uid === uid) : undefined;
  const [tab, setTab] = useState(tab0 || 'general');
  const blankTable = (): RateRow => ({ std: '0', ovt: '0', perUse: '0', changes: [] });
  type RateRow = { std: string; ovt: string; perUse: string; changes: { from: string; rate: string; ovt: string; perUse: string }[] };
  const [f, setF] = useState(() => ({
    name: r?.name || '', initials: r?.initials || '', group: r?.group || '', type: (r?.type || create || 'Work') as ResourceType, materialLabel: r?.materialLabel || '',
    maxUnits: String(Math.round((r?.maxUnits ?? 1) * 100)), calendar: r?.calendar || st.p.calendar, notes: r?.notes || '', email: r?.email || '', code: r?.code || '',
    accrue: r?.accrue || 'prorated', budget: !!r?.budget, generic: !!r?.generic, booking: r?.booking || 'committed',
    tables: [
      { std: String(r?.stdRate ?? 0), ovt: String(r?.ovtRate ?? 0), perUse: String(r?.costPerUse ?? 0), changes: (r?.rates || []).map(x => ({ from: isoDate(x.from), rate: String(x.rate), ovt: x.ovt != null ? String(x.ovt) : '', perUse: x.perUse != null ? String(x.perUse) : '' })) },
      ...[0, 1, 2, 3].map(i => { const t = r?.tables?.[i]; return t ? { std: String(t.std), ovt: String(t.ovt), perUse: String(t.perUse), changes: t.changes.map(x => ({ from: isoDate(x.from), rate: String(x.rate), ovt: x.ovt != null ? String(x.ovt) : '', perUse: x.perUse != null ? String(x.perUse) : '' })) } : blankTable(); })
    ] as RateRow[],
    avail: (r?.availability || []).map(x => ({ from: x.from != null ? isoDate(x.from) : '', to: x.to != null ? isoDate(x.to) : '', units: String(Math.round(x.units * 100)) }))
  }));
  const [rt, setRt] = useState(0);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const setTable = (k: number, patch: Partial<RateRow>) => set({ tables: f.tables.map((t, i) => (i === k ? { ...t, ...patch } : t)) });
  const num = (v: string) => Math.max(0, +v.replace(/[^\d.]/g, '') || 0);
  const ok = () => {
    if (!f.name.trim()) { S().notify('Enter a resource name.', true); return false; }
    const conv = (t: RateRow) => t.changes.filter(x => parseIso(x.from) != null).map(x => ({ from: parseIso(x.from)!, rate: num(x.rate), ...(x.ovt !== '' ? { ovt: num(x.ovt) } : {}), ...(x.perUse !== '' ? { perUse: num(x.perUse) } : {}) })).sort((a, b) => a.from - b.from);
    const A = f.tables[0];
    const extra = f.tables.slice(1).map(t => ({ std: num(t.std), ovt: num(t.ovt), perUse: num(t.perUse), changes: conv(t) }));
    const patch = {
      name: f.name.trim(), initials: f.initials, group: f.group, type: f.type, materialLabel: f.materialLabel, maxUnits: Math.max(0, +f.maxUnits / 100 || 0),
      stdRate: num(A.std), ovtRate: num(A.ovt), costPerUse: num(A.perUse), calendar: f.calendar, notes: f.notes, rates: conv(A),
      tables: extra.some(t => t.std || t.ovt || t.perUse || t.changes.length) ? extra : undefined,
      availability: f.avail.length ? f.avail.map(x => ({ from: parseIso(x.from), to: parseIso(x.to), units: Math.max(0, +x.units / 100 || 0) })) : undefined,
      accrue: f.accrue === 'prorated' ? undefined : f.accrue as 'start' | 'end', budget: f.budget || undefined, generic: f.generic || undefined, booking: f.booking === 'proposed' ? 'proposed' as const : undefined,
      email: f.email || undefined, code: f.code || undefined
    };
    if (r) st.commit(updateResource(st.p, r.uid, patch));
    else { const out = addResources(st.p, 1, patch); st.commit(out.p); st.set({ resSel: out.uids }); }
  };
  const ownCal = () => {
    let p = st.p, id = f.calendar;
    if (!p.calendars.find(c => c.id === id)?.base && r) {
      const c = derivedCalendar('res-' + r.uid + '-' + Date.now().toString(36), f.name || 'Resource', id);
      p = { ...p, calendars: p.calendars.concat(c) };
      p = updateResource(p, r.uid, { calendar: c.id });
      st.commit(p);
      id = c.id;
    }
    S().open('workingTime', { calId: id });
  };
  const T = f.tables[rt];
  const tabs: [string, string][] = [['general', 'General'], ['costs', 'Costs'], ['notes', 'Notes']];
  return (
    <Modal title="Person details" wide onOk={ok}>
      <div className="tabs">{tabs.map(([k, l]) => <button type="button" key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'general' && <>
        <div className="grid2">
          <F label="Resource name"><input className="inp" value={f.name} autoFocus onChange={e => set({ name: e.target.value })} /></F>
          <F label="Initials"><input className="inp" value={f.initials} onChange={e => set({ initials: e.target.value })} /></F>
          <F label="Type"><select className="inp" value={f.type} onChange={e => set({ type: e.target.value as ResourceType })}><option>Work</option><option>Material</option><option>Cost</option></select></F>
          <F label="Group"><input className="inp" value={f.group} onChange={e => set({ group: e.target.value })} /></F>
          {f.type === 'Material' && <F label="Material label"><input className="inp" value={f.materialLabel} onChange={e => set({ materialLabel: e.target.value })} /></F>}
          <F label="Email"><input className="inp" value={f.email} onChange={e => set({ email: e.target.value })} /></F>
          <F label="Code"><input className="inp" value={f.code} onChange={e => set({ code: e.target.value })} /></F>
          {f.type === 'Work' && <F label="Base calendar"><select className="inp" value={f.calendar} onChange={e => set({ calendar: e.target.value })}>{st.p.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>}
          {f.type === 'Work' && <F label="Booking type"><select className="inp" value={f.booking} onChange={e => set({ booking: e.target.value as 'committed' | 'proposed' })}><option value="committed">Committed</option><option value="proposed">Proposed</option></select></F>}
          <span className="row-btns"><label className="chk"><input type="checkbox" checked={f.generic} onChange={e => set({ generic: e.target.checked })} />Generic</label><label className="chk"><input type="checkbox" checked={f.budget} onChange={e => set({ budget: e.target.checked })} />Budget</label></span>
        </div>
        {f.type === 'Work' && r && <button type="button" className="btn" onClick={ownCal}><Icon name="calendar" />Working days and holidays…</button>}
        {f.type === 'Work' && <>
          <h3>Resource availability</h3>
          <table className="mini"><thead><tr><th>Available from</th><th>Available to</th><th>Units (%)</th><th /></tr></thead><tbody>
            <tr className="muted"><td colSpan={2}>Default (when no row below applies)</td><td><input className="inp sm" value={f.maxUnits} onChange={e => set({ maxUnits: e.target.value })} /></td><td /></tr>
            {f.avail.map((x, k) => <tr key={k}>
              <td><input className="inp sm" type="date" value={x.from} onChange={e => set({ avail: f.avail.map((y, j) => (j === k ? { ...y, from: e.target.value } : y)) })} /></td>
              <td><input className="inp sm" type="date" value={x.to} onChange={e => set({ avail: f.avail.map((y, j) => (j === k ? { ...y, to: e.target.value } : y)) })} /></td>
              <td><input className="inp sm" value={x.units} onChange={e => set({ avail: f.avail.map((y, j) => (j === k ? { ...y, units: e.target.value } : y)) })} /></td>
              <td><button type="button" className="icon-btn" onClick={() => set({ avail: f.avail.filter((_, j) => j !== k) })}><Icon name="x" /></button></td>
            </tr>)}
          </tbody></table>
          <button type="button" className="btn" onClick={() => set({ avail: f.avail.concat({ from: isoDate(st.s.start), to: '', units: '100' }) })}><Icon name="plus" />Add availability period</button>
          <p className="hint">Leave a date empty for "NA" (no limit). Overallocation and balancing use the units in effect at each time.</p>
        </>}
      </>}
      {tab === 'costs' && <>
        {f.type === 'Cost' ? <p className="hint">Cost resources take their amount on each assignment (in the Resource Names cell, Assign people or Assignment Information).</p> : <>
          <div className="tabs small">{['A (Default)', 'B', 'C', 'D', 'E'].map((l, i) => <button type="button" key={l} className={'tab' + (rt === i ? ' on' : '')} onClick={() => setRt(i)}>{l}</button>)}</div>
          <div className="grid3">
            <F label={f.type === 'Work' ? 'Standard rate (per hour)' : 'Standard rate (per ' + (f.materialLabel || 'unit') + ')'}><input className="inp" value={T.std} onChange={e => setTable(rt, { std: e.target.value })} /></F>
            {f.type === 'Work' && <F label="Overtime rate (per hour)"><input className="inp" value={T.ovt} onChange={e => setTable(rt, { ovt: e.target.value })} /></F>}
            <F label="Per use cost"><input className="inp" value={T.perUse} onChange={e => setTable(rt, { perUse: e.target.value })} /></F>
          </div>
          <h3>Rate changes in table {'ABCDE'[rt]}</h3>
          <table className="mini"><thead><tr><th>Effective date</th><th>Standard rate</th>{f.type === 'Work' && <th>Overtime rate</th>}<th>Per use cost</th><th /></tr></thead><tbody>
            {T.changes.map((x, k) => <tr key={k}>
              <td><input className="inp sm" type="date" value={x.from} onChange={e => setTable(rt, { changes: T.changes.map((y, j) => (j === k ? { ...y, from: e.target.value } : y)) })} /></td>
              <td><input className="inp sm" value={x.rate} onChange={e => setTable(rt, { changes: T.changes.map((y, j) => (j === k ? { ...y, rate: e.target.value } : y)) })} /></td>
              {f.type === 'Work' && <td><input className="inp sm" value={x.ovt} placeholder="(same)" onChange={e => setTable(rt, { changes: T.changes.map((y, j) => (j === k ? { ...y, ovt: e.target.value } : y)) })} /></td>}
              <td><input className="inp sm" value={x.perUse} placeholder="(same)" onChange={e => setTable(rt, { changes: T.changes.map((y, j) => (j === k ? { ...y, perUse: e.target.value } : y)) })} /></td>
              <td><button type="button" className="icon-btn" onClick={() => setTable(rt, { changes: T.changes.filter((_, j) => j !== k) })}><Icon name="x" /></button></td>
            </tr>)}
          </tbody></table>
          <button type="button" className="btn" onClick={() => setTable(rt, { changes: T.changes.concat({ from: isoDate(st.s.start), rate: T.std, ovt: '', perUse: '' }) })}><Icon name="plus" />Add rate change</button>
          <p className="hint">Assignments use table A unless another table is chosen in Assignment Information.</p>
        </>}
        <F label="Cost accrual"><select className="inp sm" value={f.accrue} onChange={e => set({ accrue: e.target.value as 'start' | 'prorated' | 'end' })}><option value="start">Start</option><option value="prorated">Prorated</option><option value="end">End</option></select></F>
      </>}
      {tab === 'notes' && <textarea className="inp notes" rows={10} value={f.notes} onChange={e => set({ notes: e.target.value })} />}
    </Modal>
  );
}

/* ---------- Assign people ---------- */

function AssignResources() {
  const st = useStore();
  const uid = st.sel[0];
  const t = st.p.tasks.find(x => x.uid === uid);
  const [units, setUnits] = useState<Record<number, string>>(() => Object.fromEntries((t?.assignments || []).map(a => { const r = st.p.resources.find(x => x.uid === a.res)!; return [a.res, r.type === 'Work' ? Math.round(a.units * 100) + '%' : r.type === 'Cost' ? String(a.cost) : String(a.units)]; })));
  if (!t) return <Modal title="Assign people" noOk cancelLabel="Close"><p>Select a task first.</p></Modal>;
  const ok = () => {
    let p = st.p;
    const text = st.p.resources.filter(r => units[r.uid] != null).map(r => r.name + (units[r.uid] ? '[' + units[r.uid] + ']' : '')).join(',');
    for (const u of st.sel) {
      const out = editCell(p, schedule(p), u, 'resources', text);
      if (out.error) { S().notify(out.error, true); return false; }
      p = out.p;
    }
    st.commit(p);
  };
  return (
    <Modal title={'Assign people: ' + (st.sel.length > 1 ? st.sel.length + ' tasks' : t.name)} onOk={ok} okLabel="Assign">
      <table className="mini"><thead><tr><th /><th>Resource Name</th><th>Type</th><th>Units / Qty / Cost</th></tr></thead><tbody>
        {st.p.resources.map(r => (
          <tr key={r.uid}>
            <td><input type="checkbox" checked={units[r.uid] != null} onChange={e => { const u = { ...units }; if (e.target.checked) u[r.uid] = r.type === 'Work' ? '100%' : r.type === 'Cost' ? '0' : '1'; else delete u[r.uid]; setUnits(u); }} /></td>
            <td>{r.name}</td><td>{r.type}</td>
            <td><input className="inp sm" disabled={units[r.uid] == null} value={units[r.uid] ?? ''} onChange={e => setUnits({ ...units, [r.uid]: e.target.value })} /></td>
          </tr>
        ))}
      </tbody></table>
      {!st.p.resources.length && <p>No resources yet. Add them in the People view, or type names in the Resource Names column.</p>}
    </Modal>
  );
}

/* ---------- baselines, status, update and move ---------- */

function BaselineDlg({ interim: i0, clear: c0 }: { interim?: boolean; clear?: boolean }) {
  const st = useStore();
  const [mode, setMode] = useState<'baseline' | 'interim'>(i0 ? 'interim' : 'baseline');
  const [k, setK] = useState(0), [scope, setScope] = useState<'all' | 'sel'>('all');
  const [from, setFrom] = useState<'current' | number>('current'), [to, setTo] = useState(1);
  const label = (i: number) => (i === 0 ? 'Baseline' : 'Baseline ' + i) + (st.p.baselines[i] ? ' (last saved on ' + new Date(st.p.baselines[i]!.savedAt).toLocaleDateString() + ')' : '');
  const uids = scope === 'sel' ? st.sel : undefined;
  if (c0) return (
    <Modal title="Clear baseline" okLabel="Clear" onOk={() => { if (!st.p.baselines[k]) return false; st.commit(clearBaseline(st.p, k)); S().notify(label(k).replace(/ \(.*/, '') + ' cleared'); }}>
      <F label="Clear"><select className="inp" value={k} onChange={e => setK(+e.target.value)}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i} disabled={!st.p.baselines[i]}>{label(i)}</option>)}</select></F>
      <p className="hint">Clearing a baseline removes the saved dates, work and cost. Interim plans are cleared by emptying their Start/Finish fields.</p>
    </Modal>
  );
  return (
    <Modal title="Save baseline" okLabel={mode === 'baseline' ? 'Save baseline' : 'Copy'} onOk={() => {
      if (mode === 'baseline') { st.commit(setBaseline(st.p, st.s, k, uids)); S().notify(label(k).replace(/ \(.*/, '') + ' saved'); }
      else { st.commit(copyInterim(st.p, st.s, from, to, uids)); S().notify('Copied ' + (from === 'current' ? 'Start/Finish' : 'Baseline' + (from ? ' ' + from : '') + ' dates') + ' into Start' + to + '/Finish' + to + '.'); }
    }} extra={mode === 'baseline' ? <button type="button" className="btn" disabled={!st.p.baselines[k]} onClick={() => { st.commit(clearBaseline(st.p, k)); S().close(); S().notify('Baseline cleared'); }}>Clear Baseline</button> : undefined}>
      <label className="chk"><input type="radio" checked={mode === 'baseline'} onChange={() => setMode('baseline')} />Set baseline</label>
      {mode === 'baseline' && <F label="Baseline"><select className="inp" value={k} onChange={e => setK(+e.target.value)}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{label(i)}</option>)}</select></F>}
      <label className="chk"><input type="radio" checked={mode === 'interim'} onChange={() => setMode('interim')} />Set interim plan</label>
      {mode === 'interim' && <div className="grid2">
        <F label="Copy"><select className="inp" value={String(from)} onChange={e => setFrom(e.target.value === 'current' ? 'current' : +e.target.value)}><option value="current">Start/Finish</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i} disabled={!st.p.baselines[i]}>{i ? 'Baseline' + i : 'Baseline'} Start/Finish</option>)}</select></F>
        <F label="Into"><select className="inp" value={to} onChange={e => setTo(+e.target.value)}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>Start{i + 1}/Finish{i + 1}</option>)}</select></F>
      </div>}
      <h3>For</h3>
      <label className="chk"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />Entire project</label>
      <label className="chk"><input type="radio" checked={scope === 'sel'} disabled={!st.sel.length} onChange={() => setScope('sel')} />Selected tasks</label>
      <p className="hint">The Progress view and Format › Baseline show a baseline under each bar; variance columns compare against Baseline. Interim plans keep dates in Start1–10 / Finish1–10, which you can add as columns or show with Bar Styles.</p>
    </Modal>
  );
}

function DateDlg({ kind, reschedule }: { kind: 'statusDate' | 'updateProject' | 'moveProject'; reschedule?: boolean }) {
  const st = useStore();
  const p = st.p;
  const init = kind === 'moveProject' ? fmtD(p, p.start) : fmtD(p, p.statusDate, false) === '' ? fmtDate(atDay(dayOf(Date.now() / 60000)), { weekday: false, format: p.settings.dateFormat }) : fmtD(p, p.statusDate, false);
  const [v, setV] = useState(init);
  const [scope, setScope] = useState<'all' | 'sel'>('all');
  const [how, setHow] = useState<'complete' | 'reschedule'>(reschedule ? 'reschedule' : 'complete');
  const ok = () => {
    const t = parseD(p, v, kind === 'moveProject' ? p.settings.defaultStart : p.settings.defaultFinish);
    if (kind === 'statusDate') { if (t === 'bad') { S().notify('Enter a date, or NA.', true); return false; } st.commit({ ...p, statusDate: t }); return; }
    if (t === 'bad' || t == null) { S().notify('Enter a date.', true); return false; }
    if (kind === 'updateProject') {
      const uids = scope === 'sel' ? st.sel : st.s.rows.filter(r => !r.summary).map(r => r.task.uid);
      if (how === 'reschedule') {
        const out = rescheduleUncompleted({ ...p, statusDate: t }, st.s, t, scope === 'sel' ? st.sel : undefined);
        st.commit(out.p);
        if (out.message) S().notify(out.message);
        return;
      }
      st.commit(markOnTrack({ ...p, statusDate: t }, st.s, uids, t).p);
      S().notify('Progress updated as scheduled through ' + fmtD(p, t, false));
      return;
    }
    // Move Project: everything moves by the same number of days, keeping times of day.
    const delta = (dayOf(t) - dayOf(p.start)) * 1440;
    if (!delta) return;
    const mv = (x: Minutes | null) => (x == null ? null : x + delta);
    st.commit({
      ...p, start: p.start + delta, statusDate: mv(p.statusDate),
      tasks: p.tasks.map(x => ({ ...x, start: mv(x.start), constraintDate: mv(x.constraintDate), deadline: mv(x.deadline), actualStart: mv(x.actualStart), actualFinish: mv(x.actualFinish) }))
    });
    S().notify('Project moved by ' + delta / 1440 + ' days');
  };
  const title = kind === 'statusDate' ? 'Status date' : kind === 'updateProject' ? 'Update the plan to a date' : 'Move the whole plan';
  return (
    <Modal title={title} onOk={ok}>
      {kind === 'updateProject' && <>
        <label className="chk"><input type="radio" checked={how === 'complete'} onChange={() => setHow('complete')} />Update work as complete through:</label>
        <label className="chk"><input type="radio" checked={how === 'reschedule'} onChange={() => setHow('reschedule')} />Reschedule uncompleted work to start after:</label>
      </>}
      {kind === 'moveProject' && <p>New project start date. Constraint dates, deadlines and actual dates move by the same number of days.</p>}
      <F label={kind === 'statusDate' ? 'Status date (NA to clear)' : 'Date'}><DateInput value={v} autoFocus format={p.settings.dateFormat} defaultMinute={kind === 'moveProject' ? p.settings.defaultStart : p.settings.defaultFinish} onChange={setV} /></F>
      {kind === 'updateProject' && <>
        <label className="chk"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />Entire project</label>
        <label className="chk"><input type="radio" checked={scope === 'sel'} disabled={!st.sel.length} onChange={() => setScope('sel')} />Selected tasks</label>
        <p className="hint">{how === 'complete' ? 'Sets % complete so each task is done as scheduled up to this date.' : 'Tasks in progress are split so their remaining work starts after this date; tasks that should have started get a Start No Earlier Than constraint.'}</p>
      </>}
    </Modal>
  );
}

function MoveTasks() {
  const [n, setN] = useState('1'), [unit, setUnit] = useState('d'), [dir, setDir] = useState<1 | -1>(1);
  return (
    <Modal title="Shift dates" onOk={() => { const k = +n; if (!(k > 0)) return false; moveSelected(dir * k * (unit === 'w' ? 7 : 1)); }}>
      <div className="grid2">
        <F label="Direction"><select className="inp" value={dir} onChange={e => setDir(+e.target.value as 1 | -1)}><option value={1}>Forward (later)</option><option value={-1}>Back (earlier)</option></select></F>
        <F label="By"><span className="row-btns"><input className="inp sm" value={n} onChange={e => setN(e.target.value)} /><select className="inp sm" value={unit} onChange={e => setUnit(e.target.value)}><option value="d">days</option><option value="w">weeks</option></select></span></F>
      </div>
      <p className="hint">Auto-scheduled tasks get a Start No Earlier Than constraint.</p>
    </Modal>
  );
}

/* ---------- Task Inspector ---------- */

function Inspect({ uid }: { uid: number }) {
  const { p, s } = useStore();
  const r = s.byUid.get(uid);
  if (!r) return <Modal title="Why these dates" noOk cancelLabel="Close"><p>Select a task.</p></Modal>;
  const t = r.task, items: ReactNode[] = [];
  const cal = s.calendars.get(t.calendar, p.calendar);
  if (r.summary) items.push(<li key="s">Summary task: its dates come from its {r.children.length} subtasks.</li>);
  else if (t.actualStart != null) items.push(<li key="a">Actual start: {fmtD(p, t.actualStart)}. The task no longer moves with its predecessors.</li>);
  else if (t.mode === 'manual') items.push(<li key="m">Manually scheduled: the start date was set by hand.</li>);
  else {
    // Which predecessor (or constraint) sets the start?
    const cands: { label: string; at: Minutes }[] = [{ label: 'Project start', at: s.start }];
    t.preds.forEach(l => {
      const pr = s.byUid.get(l.pred);
      if (!pr) return;
      const base = l.type === 'FS' || l.type === 'FF' ? pr.finish : pr.start;
      const lag = l.lagPercent ? pr.duration * l.lag / 100 : l.lag;
      let at = l.lagElapsed ? base + lag : lag >= 0 ? cal.add(base, lag) : cal.sub(base, -lag);
      if (l.type === 'FF' || l.type === 'SF') at = r.duration > 0 ? cal.sub(cal.prevWorkEnd(at), r.duration) : at;
      cands.push({ label: 'Predecessor ' + pr.id + ' “' + pr.task.name + '” (' + l.type + (l.lag ? (l.lag > 0 ? '+' : '') + (l.lagPercent ? l.lag + '%' : formatShort(l.lag, l.lagUnit, l.lagElapsed, p.settings)) : '') + ')', at: r.duration > 0 ? cal.nextWorkStart(at) : at });
    });
    const best = cands.reduce((a, b) => (b.at > a.at ? b : a));
    items.push(<li key="d">Start driven by: <b>{best.label}</b>{best.label !== 'Project start' ? ', finishing or starting ' + fmtD(p, best.at) : ''}.</li>);
    if (t.constraint !== 'ASAP') items.push(<li key="c">Constraint: <b>{CONSTRAINT_NAMES[t.constraint]}</b>{t.constraintDate != null ? ' on ' + fmtD(p, t.constraintDate) : ''}.</li>);
  }
  if (t.levelDelay > 0) items.push(<li key="lv">Balancing delay: {formatDuration({ minutes: t.levelDelay, unit: p.settings.durationUnit, elapsed: false, estimated: false }, p.settings)} (Plan › Clear Balancing removes it).</li>);
  items.push(<li key="cal">Calendar: {p.calendars.find(c => c.id === (t.calendar || p.calendar))?.name}{t.calendar ? ' (task calendar)' : ' (project calendar)'}.</li>);
  if (r.conflict) items.push(<li key="w" className="warn">{r.conflict}</li>);
  if (r.indicators.includes('deadline')) items.push(<li key="dl" className="warn">Finishes after its deadline ({fmtD(p, t.deadline)}).</li>);
  if (r.indicators.includes('overallocated')) items.push(<li key="o" className="warn">A resource on this task is overallocated. Use Plan › Balance workload, move the task, or change units.</li>);
  items.push(<li key="sl">Total slack: {formatDuration({ minutes: r.totalSlack, unit: 'd', elapsed: false, estimated: false }, p.settings)}{r.critical ? ' (critical)' : ''}. Free slack: {formatDuration({ minutes: r.freeSlack, unit: 'd', elapsed: false, estimated: false }, p.settings)}.</li>);
  return <Modal title={'Why these dates: task ' + r.id + ' ' + t.name} noOk cancelLabel="Close"><ul className="inspect">{items}</ul></Modal>;
}

/* ---------- Find, columns, custom fields ---------- */

function ImportReportDlg({ report, fileName }: { report: ImportReport; fileName: string }) {
  return (
    <Modal title="Import report" noOk cancelLabel="Close">
      <p>Opened <b>{fileName}</b>: {report.tasks} tasks, {report.links} links, {report.resources} resources, {report.assignments} assignments and {report.calendars} calendars.</p>
      {report.notes.length ? <><p>These items were approximated or left out; check them before relying on the dates:</p><ul className="import-notes">{report.notes.map(n => <li key={n}>{n}</li>)}</ul></> : <p>Everything in the file was imported.</p>}
    </Modal>
  );
}

function Confirm({ title, message, okLabel, onOk }: { title: string; message: string; okLabel: string; onOk: () => void }) {
  return <Modal title={title} okLabel={okLabel} onOk={() => { S().close(); onOk(); return false; }}><p>{message}</p></Modal>;
}

export default function DialogHost() {
  const dialog = useStore(s => s.dialog);
  if (!dialog) return null;
  const pr = dialog.props || {};
  switch (dialog.type) {
    case 'taskInfo': return pr.uid === 0 ? <ProjectInfo /> : <TaskInfo key={pr.uid} uid={pr.uid} tab={pr.tab} />;
    case 'multiInfo': return <MultiInfoDialog />;
    case 'projectInfo': return <ProjectInfo />;
    case 'options': return <ProjectInfo options />;
    case 'stats': return <Stats />;
    case 'workingTime': return <WorkingTime calId={pr.calId} />;
    case 'resource': return <ResourceInfo uid={pr.uid} create={pr.create} tab={pr.tab} />;
    case 'assign': return <AssignResources />;
    case 'assignmentInfo': return <AssignmentInfoDialog uid={pr.uid} res={pr.res} />;
    case 'baseline': return <BaselineDlg interim={pr.interim} clear={pr.clear} />;
    case 'statusDate': case 'updateProject': case 'moveProject': return <DateDlg kind={dialog.type} reschedule={pr.reschedule} />;
    case 'move': return <MoveTasks />;
    case 'inspect': return <Inspect uid={pr.uid} />;
    case 'find': return <FindDialog replace={pr.replace} />;
    case 'goto': return <GoToDialog date={pr.date} />;
    case 'hyperlink': return <HyperlinkDialog uid={pr.uid} />;
    case 'notes': return <NotesDialog uid={pr.uid} />;
    case 'recurring': return <RecurringDialog uid={pr.uid} />;
    case 'updateTasks': return <UpdateTasksDialog />;
    case 'copyPicture': return <CopyPictureDialog />;
    case 'saveView': return <SaveViewDialog />;
    case 'insertColumn': case 'columns': return <TableColumns />;
    case 'customFields': return <CustomFields field={pr.field} />;
    case 'fieldSettings': return <FieldSettings field={pr.field} />;
    case 'textStyles': return <TextStyles />;
    case 'font': return <FontDialog />;
    case 'gridlines': return <GridlinesDialog />;
    case 'progressLines': return <ProgressLinesDialog />;
    case 'layout': return <LayoutDialog />;
    case 'timescale': return <TimescaleDialog />;
    case 'barStyles': return <BarStylesDialog />;
    case 'formatBar': return <FormatBarDialog uid={pr.uid} />;
    case 'sort': return <SortDialog />;
    case 'moreFilters': return <MoreFiltersDialog highlight={pr.highlight} />;
    case 'filterEditor': return <FilterEditor {...pr} />;
    case 'filterArgs': return <FilterArgsDialog id={pr.id} highlight={pr.highlight} />;
    case 'moreGroups': return <MoreGroupsDialog />;
    case 'groupEditor': return <GroupEditor {...pr} />;
    case 'levelingOptions': return <BalancingOptionsDialog />;
    case 'levelResource': return <LevelResourceDialog />;
    case 'wbsCode': return <WbsCodeDialog renumber={pr.renumber} />;
    case 'importReport': return <ImportReportDlg {...pr} />;
    case 'confirm': return <Confirm {...pr} />;
    case 'importTable': return <ImportTableDialog rows={pr.rows} fileName={pr.fileName} />;
    case 'exportFile': return <ExportDialog />;
    case 'importFile': setTimeout(() => { S().close(); openFile(); }, 0); return null;
    default: return null;
  }
}

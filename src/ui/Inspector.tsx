// The details panel on the right: everything about the selected task in one place, edited in place.
// Each field saves when you leave it or press Enter, through the same rules as typing in the table.
import { useEffect, useRef, useState } from 'react';
import { S, useStore } from './store';
import Icon from './Icon';
import { ctxOf, editTask, openHyperlink, percentSel } from './actions';
import { makeColumn } from './columns';
import { DateInput } from './DatePicker';
import { run } from './commands';
import type { Field } from '../engine/ops';
import type { Row } from '../engine/schedule';

const CONSTRAINTS: [string, string][] = [['ASAP', 'As soon as possible'], ['ALAP', 'As late as possible'], ['SNET', 'Start no earlier than'], ['SNLT', 'Start no later than'],
  ['FNET', 'Finish no earlier than'], ['FNLT', 'Finish no later than'], ['MSO', 'Must start on'], ['MFO', 'Must finish on']];

function useText(r: Row, field: string): string {
  const st = useStore();
  const col = makeColumn({ field }, st.p);
  return col ? col.text(r, ctxOf(st)) : '';
}

// A text field that keeps what you type until you leave it, then saves through the table's rules.
function Fld({ r, field, label, wide, multiline, placeholder, date }: { r: Row; field: Field; label: string; wide?: boolean; multiline?: boolean; placeholder?: string; date?: boolean }) {
  const text = useText(r, field);
  const fmt = useStore(s => s.p.settings.dateFormat);
  const [v, setV] = useState(text);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setV(text); }, [text, focus]);
  const save = (val = v) => { if (val !== text) editTask(r.task.uid, field, val); };
  const common = { className: 'inp', value: v, placeholder, onFocus: () => setFocus(true) };
  return (
    <label className={'in-f' + (wide ? ' wide' : '')} data-field={field}>
      <span>{label}</span>
      {date ? <DateInput value={v} format={fmt} defaultMinute={field === 'finish' || field === 'deadline' ? 1020 : 480} onChange={t => { setV(t); save(t); }} />
        : multiline ? <textarea {...common} rows={3} onChange={e => setV(e.target.value)} onBlur={() => { setFocus(false); save(); }} />
          : <input {...common} onChange={e => setV(e.target.value)} onBlur={() => { setFocus(false); save(); }} onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setV(text); (e.target as HTMLInputElement).blur(); } }} />}
    </label>
  );
}

function Explain({ r }: { r: Row }) {
  const st = useStore();
  const lines: { tone: 'ok' | 'warn' | 'info'; text: string }[] = [];
  const days = (m: number) => Math.round(m / Math.max(1, st.p.settings.minutesPerDay) * 10) / 10;
  if (!r.task.active) lines.push({ tone: 'info', text: 'Turned off: left out of dates and totals.' });
  if (r.task.mode === 'manual') lines.push({ tone: 'info', text: 'Pinned: its dates stay where you put them.' });
  else if (r.critical) lines.push({ tone: 'warn', text: 'On the critical path: any delay moves the plan finish.' });
  else if (!r.summary) lines.push({ tone: 'ok', text: 'Can slip ' + days(r.totalSlack) + ' working day' + (days(r.totalSlack) === 1 ? '' : 's') + ' without moving the plan finish.' });
  if (r.indicators.includes('deadline')) lines.push({ tone: 'warn', text: 'Finishes after its deadline.' });
  if (r.indicators.includes('overallocated')) lines.push({ tone: 'warn', text: 'Someone on this task is over capacity.' });
  if (r.indicators.includes('conflict')) lines.push({ tone: 'warn', text: 'A link or constraint cannot be met.' });
  const drv = r.task.preds.length ? 'Starts after task ' + r.task.preds.map(l => st.s.byUid.get(l.pred)?.id).filter(Boolean).join(', ') : r.task.constraint !== 'ASAP' ? 'Held by a date constraint.' : !r.summary && r.task.mode === 'auto' ? 'No predecessors: starts with the plan.' : '';
  if (drv) lines.push({ tone: 'info', text: drv });
  return (
    <div className="in-explain">
      {lines.map((l, i) => <p key={i} className={l.tone}><i />{l.text}</p>)}
      <button className="linkbtn" onClick={() => run('task.explain')}>Why these dates?</button>
    </div>
  );
}

export default function Inspector() {
  const sel = useStore(s => s.sel);
  const st = useStore();
  const w = st.ui.inspectorW;
  const r = sel.length ? st.s.byUid.get(sel[0]) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const focus = (e: Event) => { const f = (e as CustomEvent).detail; const el = ref.current?.querySelector<HTMLElement>(`[data-field="${f}"] input, [data-field="${f}"] textarea`) || ref.current?.querySelector<HTMLElement>('input'); el?.focus(); };
    window.addEventListener('cairn:inspector', focus);
    return () => window.removeEventListener('cairn:inspector', focus);
  }, []);
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => S().setUI({ inspectorW: Math.max(260, Math.min(560, window.innerWidth - e.clientX)) });
    const up = () => setDrag(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [drag]);
  const close = <button className="icon-btn" title="Hide the details panel" onClick={() => S().setUI({ inspector: false })}><Icon name="close" /></button>;
  if (!r || r.task.uid === 0) return (
    <aside className="inspector empty" style={{ width: w }} ref={ref}>
      <div className="in-head"><b>Details</b><span className="sp" />{close}</div>
      <div className="in-empty"><Icon name="info" size={28} /><p>Select a task to see and edit its dates, links, people and notes here.</p><p className="muted small">Tip: press Ctrl+J to add a task in one line.</p></div>
    </aside>
  );
  const t = r.task;
  const kind = r.summary ? 'Phase' : r.duration === 0 && !t.estimated ? 'Milestone' : 'Task';
  const succs = st.p.tasks.filter(x => x.preds.some(l => l.pred === t.uid));
  return (
    <aside className="inspector" style={{ width: w }} ref={ref} key={t.uid}>
      <div className="in-resize" onMouseDown={e => { e.preventDefault(); setDrag(true); }} />
      <div className="in-head">
        <span className={'in-kind ' + kind.toLowerCase()}>{kind} {r.id}</span>
        <span className="sp" />
        {sel.length > 1 && <span className="muted small">{sel.length} selected</span>}
        {close}
      </div>
      <div className="in-body">
        <Fld r={r} field="name" label="Name" wide />
        <div className="in-seg">
          <button className={t.mode === 'auto' ? 'on' : ''} onClick={() => editTask(t.uid, 'mode', 'Auto')} title="Dates follow links, constraints and calendars"><Icon name="auto" />Auto</button>
          <button className={t.mode === 'manual' ? 'on' : ''} onClick={() => editTask(t.uid, 'mode', 'Pinned')} title="Dates stay where you put them"><Icon name="pin" />Pinned</button>
        </div>
        <div className="in-grid">
          <Fld r={r} field="start" label="Start" date />
          <Fld r={r} field="finish" label="Finish" date />
          <Fld r={r} field="duration" label="Duration" placeholder="5d, 2w, 4h" />
          <Fld r={r} field="work" label="Work" placeholder="40h" />
        </div>
        <div className="in-f wide">
          <span>Progress <b>{r.percent}%</b></span>
          <div className="in-progress">
            <input type="range" min={0} max={100} step={5} value={r.percent} onChange={e => percentSel(+e.target.value)} aria-label="Progress" />
            {[0, 50, 100].map(v => <button key={v} className="chip" onClick={() => percentSel(v)}>{v === 100 ? 'Done' : v + '%'}</button>)}
          </div>
        </div>
        <Explain r={r} />
        <h4>Links</h4>
        <Fld r={r} field="preds" label="Depends on (row numbers, e.g. 3, 5SS+2d)" wide placeholder="None" />
        {succs.length > 0 && <p className="in-note">Followed by {succs.map(x => st.s.byUid.get(x.uid)?.id).filter(Boolean).join(', ')}</p>}
        <h4>People</h4>
        <Fld r={r} field="resources" label="Assigned to (e.g. Ana, Crew[200%])" wide placeholder="Nobody yet" />
        <button className="linkbtn" onClick={() => run('team.assign')}>Choose from the team…</button>
        <h4>Dates and limits</h4>
        <div className="in-grid">
          <Fld r={r} field="deadline" label="Deadline" date />
          <Fld r={r} field="priority" label="Priority (0–1000)" />
        </div>
        <label className="in-f wide"><span>Date constraint</span>
          <select className="inp" value={t.constraint} onChange={e => editTask(t.uid, 'constraint', e.target.value)}>{CONSTRAINTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        {t.constraint !== 'ASAP' && t.constraint !== 'ALAP' && <Fld r={r} field="constraintDate" label="Constraint date" date />}
        <h4>Notes and link</h4>
        <Fld r={r} field="notes" label="Notes" wide multiline placeholder="Add a note" />
        <div className="in-row">
          <button className="btn" onClick={() => run('insert.note')}><Icon name="note" />Formatted note</button>
          <button className="btn" onClick={() => run('insert.link')}><Icon name="hyperlink" />{t.hyperlink ? 'Edit link' : 'Add link'}</button>
          {t.hyperlink && <button className="btn" onClick={() => openHyperlink(t.uid)}><Icon name="goto" />Open</button>}
        </div>
        <div className="in-row foot">
          <button className="linkbtn" onClick={() => S().open('taskInfo', { uid: t.uid })}>All task settings…</button>
        </div>
      </div>
    </aside>
  );
}

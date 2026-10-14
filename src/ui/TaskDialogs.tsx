// Task dialogs: Hyperlink, Notes (formatted), Recurring Task, Go To, Find and Replace, Multiple Task details,
// Update Tasks, Copy Picture and Save View.
import { useEffect, useRef, useState } from 'react';
import { CONSTRAINT_NAMES, TASK_TYPE_NAMES, type ConstraintType, type Recurrence, type TaskType } from '../engine/model';
import { editCell, insertRecurring, recurrenceDates, updateTask, type Field } from '../engine/ops';
import { schedule } from '../engine/schedule';
import { describeRule, NTH } from '../engine/recur';
import { parseDuration, formatDuration } from '../engine/duration';
import { atDay, dayOf, DAYS, DAYS_LONG, fmtDate, MONTHS_LONG, parseDateText, todayMinutes, weekday, ymd } from '../engine/time';
import { FIELDS, fieldName } from '../engine/fields';
import { TEST_NAMES, testCriterion } from '../engine/filters';
import { F, Modal } from './Modal';
import { DateInput } from './DatePicker';
import { S, useStore, VIEW_LABELS, TABLES } from './store';
import { openHyperlink, scrollToTask, visibleRows } from './actions';
import { scrollToDate } from './Gantt';
import { copyPicture } from './print';
import Icon from './Icon';

/* ---------- Hyperlink ---------- */

export function HyperlinkDialog({ uid }: { uid: number }) {
  const st = useStore();
  const t = st.p.tasks.find(x => x.uid === uid);
  const [h, setH] = useState(() => ({ text: t?.hyperlink?.text || '', address: t?.hyperlink?.address || '', sub: t?.hyperlink?.sub || '' }));
  if (!t) return <Modal title="Web link" noOk cancelLabel="Close"><p>Select a task.</p></Modal>;
  const ok = () => {
    const a = h.address.trim();
    if (a && /^\s*javascript:/i.test(a)) { S().notify('That kind of link is not allowed.', true); return false; }
    st.commit(updateTask(st.p, uid, { hyperlink: a || h.sub.trim() ? { text: h.text.trim(), address: a, sub: h.sub.trim() } : undefined }));
  };
  return (
    <Modal title={t.hyperlink ? 'Web link' : 'Web link'} onOk={ok} extra={t.hyperlink ? <button type="button" className="btn" onClick={() => { st.commit(updateTask(st.p, uid, { hyperlink: undefined })); S().close(); }}>Remove Link</button> : undefined}>
      <F label="Text to display"><input className="inp" autoFocus value={h.text} placeholder={h.address || 'Link text'} onChange={e => setH({ ...h, text: e.target.value })} /></F>
      <F label="Address (web page, file or email)"><input className="inp" value={h.address} placeholder="https://… or name@example.com" onChange={e => setH({ ...h, address: e.target.value })} /></F>
      <F label="Place in this plan (task ID) or bookmark"><input className="inp sm" value={h.sub} onChange={e => setH({ ...h, sub: e.target.value })} /></F>
      <p className="hint">The link shows in the Indicators column; click it to open. Add the Hyperlink column to see and edit links in the table.</p>
      {t.hyperlink && <button type="button" className="linkbtn" onClick={() => openHyperlink(uid)}>Open the current link</button>}
    </Modal>
  );
}

/* ---------- Notes ---------- */

const plain = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; d.querySelectorAll('br').forEach(b => b.replaceWith('\n')); d.querySelectorAll('p,div,li').forEach(b => b.append('\n')); return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim(); };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Only harmless formatting survives in saved notes.
export function cleanHtml(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  const ok = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'SPAN', 'FONT', 'A', 'IMG', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);
  const walk = (el: Element) => {
    [...el.children].forEach(c => {
      if (!ok.has(c.tagName)) { c.replaceWith(...[...c.childNodes]); return; }
      [...c.attributes].forEach(a => {
        const n = a.name.toLowerCase();
        const keep = (c.tagName === 'A' && n === 'href' && /^(https?:|mailto:)/i.test(a.value)) || (c.tagName === 'IMG' && n === 'src' && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(a.value)) || (n === 'style' && !/url|expression|javascript/i.test(a.value)) || (c.tagName === 'FONT' && (n === 'color' || n === 'face' || n === 'size'));
        if (!keep) c.removeAttribute(a.name);
      });
      if (c.tagName === 'A') c.setAttribute('target', '_blank');
      walk(c);
    });
  };
  walk(d);
  return d.innerHTML;
}

export function NotesDialog({ uid }: { uid: number }) {
  const st = useStore();
  const t = st.p.tasks.find(x => x.uid === uid);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && t) { ref.current.innerHTML = t.notesHtml || esc(t.notes).replace(/\n/g, '<br>'); ref.current.focus(); } }, []);
  if (!t) return <Modal title="Notes" noOk cancelLabel="Close"><p>Select a task.</p></Modal>;
  const cmd = (c: string, v?: string) => { ref.current?.focus(); document.execCommand(c, false, v); };
  const ok = () => {
    const html = cleanHtml(ref.current?.innerHTML || '');
    const text = plain(html);
    const formatted = /<(b|strong|i|em|u|s|ul|ol|img|a|font|span|h\d)/i.test(html);
    st.commit(updateTask(st.p, uid, { notes: text, notesHtml: formatted ? html : undefined }));
  };
  const image = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { const f = input.files?.[0]; if (!f) return; if (f.size > 1.5e6) { S().notify('Choose an image under 1.5 MB.', true); return; } const r = new FileReader(); r.onload = () => cmd('insertImage', String(r.result)); r.readAsDataURL(f); };
    input.click();
  };
  return (
    <Modal title={'Notes: ' + t.name} wide onOk={ok}>
      <div className="rte-bar">
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('bold'); }} title="Bold"><Icon name="bold" /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('italic'); }} title="Italic"><Icon name="italic" /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('underline'); }} title="Underline"><Icon name="underline" /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('strikeThrough'); }} title="Strikethrough"><Icon name="strike" /></button>
        <span className="rte-sep" />
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('insertUnorderedList'); }} title="Bulleted list"><Icon name="menu" /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('insertOrderedList'); }} title="Numbered list"><Icon name="outline" /></button>
        <span className="rte-sep" />
        {['#c0392b', '#e67e22', '#27ae60', '#2c5ea8', '#7a4cc2', '#1f2937'].map(c => <button key={c} type="button" className="rte-color" style={{ background: c }} title="Text colour" onMouseDown={e => { e.preventDefault(); cmd('foreColor', c); }} />)}
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('hiliteColor', '#fff3a0'); }} title="Highlight"><Icon name="highlight" /></button>
        <span className="rte-sep" />
        <button type="button" onMouseDown={e => { e.preventDefault(); const u = prompt('Link address:', 'https://'); if (u && /^(https?:|mailto:)/i.test(u)) cmd('createLink', u); }} title="Insert link"><Icon name="hyperlink" /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); image(); }} title="Insert picture"><Icon name="image" /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); cmd('removeFormat'); }} title="Clear formatting"><Icon name="clear" /></button>
      </div>
      <div className="rte" ref={ref} contentEditable suppressContentEditableWarning spellCheck />
      <p className="hint">Notes show in the Indicators column and in the Notes field. Formatting, links and pictures are kept in the plan file; XML keeps the text.</p>
    </Modal>
  );
}

/* ---------- Recurring Task ---------- */

export function RecurringDialog({ uid }: { uid?: number }) {
  const st = useStore();
  const p = st.p;
  const existing = uid != null ? p.tasks.find(t => t.uid === uid && t.recurrence) : undefined;
  const r0 = existing?.recurrence;
  const start0 = r0?.from ?? atDay(dayOf(Math.max(st.s.start, todayMinutes())), p.settings.defaultStart);
  const [name, setName] = useState(existing?.name || 'Weekly meeting');
  const [dur, setDur] = useState(r0 ? formatDuration({ minutes: r0.duration, unit: r0.durUnit, elapsed: false, estimated: false }, p.settings) : '1h');
  const [rec, setRec] = useState<Recurrence>(() => r0 ? { ...r0 } : { pattern: 'weekly', every: 1, days: [weekday(dayOf(start0))], monthDay: ymd(dayOf(start0))[2], nth: 1, weekday: weekday(dayOf(start0)), month: ymd(dayOf(start0))[1], from: start0, until: null, count: 10, duration: 60, durUnit: 'h', workdaysOnly: true });
  const [fromText, setFromText] = useState(fmtDate(rec.from, { format: p.settings.dateFormat }));
  const [untilText, setUntilText] = useState(rec.until != null ? fmtDate(rec.until, { format: p.settings.dateFormat }) : fmtDate(rec.from + 90 * 1440, { format: p.settings.dateFormat }));
  const [endBy, setEndBy] = useState<'count' | 'date'>(rec.until != null ? 'date' : 'count');
  const [byDay, setByDay] = useState(rec.monthDay > 0);
  const set = (patch: Partial<Recurrence>) => setRec({ ...rec, ...patch });
  const build = (): Recurrence | string => {
    const d = parseDuration(dur, p.settings, 'h');
    if (!d) return 'Enter a duration such as 1h or 2d.';
    const f = parseDateText(fromText, p.settings.dateFormat);
    if (!f) return 'Enter a start date.';
    const u = parseDateText(untilText, p.settings.dateFormat);
    if (endBy === 'date' && !u) return 'Enter an end date.';
    return { ...rec, monthDay: byDay ? Math.max(1, rec.monthDay) : 0, from: atDay(f.day, p.settings.defaultStart), until: endBy === 'date' && u ? atDay(u.day, 1440 - 1) : null, duration: d.minutes, durUnit: d.unit };
  };
  const b = build();
  const preview = typeof b === 'string' ? [] : recurrenceDates(p, st.s, b);
  const ok = () => {
    if (typeof b === 'string') { S().notify(b, true); return false; }
    const at = existing ? -1 : st.sel.length ? st.p.tasks.findIndex(t => t.uid === st.sel[0]) : st.p.tasks.length;
    const out = insertRecurring(st.p, st.s, at < 0 ? st.p.tasks.length : at, name.trim() || 'Recurring task', b, existing?.uid);
    if ('error' in out) { S().notify(out.error, true); return false; }
    st.commit(out.p);
    st.set({ sel: [out.uid] });
    S().notify('Recurring task with ' + out.count + ' occurrences ' + (existing ? 'updated' : 'added') + '.');
  };
  return (
    <Modal title="Repeating task" wide onOk={ok}>
      <div className="ti-head"><F label="Task name"><input className="inp" autoFocus value={name} onChange={e => setName(e.target.value)} /></F><F label="Duration"><input className="inp" value={dur} onChange={e => setDur(e.target.value)} /></F></div>
      <div className="rec">
        <div className="rec-pat">{(['daily', 'weekly', 'monthly', 'yearly'] as const).map(k => <label key={k} className="chk"><input type="radio" checked={rec.pattern === k} onChange={() => set({ pattern: k })} />{k[0].toUpperCase() + k.slice(1)}</label>)}</div>
        <div className="rec-body">
          {rec.pattern === 'daily' && <div className="row-btns">Every <input className="inp xs" type="number" min={1} value={rec.every} onChange={e => set({ every: Math.max(1, +e.target.value || 1) })} /> day(s)</div>}
          {rec.pattern === 'weekly' && <>
            <div className="row-btns">Recur every <input className="inp xs" type="number" min={1} value={rec.every} onChange={e => set({ every: Math.max(1, +e.target.value || 1) })} /> week(s) on:</div>
            <div className="row-btns">{DAYS_LONG.map((d, i) => <label key={d} className="chk"><input type="checkbox" checked={rec.days.includes(i)} onChange={e => set({ days: e.target.checked ? rec.days.concat(i) : rec.days.filter(x => x !== i) })} />{d}</label>)}</div>
          </>}
          {(rec.pattern === 'monthly' || rec.pattern === 'yearly') && <>
            <div className="row-btns"><label className="chk"><input type="radio" checked={byDay} onChange={() => setByDay(true)} />Day</label><input className="inp xs" type="number" min={1} max={31} value={rec.monthDay || 1} onChange={e => set({ monthDay: Math.max(1, Math.min(31, +e.target.value || 1)) })} />
              {rec.pattern === 'yearly' ? <>of <select className="inp sm" value={rec.month} onChange={e => set({ month: +e.target.value })}>{MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></> : <>of every <input className="inp xs" type="number" min={1} value={rec.every} onChange={e => set({ every: Math.max(1, +e.target.value || 1) })} /> month(s)</>}</div>
            <div className="row-btns"><label className="chk"><input type="radio" checked={!byDay} onChange={() => setByDay(false)} />The</label>
              <select className="inp sm" value={rec.nth} onChange={e => set({ nth: +e.target.value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{NTH[n]}</option>)}</select>
              <select className="inp sm" value={rec.weekday} onChange={e => set({ weekday: +e.target.value })}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
              {rec.pattern === 'yearly' ? <>of <select className="inp sm" value={rec.month} onChange={e => set({ month: +e.target.value })}>{MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></> : null}</div>
          </>}
        </div>
      </div>
      <h3>Range of recurrence</h3>
      <div className="grid2">
        <F label="Start"><DateInput value={fromText} format={p.settings.dateFormat} defaultMinute={p.settings.defaultStart} onChange={setFromText} /></F>
        <div>
          <label className="chk"><input type="radio" checked={endBy === 'count'} onChange={() => setEndBy('count')} />End after <input className="inp xs" type="number" min={1} max={999} value={rec.count} onChange={e => set({ count: Math.max(1, Math.min(999, +e.target.value || 1)) })} /> occurrences</label>
          <label className="chk"><input type="radio" checked={endBy === 'date'} onChange={() => setEndBy('date')} />End by</label>
          {endBy === 'date' && <DateInput value={untilText} format={p.settings.dateFormat} defaultMinute={p.settings.defaultFinish} onChange={setUntilText} />}
        </div>
      </div>
      <label className="chk"><input type="checkbox" checked={rec.workdaysOnly} onChange={e => set({ workdaysOnly: e.target.checked })} />Move occurrences on non-working days to the next working day</label>
      <p className="hint">{typeof b === 'string' ? b : describeRule(b) + ': ' + preview.length + ' occurrence' + (preview.length === 1 ? '' : 's') + (preview.length ? ', first ' + fmtDate(preview[0], { format: p.settings.dateFormat }) + ', last ' + fmtDate(preview[preview.length - 1], { format: p.settings.dateFormat }) : '') + '.'}</p>
    </Modal>
  );
}

/* ---------- Go To ---------- */

export function GoToDialog({ date }: { date?: number }) {
  const st = useStore();
  const [id, setId] = useState('');
  const [d, setD] = useState(date != null ? fmtDate(atDay(date), { format: st.p.settings.dateFormat }) : '');
  const ok = () => {
    if (id.trim()) {
      const r = st.s.rows[+id - 1];
      if (!r) { S().notify('There is no task with ID ' + id + '.', true); return false; }
      if (st.ui.collapsed && Object.keys(st.ui.collapsed).length) S().setUI({ collapsed: {} });
      st.set({ sel: [r.task.uid] });
      setTimeout(scrollToTask, 0);
    }
    if (d.trim()) {
      const x = parseDateText(d, st.p.settings.dateFormat);
      if (!x) { S().notify('Enter a date.', true); return false; }
      if (st.ui.view === 'calendar') { const [yy, mm] = ymd(x.day); S().setUI({ calMonth: Math.round(Date.UTC(yy, mm - 1, 1) / 864e5) }); }
      else setTimeout(() => scrollToDate(atDay(x.day) - 1440), id.trim() ? 60 : 0);
    }
  };
  return (
    <Modal title="Go to" onOk={ok} okLabel="Go">
      <F label="ID"><input className="inp sm" autoFocus value={id} onChange={e => setId(e.target.value)} /></F>
      <F label="Date"><DateInput value={d} format={st.p.settings.dateFormat} defaultMinute={st.p.settings.defaultStart} onChange={setD} /></F>
      <p className="hint">Enter a task ID to select and show that task, a date to scroll the chart to it, or both.</p>
    </Modal>
  );
}

/* ---------- Find and Replace ---------- */

export function FindDialog({ replace: rep0 }: { replace?: boolean }) {
  const st = useStore();
  const [replace, setReplace] = useState(!!rep0);
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [field, setField] = useState('name');
  const [test, setTest] = useState<'contains' | 'eq' | 'notContains' | 'gt' | 'lt' | 'ge' | 'le' | 'ne' | 'exact'>('contains');
  const [matchCase, setMatchCase] = useState(false);
  const [up, setUp] = useState(false);
  const textField = field === 'name' || field === 'notes' || field === 'contact' || /^Text\d+$/.test(field);
  const hit = (row: ReturnType<typeof visibleRows>[number]) => {
    if (row.group || row.id <= 0) return false;
    if (textField && test === 'contains') {
      const f = FIELDS.find(x => x.key === field);
      const v = String(f?.get(row, { p: st.p, s: st.s }) ?? '');
      return matchCase ? v.includes(q) : v.toLowerCase().includes(q.toLowerCase());
    }
    return testCriterion(row, { p: st.p, s: st.s }, { join: 'and', field, test, value: q, value2: '' }, new Map());
  };
  const next = () => {
    const rows = visibleRows(st).filter(x => !x.group && x.id > 0);
    const curI = st.sel.length ? rows.findIndex(x => x.task.uid === st.sel[0]) : -1;
    const order = up ? [...rows.slice(0, Math.max(0, curI)).reverse(), ...rows.slice(curI + 1).reverse()] : [...rows.slice(curI + 1), ...rows.slice(0, Math.max(0, curI + 1))];
    const h = order.find(hit);
    if (!h) { S().notify('No task matches.'); return null; }
    st.set({ sel: [h.task.uid] });
    setTimeout(() => window.dispatchEvent(new CustomEvent('pc:scrollto', { detail: h.task.uid })), 0);
    return h;
  };
  const replaceIn = (uids: number[]) => {
    let p = st.p, n = 0;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
    uids.forEach(u => {
      const row = schedule(p).byUid.get(u);
      if (!row) return;
      const f = FIELDS.find(x => x.key === field)!;
      const v = String(f.get(row, { p, s: schedule(p) }) ?? '');
      if (!re.test(v)) return;
      re.lastIndex = 0;
      const out = editCell(p, schedule(p), u, (f.edit || field) as Field, v.replace(re, r));
      if (!out.error) { p = out.p; n++; }
    });
    if (n) st.commit(p);
    return n;
  };
  return (
    <Modal title={replace ? 'Replace' : 'Find'} okLabel="Find Next" onOk={() => { next(); return false; }} cancelLabel="Close"
      extra={replace ? <><button type="button" className="btn" disabled={!q} onClick={() => { const cur = st.sel[0]; const row = cur != null ? st.s.byUid.get(cur) : undefined; if (row && hit(row)) { replaceIn([cur]); } next(); }}>Replace</button>
        <button type="button" className="btn" disabled={!q} onClick={() => { const n = replaceIn(visibleRows(st).filter(x => !x.group && x.id > 0 && hit(x)).map(x => x.task.uid)); S().notify(n ? 'Replaced in ' + n + ' task(s).' : 'Nothing to replace.'); }}>Replace All</button></>
        : <button type="button" className="btn" onClick={() => setReplace(true)}>Replace…</button>}>
      <F label="Find what"><input className="inp" autoFocus value={q} onChange={e => setQ(e.target.value)} /></F>
      {replace && <F label="Replace with"><input className="inp" value={r} onChange={e => setR(e.target.value)} /></F>}
      <div className="grid2">
        <F label="Look in field"><select className="inp" value={field} onChange={e => setField(e.target.value)}>{FIELDS.filter(f => !f.hidden && (!replace || f.type === 'text' && f.edit)).map(f => <option key={f.key} value={f.key}>{fieldName(f.key, st.p, true)}</option>)}</select></F>
        <F label="Test"><select className="inp" value={test} onChange={e => setTest(e.target.value as typeof test)}>{(replace ? ['contains'] : Object.keys(TEST_NAMES).filter(k => k !== 'within' && k !== 'notWithin')).map(k => <option key={k} value={k}>{TEST_NAMES[k as keyof typeof TEST_NAMES]}</option>)}</select></F>
        <F label="Search"><select className="inp" value={up ? 'up' : 'down'} onChange={e => setUp(e.target.value === 'up')}><option value="down">Down</option><option value="up">Up</option></select></F>
        <label className="chk"><input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} />Match case</label>
      </div>
    </Modal>
  );
}

/* ---------- Multiple Task details ---------- */

export function MultiInfoDialog() {
  const st = useStore();
  const uids = st.sel.filter(u => u > 0);
  const [f, setF] = useState({ percent: '', priority: '', mode: '', constraint: '' as '' | ConstraintType, constraintDate: '', deadline: '', type: '' as '' | TaskType, calendar: '\u0000', duration: '', timeline: '', active: '', rollup: '', hideBar: '', resources: '' });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const ok = () => {
    let p = st.p;
    const errs: string[] = [];
    const run = (field: Field, text: string) => uids.forEach(u => { const out = editCell(p, schedule(p), u, field, text); if (out.error) errs.push(out.error); else p = out.p; });
    if (f.duration) run('duration', f.duration);
    if (f.percent) run('percent', f.percent);
    if (f.priority) run('priority', f.priority);
    if (f.mode) run('mode', f.mode);
    if (f.type) run('type', f.type);
    if (f.constraint) run('constraint', f.constraint);
    if (f.constraintDate) run('constraintDate', f.constraintDate);
    if (f.deadline) run('deadline', f.deadline);
    if (f.calendar !== '\u0000') uids.forEach(u => { p = updateTask(p, u, { calendar: f.calendar || null }); });
    if (f.resources) run('resources', f.resources);
    ([['timeline', f.timeline], ['active', f.active], ['rollup', f.rollup], ['hideBar', f.hideBar]] as const).forEach(([k, v]) => { if (v) run(k as Field, v); });
    if (errs.length) S().notify(errs[0] + (errs.length > 1 ? ' (' + errs.length + ' problems)' : ''), true);
    st.commit(p);
  };
  const tri = (v: string, onChange: (v: string) => void) => <select className="inp" value={v} onChange={e => onChange(e.target.value)}><option value="">(unchanged)</option><option value="true">Yes</option><option value="false">No</option></select>;
  return (
    <Modal title={'Details of ' + uids.length + ' tasks'} wide onOk={ok}>
      <p className="hint">Only the fields you fill in are changed; empty fields keep each task's own value.</p>
      <div className="grid2">
        <F label="Duration"><input className="inp" value={f.duration} placeholder="(unchanged)" onChange={e => set({ duration: e.target.value })} /></F>
        <F label="% complete"><input className="inp" value={f.percent} placeholder="(unchanged)" onChange={e => set({ percent: e.target.value })} /></F>
        <F label="Priority"><input className="inp" value={f.priority} placeholder="(unchanged)" onChange={e => set({ priority: e.target.value })} /></F>
        <F label="Schedule mode"><select className="inp" value={f.mode} onChange={e => set({ mode: e.target.value })}><option value="">(unchanged)</option><option>Auto Scheduled</option><option>Pinned</option></select></F>
        <F label="Task type"><select className="inp" value={f.type} onChange={e => set({ type: e.target.value as TaskType })}><option value="">(unchanged)</option>{Object.entries(TASK_TYPE_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Calendar"><select className="inp" value={f.calendar} onChange={e => set({ calendar: e.target.value })}><option value={'\u0000'}>(unchanged)</option><option value="">None</option>{st.p.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        <F label="Constraint type"><select className="inp" value={f.constraint} onChange={e => set({ constraint: e.target.value as ConstraintType })}><option value="">(unchanged)</option>{Object.entries(CONSTRAINT_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Constraint date"><DateInput value={f.constraintDate} format={st.p.settings.dateFormat} defaultMinute={st.p.settings.defaultStart} onChange={v => set({ constraintDate: v })} /></F>
        <F label="Deadline"><DateInput value={f.deadline} format={st.p.settings.dateFormat} defaultMinute={st.p.settings.defaultFinish} onChange={v => set({ deadline: v })} /></F>
        <F label="Resources (replaces)"><input className="inp" value={f.resources} placeholder="(unchanged)" onChange={e => set({ resources: e.target.value })} /></F>
        <F label="Display on Timeline">{tri(f.timeline, v => set({ timeline: v }))}</F>
        <F label="Active">{tri(f.active, v => set({ active: v }))}</F>
        <F label="Roll up to summary bar">{tri(f.rollup, v => set({ rollup: v }))}</F>
        <F label="Hide bar">{tri(f.hideBar, v => set({ hideBar: v }))}</F>
      </div>
    </Modal>
  );
}

/* ---------- Update Tasks ---------- */

export function UpdateTasksDialog() {
  const st = useStore();
  const uid = st.sel.find(u => u > 0);
  const r = uid != null ? st.s.byUid.get(uid) : undefined;
  const p = st.p;
  const d = (m: number) => formatDuration({ minutes: m, unit: r?.task.durUnit || p.settings.durationUnit, elapsed: false, estimated: false }, p.settings);
  const [f, setF] = useState(() => ({ percent: String(Math.round(r?.percent || 0)), actDur: r ? d(r.duration - r.remaining) : '', remDur: r ? d(r.remaining) : '', aStart: r?.task.actualStart != null ? fmtDate(r.task.actualStart, { time: true, format: p.settings.dateFormat }) : '', aFinish: r?.task.actualFinish != null ? fmtDate(r.task.actualFinish, { time: true, format: p.settings.dateFormat }) : '', notes: r?.task.notes || '' }));
  if (!r) return <Modal title="Record progress" noOk cancelLabel="Close"><p>Select a task.</p></Modal>;
  const init = { ...f };
  const ok = () => {
    let pp = st.p;
    const errs: string[] = [];
    const uids = st.sel.filter(u => u > 0);
    const run = (field: Field, text: string) => uids.forEach(u => { const out = editCell(pp, schedule(pp), u, field, text); if (out.error) errs.push(out.error); else pp = out.p; });
    if (f.aStart !== init.aStart || (f.aStart !== '' && st.p.tasks.find(t => t.uid === uid)?.actualStart == null)) { if (f.aStart !== '') run('actualStart', f.aStart); }
    if (f.actDur !== d(r.duration - r.remaining)) run('actualDuration', f.actDur);
    if (f.remDur !== d(r.remaining)) run('remainingDuration', f.remDur);
    if (f.percent !== String(Math.round(r.percent))) run('percent', f.percent);
    if (f.aFinish !== '' && f.aFinish !== (r.task.actualFinish != null ? fmtDate(r.task.actualFinish, { time: true, format: p.settings.dateFormat }) : '')) run('actualFinish', f.aFinish);
    if (f.notes !== r.task.notes) run('notes', f.notes);
    if (errs.length) { S().notify(errs[0], true); return false; }
    st.commit(pp);
  };
  return (
    <Modal title={'Record progress' + (st.sel.length > 1 ? ': ' + st.sel.length + ' tasks' : ': ' + r.task.name)} onOk={ok}>
      <div className="grid2">
        <F label="% Complete"><input className="inp" autoFocus value={f.percent} onChange={e => setF({ ...f, percent: e.target.value })} /></F>
        <F label="Duration"><input className="inp" disabled value={d(r.duration)} /></F>
        <F label="Actual duration"><input className="inp" value={f.actDur} onChange={e => setF({ ...f, actDur: e.target.value })} /></F>
        <F label="Remaining duration"><input className="inp" value={f.remDur} onChange={e => setF({ ...f, remDur: e.target.value })} /></F>
        <F label="Actual start"><DateInput value={f.aStart} format={p.settings.dateFormat} defaultMinute={p.settings.defaultStart} onChange={v => setF({ ...f, aStart: v })} /></F>
        <F label="Actual finish"><DateInput value={f.aFinish} format={p.settings.dateFormat} defaultMinute={p.settings.defaultFinish} onChange={v => setF({ ...f, aFinish: v })} /></F>
        <F label="Current start"><input className="inp" disabled value={fmtDate(r.start, { time: true, format: p.settings.dateFormat })} /></F>
        <F label="Current finish"><input className="inp" disabled value={fmtDate(r.finish, { time: true, format: p.settings.dateFormat })} /></F>
      </div>
      <F label="Notes" wide><textarea className="inp" rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></F>
    </Modal>
  );
}

/* ---------- Copy Picture ---------- */

export function CopyPictureDialog() {
  const st = useStore();
  const [target, setTarget] = useState<'clipboard' | 'png' | 'svg'>('clipboard');
  const [rows, setRows] = useState<'screen' | 'selected' | 'all'>('all');
  const [range, setRange] = useState<'all' | 'dates'>('all');
  const [from, setFrom] = useState(fmtDate(st.s.start, { format: st.p.settings.dateFormat }));
  const [to, setTo] = useState(fmtDate(st.s.finish, { format: st.p.settings.dateFormat }));
  const [busy, setBusy] = useState(false);
  const ok = () => {
    const a = parseDateText(from, st.p.settings.dateFormat), b = parseDateText(to, st.p.settings.dateFormat);
    setBusy(true);
    copyPicture({ target, rows, from: range === 'dates' && a ? atDay(a.day) : null, to: range === 'dates' && b ? atDay(b.day + 1) : null, scale: 2 })
      .then(msg => { S().notify(msg); S().close(); }, e => { S().notify(e.message, true); setBusy(false); });
    return false;
  };
  return (
    <Modal title="Copy view as image" onOk={ok} okLabel={busy ? 'Working…' : 'OK'}>
      <h3>Render image</h3>
      <label className="chk"><input type="radio" checked={target === 'clipboard'} onChange={() => setTarget('clipboard')} />To the clipboard (paste into documents, email or slides)</label>
      <label className="chk"><input type="radio" checked={target === 'png'} onChange={() => setTarget('png')} />To a PNG file</label>
      <label className="chk"><input type="radio" checked={target === 'svg'} onChange={() => setTarget('svg')} />To an SVG file (sharp at any size)</label>
      <h3>Copy</h3>
      <label className="chk"><input type="radio" checked={rows !== 'selected'} onChange={() => setRows('all')} />All rows of the view</label>
      <label className="chk"><input type="radio" checked={rows === 'selected'} disabled={!st.sel.length} onChange={() => setRows('selected')} />Selected rows</label>
      <h3>Timescale</h3>
      <label className="chk"><input type="radio" checked={range === 'all'} onChange={() => setRange('all')} />The whole project</label>
      <label className="chk"><input type="radio" checked={range === 'dates'} onChange={() => setRange('dates')} />From</label>
      {range === 'dates' && <div className="grid2"><DateInput value={from} format={st.p.settings.dateFormat} defaultMinute={0} onChange={setFrom} /><DateInput value={to} format={st.p.settings.dateFormat} defaultMinute={0} onChange={setTo} /></div>}
      <p className="hint">Uses the {VIEW_LABELS[st.ui.view]} with the {TABLES[st.ui.table].label} table and the current zoom.</p>
    </Modal>
  );
}

/* ---------- Save View ---------- */

export function SaveViewDialog() {
  const st = useStore();
  const [name, setName] = useState(VIEW_LABELS[st.ui.view] + ' – my view');
  return (
    <Modal title="Save this view" onOk={() => { if (!name.trim()) return false; const v = { id: 'v' + Date.now().toString(36), name: name.trim(), screen: st.ui.view, table: st.ui.table, filter: st.ui.filter, group: st.ui.group || '', highlight: st.ui.highlight }; st.commit({ ...st.p, views: st.p.views.filter(x => x.name !== v.name).concat(v) }); S().notify('View saved. Find it under View › Other Views.'); }}>
      <F label="Name"><input className="inp" autoFocus value={name} onChange={e => setName(e.target.value)} /></F>
      <p className="hint">Saves the current screen ({VIEW_LABELS[st.ui.view]}), table ({TABLES[st.ui.table].label}), filter and group with the plan.</p>
      {st.p.views.length > 0 && <><h3>Saved views</h3><ul className="collist">{st.p.views.map(v => <li key={v.id}><span>{v.name}</span><button type="button" className="icon-btn" onClick={() => st.commit({ ...st.p, views: st.p.views.filter(x => x.id !== v.id) })}><Icon name="x" /></button></li>)}</ul></>}
    </Modal>
  );
}

export { DAYS };

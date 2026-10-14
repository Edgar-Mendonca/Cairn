// Quick add (Ctrl+J): type a whole task in one line and press Enter. Stays open for the next one.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { S } from './store';
import Icon from './Icon';
import { editTask, insertTask, scrollToTask } from './actions';
import { parseQuickAdd, type QuickTask } from '../engine/quickadd';

// A link written as a row number stays a number; a name is matched against task names.
function rowFor(ref: string): number | null {
  if (/^\d+$/.test(ref)) return +ref;
  const q = ref.toLowerCase();
  const rows = S().s.rows.filter(r => r.task.uid > 0);
  const hit = rows.find(r => r.task.name.toLowerCase() === q) || rows.find(r => r.task.name.toLowerCase().startsWith(q)) || rows.find(r => r.task.name.toLowerCase().includes(q));
  return hit ? hit.id : null;
}

function addTask(q: QuickTask): string | null {
  if (!q.name) return 'Type a task name first.';
  const missing = q.after.filter(a => rowFor(a) == null);
  const uid = insertTask(q.milestone ? { duration: 0, milestone: true, estimated: false } : { estimated: false }, q.name);
  if (q.duration && !q.milestone) editTask(uid, 'duration', q.duration);
  const preds = q.after.map(rowFor).filter((x): x is number => x != null);
  if (preds.length) editTask(uid, 'preds', preds.join(','));
  if (q.people.length) editTask(uid, 'resources', q.people.join(','));
  if (q.from) editTask(uid, 'start', q.from);
  if (q.by) editTask(uid, 'deadline', q.by);
  setTimeout(scrollToTask, 0);
  return missing.length ? 'Added. No task matched “' + missing.join('”, “') + '”, so it was not linked.' : null;
}

export default function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const show = () => { flushSync(() => { setOpen(true); setMsg(null); }); input.current?.focus(); };
    window.addEventListener('cairn:quickadd', show);
    return () => window.removeEventListener('cairn:quickadd', show);
  }, []);
  if (!open) return null;
  const q = parseQuickAdd(v);
  const chips: string[] = [];
  if (q.milestone) chips.push('Milestone'); else if (q.duration) chips.push(q.duration);
  q.after.forEach(a => chips.push('after ' + a + (rowFor(a) != null && !/^\d+$/.test(a) ? ' (row ' + rowFor(a) + ')' : '')));
  q.people.forEach(p => chips.push('@' + p));
  if (q.from) chips.push('from ' + q.from);
  if (q.by) chips.push('due ' + q.by);
  return (
    <div className="quickadd" role="dialog" aria-label="Quick add">
      <Icon name="sparkle" />
      <div className="qa-main">
        <input ref={input} value={v} placeholder="Pour slab 5d after 4 @Crew by 20 Mar" onChange={e => { setV(e.target.value); setMsg(null); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); const r = addTask(q); if (!r || r.startsWith('Added')) setV(''); setMsg(r); }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }} />
        <div className="qa-chips">{q.name && <b>{q.name}</b>}{chips.map(c => <span key={c} className="chip">{c}</span>)}{msg && <em>{msg}</em>}
          {!v && <span className="muted">Name, then a duration (5d, 2w, 4h), “after” a row number or task name, @people, “from” a start, “by” a deadline, ! for a milestone. Enter adds it, Esc closes.</span>}</div>
      </div>
      <button className="icon-btn" title="Close (Esc)" onClick={() => setOpen(false)}><Icon name="close" /></button>
    </div>
  );
}

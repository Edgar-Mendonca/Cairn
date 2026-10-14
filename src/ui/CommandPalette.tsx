// Ctrl+K: search every command, view, report, filter and task, then press Enter to run or jump.
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { S, TABLES, type TableName } from './store';
import Icon from './Icon';
import { COMMANDS, keyLabel } from './commands';
import { scrollToTask } from './actions';
import { REPORTS } from './views/Reports';
import { BUILTIN_FILTERS, BUILTIN_GROUPS } from '../engine/filters';
import { pickFilter } from './MenuBar';

interface Hit { label: string; icon: string; run: () => void; keys?: string; section: string; hint?: string; disabled?: boolean }

function everything(): Hit[] {
  const out: Hit[] = COMMANDS.map(c => ({ label: c.label.replace(/…$/, ''), icon: c.icon || 'chevR', run: c.run, keys: c.keys, section: c.section, hint: c.hint, disabled: c.enabled ? !c.enabled() : false }));
  (Object.keys(TABLES) as TableName[]).forEach(t => out.push({ label: 'Columns: ' + TABLES[t].label, icon: 'table', run: () => S().setUI({ table: t }), section: 'Columns' }));
  REPORTS.forEach(r => out.push({ label: 'Report: ' + r.name, icon: 'dashboard', run: () => S().setUI({ view: 'reports', report: r.id }), section: 'Reports' }));
  BUILTIN_FILTERS.filter(f => !f.hidden && f.id !== 'all').forEach(f => out.push({ label: 'Filter: ' + f.name, icon: 'filter', run: () => pickFilter(f.id), section: 'Filters' }));
  BUILTIN_GROUPS.forEach(g => out.push({ label: 'Group by: ' + g.name, icon: 'groupby', run: () => S().setUI({ group: g.id }), section: 'Groups' }));
  return out;
}

const SUGGESTED = ['insert.task', 'insert.quick', 'task.details', 'task.link', 'view.critical', 'file.import', 'help.guide'];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Rendered at once so the next key typed lands in the search box, not in the table.
    const show = () => { flushSync(() => { setOpen(true); setQ(''); setHi(0); }); input.current?.focus(); };
    window.addEventListener('cairn:palette', show);
    return () => window.removeEventListener('cairn:palette', show);
  }, []);
  const all = useMemo(() => (open ? everything() : []), [open]);
  if (!open) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s: string) => words.every(w => s.toLowerCase().includes(w));
  let hits: Hit[];
  if (!words.length) hits = SUGGESTED.map(id => all[COMMANDS.findIndex(c => c.id === id)]).filter(Boolean);
  else {
    const rank = (h: Hit) => (h.label.toLowerCase().startsWith(q.trim().toLowerCase()) ? 0 : match(h.label) ? 1 : 2);
    hits = all.filter(h => match(h.label + ' ' + h.section + ' ' + (h.hint || ''))).sort((a, b) => rank(a) - rank(b)).slice(0, 10);
    S().s.rows.filter(r => r.task.uid > 0 && match(r.task.name)).slice(0, 6).forEach(r => hits.push({
      label: r.id + '  ' + r.task.name, icon: r.summary ? 'summary' : r.duration === 0 ? 'milestone' : 'task', section: 'Tasks',
      run: () => { S().set({ sel: [r.task.uid] }); setTimeout(scrollToTask, 0); }
    }));
  }
  const close = () => setOpen(false);
  const go = (h: Hit) => { if (h.disabled) return; close(); h.run(); };
  return (
    <div className="palette-back" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Search commands and tasks" onMouseDown={e => e.stopPropagation()}>
        <div className="pal-in"><Icon name="find" />
          <input ref={input} value={q} placeholder="Type a command, view or task name…" onChange={e => { setQ(e.target.value); setHi(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hits.length - 1, hi + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, hi - 1)); }
              else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); go(hits[hi]); }
              else if (e.key === 'Escape') { e.preventDefault(); close(); }
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list">
          {!words.length && <div className="pal-sec">Suggested</div>}
          {hits.map((h, i) => (
            <button key={h.section + h.label + i} className={'pal-item' + (i === hi ? ' on' : '')} disabled={h.disabled} onMouseEnter={() => setHi(i)} onClick={() => go(h)}>
              <Icon name={h.icon} /><span className="pal-l">{h.label}{h.hint && <small>{h.hint}</small>}</span>
              {h.keys ? <kbd>{keyLabel(h.keys)}</kbd> : <em>{h.section}</em>}
            </button>
          ))}
          {!hits.length && <p className="pal-empty">Nothing matches “{q}”. Try a shorter word.</p>}
        </div>
      </div>
    </div>
  );
}

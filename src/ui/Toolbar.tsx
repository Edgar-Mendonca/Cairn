// The toolbar: one slim row of the most used commands. When the window is narrow, the less used groups
// fold away (everything stays in the menus and in the command palette).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { S, useStore } from './store';
import Icon from './Icon';
import Palette from './Palette';
import { cmd, keyLabel, run } from './commands';
import { MenuList, pickFilter, type Entry } from './MenuBar';
import { activeFormat, applyFormat, FONTS, SIZES } from './actions';
import { BUILTIN_FILTERS, BUILTIN_GROUPS } from '../engine/filters';
import { SORTS } from './commands';

function Btn({ id, label, showLabel }: { id: string; label?: string; showLabel?: boolean }) {
  const c = cmd(id);
  const dis = c.enabled ? !c.enabled() : false;
  const on = c.checked?.();
  const tip = (label || c.label) + (c.keys ? ' (' + keyLabel(c.keys) + ')' : '') + (c.hint ? '\n' + c.hint : '');
  return (
    <button className={'tb' + (on ? ' on' : '') + (showLabel ? ' lab' : '')} disabled={dis} title={tip} aria-label={c.label} aria-pressed={on || undefined} onMouseDown={e => e.preventDefault()} onClick={() => run(id)}>
      <Icon name={c.icon || 'chevR'} />{showLabel && <span>{label || c.label}</span>}
    </button>
  );
}

function Drop({ icon, label, title, entries, on, children, wide }: { icon: string; label?: string; title: string; entries?: () => Entry[]; on?: boolean; children?: ReactNode; wide?: boolean }) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.tb-pop') && !ref.current?.contains(e.target as Node)) setPos(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [pos]);
  const open = () => { const r = ref.current!.getBoundingClientRect(); setPos({ left: Math.min(r.left, window.innerWidth - (wide ? 300 : 250)), top: r.bottom + 4 }); };
  return <>
    <button ref={ref} className={'tb drop' + (on ? ' on' : '') + (label ? ' lab' : '')} title={title} aria-haspopup="menu" onMouseDown={e => e.preventDefault()} onClick={() => (pos ? setPos(null) : open())}>
      {icon && <Icon name={icon} />}{label && <span>{label}</span>}<i className="caret" />
    </button>
    {pos && <div className="tb-pop" style={{ ...pos, position: 'fixed' }}>{entries ? <MenuList entries={entries()} onDone={() => setPos(null)} /> : <div className="menu pad" onClick={() => setPos(null)}>{children}</div>}</div>}
  </>;
}

const lastColor = { color: '#c0392b', bg: '#fff1b8' };

function FormatGroup() {
  const st = useStore();
  const f = activeFormat(st);
  const none = !st.sel.length && !st.colSel;
  return <>
    <select className="tb-sel font" value={f.font || st.p.textStyles.all?.font || ''} disabled={none} title="Font" onChange={e => applyFormat({ font: e.target.value || undefined })}>
      <option value="">Default font</option>{FONTS.map(x => <option key={x} value={x} style={{ fontFamily: x }}>{x}</option>)}
    </select>
    <select className="tb-sel size" value={String(f.size || st.p.textStyles.all?.size || 9)} disabled={none} title="Text size" onChange={e => applyFormat({ size: +e.target.value === 9 ? undefined : +e.target.value })}>
      {SIZES.map(x => <option key={x} value={x}>{x}</option>)}
    </select>
    <Btn id="fmt.bold" /><Btn id="fmt.italic" /><Btn id="fmt.underline" />
    <Drop icon="highlight" title="Fill colour" on={!!f.bg}><Palette value={f.bg} auto="No fill" onPick={c => { if (c) lastColor.bg = c; applyFormat({ bg: c }); }} /></Drop>
    <Drop icon="fontcolor" title="Text colour" on={!!f.color}><Palette value={f.color} onPick={c => { if (c) lastColor.color = c; applyFormat({ color: c }); }} /></Drop>
    <Btn id="edit.copyFormat" />
  </>;
}

const pctEntries = (): Entry[] => ['track.0', 'track.25', 'track.50', 'track.75', 'track.100', '-', 'track.uptoDate', 'track.update'];
const addEntries = (): Entry[] => ['insert.task', 'insert.milestone', 'insert.phase', 'insert.repeating', 'insert.quick', '-', 'insert.person'];
const filterEntries = (): Entry[] => {
  const ui = S().ui;
  const common = ['critical', 'late', 'incomplete', 'inProgress', 'milestones', 'manual', 'overallocated', 'dateRange', 'usingResource'];
  return [{ label: 'Show all tasks', checked: ui.filter === 'all', run: () => S().setUI({ filter: 'all', highlight: false }) }, '-',
    ...BUILTIN_FILTERS.filter(f => common.includes(f.id)).map(f => ({ label: f.name, checked: ui.filter === f.id, run: () => pickFilter(f.id, ui.highlight) })),
    ...S().p.filters.map(f => ({ label: f.name, checked: ui.filter === f.id, run: () => pickFilter(f.id, ui.highlight) })),
    '-', { label: 'Highlight matches instead of hiding the rest', checked: ui.highlight, run: () => S().setUI({ highlight: !ui.highlight }) }, 'view.filters', 'view.newFilter'];
};
const groupEntries = (): Entry[] => [{ label: 'No grouping', checked: !S().ui.group, run: () => S().setUI({ group: null }) }, '-', ...BUILTIN_GROUPS.map(g => ({ label: g.name, checked: S().ui.group === g.id, run: () => S().setUI({ group: g.id }) })), '-', 'view.groups'];
const sortEntries = (): Entry[] => [...SORTS.map(([k, l]) => ({ label: l, checked: k === 'id' ? !S().ui.sort && !S().ui.sorts.length : (S().ui.sorts[0] || S().ui.sort)?.field === k, run: () => S().setUI({ sort: k === 'id' ? null : { field: k, desc: k === 'priority' || k === 'cost' }, sorts: [] }) })), '-', 'view.sort'];

export default function Toolbar() {
  const st = useStore();
  const ui = st.ui;
  const ref = useRef<HTMLDivElement>(null);
  // Fold groups away from the lowest priority up until the row fits. Measured when the window or the
  // view changes, not on every edit (measuring forces the browser to lay out the page).
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const fit = () => {
      const groups = [...el.querySelectorAll<HTMLElement>('[data-prio]')].sort((a, b) => +a.dataset.prio! - +b.dataset.prio!);
      groups.forEach(g => (g.style.display = ''));
      for (const g of groups) { if (el.scrollWidth <= el.clientWidth + 1) break; g.style.display = 'none'; }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [ui.view, ui.theme]);
  const pct = st.sel.length ? (st.s.byUid.get(st.sel[0])?.percent ?? 0) : 0;
  return (
    <div className="toolbar" ref={ref} role="toolbar" aria-label="Tools">
      <div className="tg"><Btn id="edit.undo" /><Btn id="edit.redo" /></div>
      <div className="tg">
        <button className="tb lab primary" title={'Add a task (' + keyLabel('Mod+Enter') + ')'} onMouseDown={e => e.preventDefault()} onClick={() => run('insert.task')}><Icon name="plus" /><span>Task</span></button>
        <Drop icon="" title="Add a milestone, phase or other item" entries={addEntries} />
        <Btn id="edit.delete" />
      </div>
      <div className="tg" data-prio="6"><Btn id="task.outdent" /><Btn id="task.indent" /><Btn id="task.link" /><Btn id="task.unlink" /></div>
      <div className="tg" data-prio="5">
        <Drop icon="check" label={st.sel.length ? pct + '%' : 'Progress'} title="Progress of the selected tasks" entries={pctEntries} />
      </div>
      <div className="tg" data-prio="3"><FormatGroup /></div>
      <div className="tg" data-prio="4">
        <Drop icon="filter" label="Filter" title="Show only some tasks" on={ui.filter !== 'all'} entries={filterEntries} wide />
        <Drop icon="groupby" label="Group" title="Group tasks" on={!!ui.group} entries={groupEntries} />
        <Drop icon="sort" label="Sort" title="Sort tasks" on={!!ui.sort || ui.sorts.length > 0} entries={sortEntries} />
      </div>
      <div className="tg" data-prio="2"><Btn id="view.zoomOut" /><Btn id="view.zoomIn" /><Btn id="view.fit" /></div>
      <div className="tg" data-prio="1"><Btn id="view.critical" label="Critical path" showLabel /><Btn id="view.baseline" /></div>
      <span className="sp" />
      <div className="tg end"><Btn id="view.inspector" label="Details" showLabel /></div>
    </div>
  );
}

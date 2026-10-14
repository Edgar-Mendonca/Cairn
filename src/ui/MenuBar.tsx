// The menu bar: File, Edit, Insert, Task, Progress, People, Format, View, Help. Items come from the command list,
// plus a few lists built from the plan (filters, groups, tables, reports, saved views).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { S, TABLES, useStore, type TableName } from './store';
import Icon from './Icon';
import { cmd, keyLabel, SORTS, SCHEMES, applySavedView, applyScheme } from './commands';
import { GANTT_VIEWS } from './store';
import { BUILTIN_FILTERS, BUILTIN_GROUPS } from '../engine/filters';
import { REPORTS } from './views/Reports';
import { ZOOM_PRESETS } from '../engine/gantt';
import { zoomToPreset } from './actions';

export interface MenuItem { label: string; icon?: string; keys?: string; run?: () => void; disabled?: boolean; checked?: boolean; sub?: () => Entry[]; hint?: string }
export type Entry = MenuItem | '-' | string;

const fromCmd = (id: string): MenuItem => { const c = cmd(id); return { label: c.label, icon: c.icon, keys: c.keys, run: c.run, disabled: c.enabled ? !c.enabled() : false, checked: c.checked?.(), hint: c.hint }; };
export const resolve = (e: Entry): MenuItem | '-' => (e === '-' ? '-' : typeof e === 'string' ? fromCmd(e) : e);

export function pickFilter(id: string, highlight = false) {
  const st = S();
  const b = BUILTIN_FILTERS.find(f => f.id === id);
  const custom = st.p.filters.find(f => f.id === id);
  if ((b?.ask?.length) || (custom && custom.criteria.some(c => c.value.startsWith('?') || c.value2.startsWith('?')))) st.open('filterArgs', { id, highlight });
  else st.setUI({ filter: id, filterArgs: [], highlight });
}
const filterItems = (highlight: boolean): Entry[] => {
  const st = S();
  return [
    { label: highlight ? 'No highlight' : 'Show all tasks', checked: st.ui.filter === 'all', run: () => st.setUI({ filter: 'all', highlight: false }) }, '-',
    ...BUILTIN_FILTERS.filter(f => !f.hidden && f.id !== 'all').map(f => ({ label: f.name, checked: st.ui.filter === f.id && st.ui.highlight === highlight, run: () => pickFilter(f.id, highlight) })),
    ...(st.p.filters.length ? ['-' as Entry, ...st.p.filters.map(f => ({ label: f.name, checked: st.ui.filter === f.id, run: () => pickFilter(f.id, highlight) }))] : []),
    '-', 'view.newFilter', 'view.filters'
  ];
};
const groupItems = (): Entry[] => {
  const st = S();
  return [{ label: 'No grouping', checked: !st.ui.group, run: () => st.setUI({ group: null }) }, '-',
    ...BUILTIN_GROUPS.map(g => ({ label: g.name, checked: st.ui.group === g.id, run: () => st.setUI({ group: g.id }) })),
    ...st.p.groups.map(g => ({ label: g.name, checked: st.ui.group === g.id, run: () => st.setUI({ group: g.id }) })), '-', 'view.groups'];
};
const sortItems = (): Entry[] => {
  const ui = S().ui;
  return [...SORTS.map(([k, l]) => ({ label: l, checked: k === 'id' ? !ui.sort && !ui.sorts.length : (ui.sorts[0] || ui.sort)?.field === k, run: () => S().setUI({ sort: k === 'id' ? null : { field: k, desc: k === 'priority' || k === 'cost' }, sorts: [] }) })), '-', 'view.sort'];
};
const tableItems = (): Entry[] => [...(Object.keys(TABLES) as TableName[]).map(k => ({ label: TABLES[k].label, checked: S().ui.table === k, run: () => S().setUI({ table: k }) })), '-', 'fmt.columns'];
const outlineItems = (): Entry[] => [{ label: 'All levels', checked: !S().ui.outlineLevel, run: () => S().setUI({ outlineLevel: 0, collapsed: {} }) },
  ...[1, 2, 3, 4, 5].map(l => ({ label: 'Level ' + l, checked: S().ui.outlineLevel === l, run: () => S().setUI({ outlineLevel: l, collapsed: {} }) }))];
const zoomItems = (): Entry[] => ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.fitSel', '-', ...ZOOM_PRESETS.map((z, i) => ({ label: z.name, run: () => zoomToPreset(i) })), '-', 'fmt.timescale'];
const reportItems = (): Entry[] => REPORTS.map(r => ({ label: r.name, checked: S().ui.view === 'reports' && S().ui.report === r.id, run: () => S().setUI({ view: 'reports', report: r.id }) }));
const savedViews = (): Entry[] => [...S().p.views.map(v => ({ label: v.name, run: () => applySavedView(v.id) })), ...(S().p.views.length ? ['-' as Entry] : []), 'view.saveView'];

export const MENUS: [string, () => Entry[]][] = [
  ['File', () => ['file.new', 'file.open', 'file.recent', '-', 'file.save', 'file.saveAs', '-', 'file.import', { label: 'Export', icon: 'download', sub: () => ['file.exportXml', 'file.exportXer', 'file.exportXlsx', 'file.exportCsv', 'file.exportIcs', '-', 'file.picture'] }, 'file.print', '-', 'file.settings', 'file.prefs']],
  ['Edit', () => ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.fillDown', 'edit.delete', '-', 'edit.find', 'edit.replace', 'edit.goto', '-', 'edit.copyFormat', 'edit.clearFormat',
    { label: 'Remove', sub: () => ['edit.clearLinks', 'edit.clearNotes', 'edit.clearSplits', 'edit.clearConstraints'] }]],
  ['Insert', () => ['insert.task', 'insert.milestone', 'insert.phase', 'insert.repeating', 'insert.quick', 'insert.blank', '-', 'insert.note', 'insert.link', '-', 'insert.person', 'insert.material', 'insert.costItem', '-', 'insert.column', { label: 'Shape on the chart', icon: 'drawing', sub: () => ['insert.text', 'insert.rect', 'insert.arrow'] }]],
  ['Task', () => ['task.details', '-', 'task.indent', 'task.outdent', 'task.moveUp', 'task.moveDown', '-', 'task.link', 'task.unlink', 'task.split', '-', 'task.auto', 'task.pin', 'task.snap', 'task.shift', 'task.active', 'task.timeline', '-', 'task.explain', 'task.jump', 'task.open']],
  ['Progress', () => ['track.0', 'track.25', 'track.50', 'track.75', 'track.100', 'track.uptoDate', '-', 'track.update', 'track.updatePlan', 'track.statusDate', '-', 'track.baseline', 'track.clearBaseline', 'track.snapshot', 'track.progressLines']],
  ['Plan', () => ['plan.calendar', 'plan.shift', 'plan.newMode', '-', 'team.assign', 'team.assignment', '-', 'team.balance', 'team.balanceSel', 'team.balanceOne', 'team.unbalance', 'team.balanceOpts', 'team.nextOverload', '-', 'plan.wbs', 'plan.renumber', 'plan.fields', 'plan.summary']],
  ['Format', () => ['fmt.bold', 'fmt.italic', 'fmt.underline', 'fmt.strike', 'fmt.font', 'fmt.styles', '-', 'fmt.bar', 'fmt.barStyles', { label: 'Bar colours', icon: 'palette', sub: () => SCHEMES.map(sc => ({ label: sc[0][0].toUpperCase() + sc[0].slice(1), run: () => applyScheme(GANTT_VIEWS.has(S().ui.view) ? S().ui.view : 'gantt', sc) })) }, 'fmt.layout', 'fmt.gridlines', 'fmt.timescale', '-', 'fmt.columns', 'fmt.field']],
  ['View', () => [{ label: 'Views', icon: 'gantt', sub: () => ['view.gantt', 'view.tracking', 'view.detail', 'view.leveling', 'view.multiBaseline', 'view.taskSheet', 'view.taskUsage', 'view.calendar', 'view.network', 'view.timeline', '-', 'view.teamPlanner', 'view.resourceSheet', 'view.resourceUsage', 'view.resourceGraph', 'view.reports'] },
    { label: 'Reports', icon: 'dashboard', sub: reportItems }, { label: 'Saved views', sub: savedViews }, '-',
    { label: 'Filter', icon: 'filter', sub: () => filterItems(false) }, { label: 'Highlight', icon: 'highlightrows', sub: () => filterItems(true) }, { label: 'Group by', icon: 'groupby', sub: groupItems }, { label: 'Sort by', icon: 'sort', sub: sortItems },
    { label: 'Columns set', icon: 'table', sub: tableItems }, { label: 'Outline level', icon: 'outline', sub: outlineItems }, '-',
    'view.critical', 'view.float', 'view.late', 'view.baseline', 'view.timelineStrip', 'view.inspector', 'view.wbs', 'view.planRow', '-', { label: 'Zoom', icon: 'zoomin', sub: zoomItems }, '-', 'view.theme']],
  ['Help', () => ['help.guide', 'help.keys', 'help.formats', 'help.palette', '-', 'help.about']]
];

export function MenuList({ entries, onDone, style, nested }: { entries: Entry[]; onDone: () => void; style?: React.CSSProperties; nested?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const items = entries.map(resolve);
  return (
    <div className={'menu' + (nested ? ' nested' : '')} style={style} role="menu" onMouseDown={e => e.stopPropagation()}>
      {items.map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> : (
        <div key={i} className="menu-row" onMouseEnter={() => setOpen(it.sub ? i : null)}>
          <button className={'menu-item' + (it.checked ? ' on' : '')} role="menuitem" disabled={it.disabled} title={it.hint}
            onClick={() => { if (it.sub) { setOpen(i); return; } onDone(); it.run?.(); }}>
            <span className="menu-ic">{it.checked ? <Icon name="check" /> : it.icon ? <Icon name={it.icon} /> : null}</span>
            <span className="menu-l">{it.label}</span>
            {it.keys && <kbd>{keyLabel(it.keys)}</kbd>}
            {it.sub && <Icon name="chevR" />}
          </button>
          {it.sub && open === i && <MenuList entries={it.sub()} onDone={onDone} nested />}
        </div>
      ))}
    </div>
  );
}

export default function MenuBar() {
  useStore(s => s.ui.view); // re-render checks when the view changes
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open == null) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      else if (e.key === 'ArrowRight') setOpen(((open ?? 0) + 1) % MENUS.length);
      else if (e.key === 'ArrowLeft') setOpen(((open ?? 0) - 1 + MENUS.length) % MENUS.length);
    };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <nav className="menubar" ref={ref} aria-label="Menu">
      {MENUS.map(([label, list], i): ReactNode => (
        <div key={label} className="mb-wrap">
          <button className={'mb-top' + (open === i ? ' on' : '')} onMouseDown={e => { e.preventDefault(); setOpen(open === i ? null : i); }} onMouseEnter={() => { if (open != null) setOpen(i); }}>{label}</button>
          {open === i && <MenuList entries={list()} onDone={() => setOpen(null)} />}
        </div>
      ))}
    </nav>
  );
}

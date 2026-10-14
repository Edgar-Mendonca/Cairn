// The application window: title bar, menu bar and toolbar; the view rail, the active view and the details panel;
// the status bar; and the overlays (palette, quick add, help, home, menus, dialogs).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { GANTT_VIEWS, S, useStore, VIEW_LABELS, type ViewName } from './store';
import MenuBar from './MenuBar';
import Toolbar from './Toolbar';
import Home from './Home';
import Help from './Help';
import Inspector from './Inspector';
import QuickAdd from './QuickAdd';
import CommandPalette from './CommandPalette';
import { COMMANDS, commandForKeys, eventKeys, keyLabel, run, VIEW_ORDER } from './commands';
import TaskTable from './TaskTable';
import Gantt from './Gantt';
import Timeline from './Timeline';
import ResourceSheet from './ResourceSheet';
import DialogHost from './Dialogs';
import Icon from './Icon';
import Palette from './Palette';
import { NetworkDiagram } from './views/Network';
import { CalendarView } from './views/CalendarView';
import { TaskUsage, ResourceUsage } from './views/Usage';
import { ResourceGraph } from './views/ResourceGraph';
import { TeamPlanner } from './views/TeamPlanner';
import { TaskForm } from './views/TaskForm';
import { Reports } from './views/Reports';
import { makeColumn, type Column } from './columns';
import { makeLayout, ROW_H } from './layout';
import { FONTS, SIZES, activeFilter, activeFormat, applyFormat, ctxOf, currentColumns, indentSel, linkSel, percentSel, saveFile, toggleSel, unlinkSel, visibleRows, zoomBy, setZoomPx, readDroppedFile } from './actions';
import { stylesFor, ZOOM_PRESETS } from '../engine/gantt';
import { blockHeight, maxBarRow } from './gantt/draw';
import { pxPerDay, tierHeight } from './gantt/timescale';
import { fmtDate } from '../engine/time';
import { toggleSet } from './Gantt';
import iconUrl from '../assets/cairn-icon.svg';

function TaskView({ sheetOnly }: { sheetOnly?: boolean }) {
  const st = useStore();
  const view = st.ui.view;
  const rows = visibleRows(st);
  const ctx = ctxOf(st);
  const cols = currentColumns(st).map(c => makeColumn(c, st.p)).filter((c): c is Column => !!c);
  const gantt = !sheetOnly && GANTT_VIEWS.has(view);
  const styles = stylesFor(st.p.gantt, view);
  const minH = gantt ? Math.max(ROW_H, blockHeight(maxBarRow(styles, toggleSet(st.ui)), st.p.gantt.layout.barHeight) + 8) : ROW_H;
  const layout = makeLayout(rows, cols, ctx, minH);
  const headH = gantt ? tierHeight(st.p.gantt.timescale) : 44;
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [split, setSplit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight - headH));
    ro.observe(el);
    return () => ro.disconnect();
  }, [headH]);
  // Divider between table and chart
  useEffect(() => {
    if (split == null) return;
    const move = (e: MouseEvent) => S().setUI({ gridWidth: Math.max(160, Math.min(window.innerWidth - 200, e.clientX - (ref.current?.getBoundingClientRect().left || 0))) });
    const up = () => setSplit(null);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [split]);
  const max = Math.max(0, layout.total - height);
  const onScroll = (t: number) => setScrollTop(Math.max(0, Math.min(max, t)));
  return (
    <div className="taskview" ref={ref}>
      <div className="pane-left" style={{ width: gantt ? st.ui.gridWidth : '100%' }}>
        <TaskTable rows={rows} ctx={ctx} layout={layout} scrollTop={scrollTop} height={height} onScroll={onScroll} headH={headH} />
      </div>
      {gantt && <>
        <div className="divider" onMouseDown={e => { e.preventDefault(); setSplit(e.clientX); }} onDoubleClick={() => S().setUI({ gridWidth: Math.min(window.innerWidth * 0.6, 40 + cols.reduce((a, c) => a + c.width, 0) + 2) })} />
        <div className="pane-right"><Gantt rows={rows} layout={layout} scrollTop={scrollTop} height={height} onScroll={onScroll} view={view} headH={headH} /></div>
      </>}
    </div>
  );
}

// The formatting strip at the top of the row menu: font, size, emphasis, colours, progress, outline and links.
function MiniBar({ close }: { close: () => void }) {
  const st = useStore();
  const f = activeFormat(st);
  const [pal, setPal] = useState<'bg' | 'color' | null>(null);
  const b = (icon: string, title: string, act: () => void, on = false, keep = true) => (
    <button key={title} type="button" className={'mb-btn' + (on ? ' on' : '')} title={title} onMouseDown={e => e.preventDefault()} onClick={() => { act(); if (!keep) close(); }}><Icon name={icon} /></button>
  );
  return (
    <div className="minibar" onMouseDown={e => e.stopPropagation()}>
      <div className="mb-row">
        <select className="rb-combo font" value={f.font || ''} title="Font" onChange={e => applyFormat({ font: e.target.value || undefined })}>
          <option value="">Default font</option>{FONTS.map(x => <option key={x} value={x} style={{ fontFamily: x }}>{x}</option>)}
        </select>
        <select className="rb-combo size" value={String(f.size || 9)} title="Font size" onChange={e => applyFormat({ size: +e.target.value === 9 ? undefined : +e.target.value })}>{SIZES.map(x => <option key={x} value={x}>{x}</option>)}</select>
        {b('bold', 'Bold', () => applyFormat({ b: !f.b }), !!f.b)}
        {b('italic', 'Italic', () => applyFormat({ i: !f.i }), !!f.i)}
        {b('underline', 'Underline', () => applyFormat({ u: !f.u }), !!f.u)}
        {b('highlight', 'Background colour', () => setPal(pal === 'bg' ? null : 'bg'), pal === 'bg')}
        {b('fontcolor', 'Font colour', () => setPal(pal === 'color' ? null : 'color'), pal === 'color')}
      </div>
      <div className="mb-row">
        {[0, 25, 50, 75, 100].map(v => <button key={v} type="button" className="mb-btn pct" title={v + '% complete'} onMouseDown={e => e.preventDefault()} onClick={() => percentSel(v)}><i className="pie" style={{ '--p': v / 100 } as CSSProperties} /></button>)}
        <span className="mb-sep" />
        {b('outdent', 'Outdent (' + keyLabel('Mod+[') + ')', () => indentSel(-1))}
        {b('indent', 'Indent (' + keyLabel('Mod+]') + ')', () => indentSel(1))}
        {b('link', 'Link tasks (' + keyLabel('Mod+L') + ')', linkSel, false, false)}
        {b('unlink', 'Unlink', unlinkSel, false, false)}
        {b('timeline', 'Show on timeline', () => toggleSel('timeline'))}
      </div>
      {pal && <div className="mb-pal"><Palette value={pal === 'bg' ? f.bg : f.color} auto={pal === 'bg' ? 'No colour' : 'Automatic'} onPick={c => { applyFormat(pal === 'bg' ? { bg: c } : { color: c }); setPal(null); }} /></div>}
    </div>
  );
}

function ContextMenu() {
  const [m, setM] = useState<{ x: number; y: number; uid?: number; chart?: boolean } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setM((e as CustomEvent).detail);
    const close = () => setM(null);
    window.addEventListener('pc:menu', open);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pc:menu', open); window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); };
  }, []);
  if (!m) return null;
  const st = S();
  const t = m.uid != null ? st.p.tasks.find(x => x.uid === m.uid) : undefined;
  const item = (id: string, label?: string) => {
    const c = COMMANDS.find(x => x.id === id)!;
    const dis = c.enabled ? !c.enabled() : false;
    return <button key={id} className="cm-item" disabled={dis} onMouseDown={e => { e.stopPropagation(); }} onClick={() => { setM(null); run(id); }}><Icon name={c.icon || 'chevR'} /><span>{label || c.label}</span>{c.keys && <kbd>{keyLabel(c.keys.split(' / ')[0])}</kbd>}</button>;
  };
  const sep = (k: string) => <div key={k} className="cm-sep" />;
  const chartItems = t && m.chart ? [item('fmt.bar'), item('fmt.barStyles'), item('task.split'), sep('ch')] : [];
  const items = t ? [
    <MiniBar key="mini" close={() => setM(null)} />,
    ...chartItems,
    item('task.details'), item('insert.note'), item('insert.link', t.hyperlink ? 'Edit web link…' : undefined), ...(t.hyperlink ? [item('task.open')] : []),
    sep('a'),
    item('insert.task', 'Add task below'), item('insert.milestone', 'Add milestone'), item('insert.phase', 'Group into a phase'), item('edit.delete'),
    sep('b'),
    item('task.link'), item('task.unlink'), item('edit.fillDown'),
    sep('c'),
    t.mode === 'manual' ? item('task.auto') : item('task.pin'), item('task.active', t.active ? 'Turn task off' : 'Turn task on'), item('task.timeline', t.timeline ? 'Remove from timeline' : 'Show on timeline'),
    item('team.assign'), item('task.explain'), item('task.jump')
  ] : [item('insert.task'), item('insert.milestone'), item('insert.quick')];
  const h = items.length * 27 + 12 + (t ? 40 : 0);
  const x = Math.min(m.x, window.innerWidth - 300), y = Math.min(m.y, window.innerHeight - h - 8);
  return <div className="cmenu" style={{ left: x, top: Math.max(4, y) }} onMouseDown={e => e.stopPropagation()}>{items}</div>;
}

function Rail() {
  const view = useStore(s => s.ui.view);
  return (
    <nav className="rail" aria-label="Views">
      {VIEW_ORDER.map(([v, icon, label], i) => (
        <button key={v} className={'rail-btn' + (view === v || (v === 'gantt' && (view === 'detail' || view === 'leveling' || view === 'multiBaseline' || view === 'timeline')) ? ' on' : '')} title={VIEW_LABELS[v] + (i < 9 ? ' (' + keyLabel('Alt+' + (i + 1)) + ')' : '')} onClick={() => S().setUI({ view: v })}>
          <Icon name={icon} duo /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function StatusBar() {
  const st = useStore();
  const flt = activeFilter(st);
  const ts = st.p.gantt.timescale;
  const px = pxPerDay(ts);
  const logMin = Math.log(ZOOM_PRESETS[ZOOM_PRESETS.length - 1].px), logMax = Math.log(ZOOM_PRESETS[0].px);
  const pos = Math.round((Math.log(px) - logMin) / (logMax - logMin) * 100);
  const msg = st.painter ? 'Copy formatting: click the cells or rows to format. Esc to stop.' : st.splitMode ? 'Split task: click a bar where the work pauses. Esc to stop.' : null;
  const late = st.s.rows.filter(r => r.indicators.includes('deadline')).length;
  return (
    <div className="statusbar">
      {msg ? <span className="sb-msg">{msg}</span> : <span className="sb-stat">{st.p.tasks.length} tasks · {st.s.percent}% done · finishes {fmtDate(st.s.finish, { format: st.p.settings.dateFormat })}</span>}
      {st.s.cycle.length > 0 && <span className="sb-pill warn">Loop in links: tasks {st.s.cycle.join(', ')}</span>}
      {late > 0 && <button className="sb-pill warn" onClick={() => S().setUI({ filter: 'late', highlight: true })}>{late} past deadline</button>}
      {st.s.overallocated.size > 0 && <button className="sb-pill warn" onClick={() => S().setUI({ view: 'resourceUsage' })}>{st.s.overallocated.size} over capacity</button>}
      {flt && <button className="sb-pill" onClick={() => S().setUI({ filter: 'all', highlight: false })} title="Clear">{st.ui.highlight ? 'Highlighting' : 'Showing'}: {flt.name} ✕</button>}
      {st.ui.group && <button className="sb-pill" onClick={() => S().setUI({ group: null })} title="Remove the grouping">Grouped ✕</button>}
      {st.p.scheduleFrom === 'finish' && <span className="sb-pill">Scheduled back from the finish date</span>}
      {st.p.settings.newTaskMode === 'manual' && <button className="sb-pill" onClick={() => run('plan.newMode')} title="New tasks keep the dates you type. Click to auto-schedule new tasks.">New tasks pinned</button>}
      <span className="sp" />
      <span className="sb-save" title="Your plan is kept in this browser as you work">{st.dirty ? <><i className="dot" />Kept in this browser</> : st.fileName ? <>Saved to {st.fileName}</> : <>Kept in this browser</>}</span>
      <span className="sb-sep" />
      <button className="sb-z" onClick={() => zoomBy(-1)} title={'Zoom out (' + keyLabel('Alt+-') + ')'}>−</button>
      <input type="range" min={0} max={100} step={1} value={pos} onChange={e => setZoomPx(Math.exp(logMin + +e.target.value / 100 * (logMax - logMin)))} aria-label="Zoom" />
      <button className="sb-z" onClick={() => zoomBy(1)} title={'Zoom in (' + keyLabel('Alt+=') + ')'}>+</button>
    </div>
  );
}

function Toast() {
  const t = useStore(s => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!t) return;
    setShow(true);
    const h = setTimeout(() => setShow(false), t.err ? 7000 : 3500);
    return () => clearTimeout(h);
  }, [t]);
  if (!t || !show) return null;
  return <div className={'toast' + (t.err ? ' err' : '')} role="status" onClick={() => setShow(false)}>{t.text}</div>;
}

function DetailsPane() {
  const h = useStore(s => s.ui.detailsH);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => {
    if (drag == null) return;
    const move = (e: MouseEvent) => S().setUI({ detailsH: Math.max(140, Math.min(window.innerHeight - 260, window.innerHeight - e.clientY - 26)) });
    const up = () => setDrag(null);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [drag]);
  return (
    <div className="details" style={{ height: h }}>
      <div className="details-split" onMouseDown={e => { e.preventDefault(); setDrag(e.clientY); }} />
      <TaskForm />
    </div>
  );
}

// Keys that belong to text editing: inside a text field they do their normal job, not the command.
const TEXT_KEYS = new Set(['Mod+Z', 'Mod+Y', 'Mod+Shift+Z', 'Mod+X', 'Mod+C', 'Mod+V', 'Mod+A', 'Delete', 'Mod+B', 'Mod+I', 'Mod+U', 'Mod+D', 'Mod+]', 'Mod+[', 'Mod+Enter', 'Alt+Enter', 'Mod+Shift+↑', 'Mod+Shift+↓', 'Mod+H', 'Mod+F', 'Mod+G', 'Mod+L', 'Mod+Shift+L', 'Mod+\\', 'Mod+Shift+X']);
// Keys the table handles itself (it knows the active cell).
const GRID_KEYS = new Set(['Mod+X', 'Mod+C', 'Mod+V', 'Mod+A', 'Delete']);

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  const inField = !!el.closest?.('input, textarea, select, [contenteditable="true"]');
  if (S().dialog && !/^(F1)$/.test(e.key)) return;   // dialogs handle their own keys
  if (e.key === 'Escape') {
    const st = S();
    if (st.ui.help) st.setUI({ help: null });
    else if (st.ui.home) st.setUI({ home: null });
    else if (st.painter || st.splitMode) st.set({ painter: null, splitMode: false });
    return;
  }
  if (e.key === '?' && !inField && !e.ctrlKey && !e.metaKey) { e.preventDefault(); run('help.keys'); return; }
  const keys = eventKeys(e);
  const c = commandForKeys(keys);
  if (!c) return;
  if (inField && TEXT_KEYS.has(keys)) return;
  if (GRID_KEYS.has(keys)) return;
  e.preventDefault();
  if (!c.enabled || c.enabled()) c.run();
}

// Files dropped anywhere on the window are opened.
function useDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const has = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => { if (has(e)) { e.preventDefault(); setOver(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setOver(false); };
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); setOver(false); const f = e.dataTransfer!.files[0]; if (f) readDroppedFile(f); };
    window.addEventListener('dragover', enter); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);
  return over;
}

function PlanName() {
  const name = useStore(s => s.p.name);
  const [v, setV] = useState<string | null>(null);
  const save = () => { const n = (v ?? '').trim(); if (n && n !== name) S().commit({ ...S().p, name: n }); setV(null); };
  return v == null
    ? <button className="tt-name" title="Rename the plan" onClick={() => setV(name)}>{name}</button>
    : <input className="tt-name edit" autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setV(null); }} />;
}

export default function App() {
  const st = useStore();
  const ui = st.ui;
  const dropping = useDrop();
  useEffect(() => { document.documentElement.dataset.theme = ui.theme; }, [ui.theme]);
  useEffect(() => { document.title = st.p.name + ' – Cairn'; }, [st.p.name]);
  useEffect(() => {
    const zoom = (e: Event) => zoomBy((e as CustomEvent).detail);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pc:zoom', zoom);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pc:zoom', zoom); };
  }, []);
  const v = ui.view;
  const ganttish = GANTT_VIEWS.has(v);
  const taskish = ganttish || v === 'taskSheet' || v === 'taskUsage' || v === 'calendar' || v === 'network' || v === 'teamPlanner';
  return (
    <div className={'app' + (st.painter ? ' painting' : '')}>
      <header className="titlebar">
        <button className="tt-logo" title="Your plans" onClick={() => S().setUI({ home: 'open' })}><img src={iconUrl} alt="Cairn" width={30} height={30} /></button>
        <div className="tt-main">
          <div className="tt-row"><PlanName /><span className="tt-file">{st.fileName ? st.fileName : ''}</span></div>
          <MenuBar />
        </div>
        <span className="sp" />
        <button className="tt-search" onClick={() => run('help.palette')} title="Search commands and tasks"><Icon name="find" /><span>Search or run a command</span><kbd>{keyLabel('Mod+K')}</kbd></button>
        <button className="tt-btn" title={'Save (' + keyLabel('Mod+S') + ')'} onClick={() => saveFile(false)}><Icon name="save" /></button>
        <button className="tt-btn" title={ui.theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => run('view.theme')}><Icon name={ui.theme === 'dark' ? 'sun' : 'moon'} /></button>
        <button className="tt-btn" title="Help and shortcuts (F1)" onClick={() => run('help.guide')}><Icon name="help" /></button>
      </header>
      {ui.toolbar && <Toolbar />}
      <div className="workspace">
        <Rail />
        <div className="main">
          {ui.timeline && ganttish && <Timeline />}
          <div className="viewbody">
            {ganttish && <TaskView />}
            {v === 'taskSheet' && <TaskView sheetOnly />}
            {v === 'taskUsage' && <TaskUsage />}
            {v === 'network' && <NetworkDiagram />}
            {v === 'calendar' && <CalendarView />}
            {v === 'timeline' && <Timeline big />}
            {v === 'resourceSheet' && <ResourceSheet />}
            {v === 'resourceUsage' && <ResourceUsage />}
            {v === 'resourceGraph' && <ResourceGraph />}
            {v === 'teamPlanner' && <TeamPlanner />}
            {v === 'reports' && <Reports />}
          </div>
          {ui.details && v !== 'reports' && <DetailsPane />}
        </div>
        {ui.inspector && taskish && <Inspector />}
      </div>
      <StatusBar />
      {ui.home && <Home />}
      <Help />
      <ContextMenu />
      <DialogHost />
      <CommandPalette />
      <QuickAdd />
      {dropping && <div className="dropzone"><Icon name="upload" size={40} /><b>Drop to open</b><span>Cairn plans, project XML, Primavera XER, MPX, Excel or CSV</span></div>}
      <Toast />
    </div>
  );
}

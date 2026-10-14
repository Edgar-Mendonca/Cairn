// Every command in Cairn, defined once. The menu bar, toolbar, command palette (Ctrl+K), right-click menus,
// keyboard shortcuts and the shortcut sheet all read from this list, so a command has one name, one icon
// and one shortcut everywhere.
import { S, TABLES, VIEW_LABELS, newBlank, type TableName, type ViewName } from './store';
import {
  activeFormat, applyFormat, clearFormat, copyRows, deleteSelected, exportFile, fillDown, fitEntireProject, fitSelected,
  indentSel, insertMilestone, insertSummary, insertTask, linkSel, modeSel, moveSel, onTrackSel, openFile, openHyperlink,
  percentSel, pickPainter, respectLinks, saveFile, scrollToTask, splitModeOn, toggleSel, unlinkSel, zoomBy, zoomToPreset
} from './actions';
import { updateTask } from '../engine/ops';
import { clearLeveling, levelResources } from '../engine/level';
import { atDay, dayOf } from '../engine/time';
import { stylesFor } from '../engine/gantt';

export interface Command {
  id: string;
  label: string;           // as shown in menus and the palette
  icon?: string;
  keys?: string;           // shortcut, written with Mod for Ctrl (⌘ on a Mac): "Mod+Shift+L"
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
  section: string;         // palette grouping and the shortcut sheet
  hint?: string;           // one line shown in the palette and tooltips
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Shortcut text for display: "Mod+Shift+L" → "Ctrl+Shift+L" (or "⌘⇧L" on a Mac).
export function keyLabel(keys?: string): string {
  if (!keys) return '';
  if (!isMac) return keys.replace(/Mod/g, 'Ctrl');
  return keys.split(' / ').map(k => k.replace(/Mod\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥').replace(/Ctrl\+/g, '⌃')).join(' / ');
}

const one = () => S().sel.length > 0;
const two = () => S().sel.length > 1;
const dlg = (type: string, props?: object) => () => S().open(type, props);
const forSel = (type: string, extra?: object) => () => { const u = S().sel[0]; if (u) S().open(type, { uid: u, ...extra }); else S().notify('Select a task first.'); };
const view = (v: ViewName) => () => S().setUI({ view: v });
const toggleUI = (k: 'timeline' | 'critical' | 'slack' | 'lateTasks' | 'baselineBars' | 'outlineNumber' | 'projectSummary' | 'inspector') => () => S().setUI({ [k]: !S().ui[k] });

export function openInspector(focus?: string) {
  if (!S().sel.length) { S().notify('Select a task to see its details.'); return; }
  S().setUI({ inspector: true });
  if (focus) setTimeout(() => window.dispatchEvent(new CustomEvent('cairn:inspector', { detail: focus })), 30);
}

export function moveSelected(days: number) {
  const st = S();
  if (!st.sel.length) { st.notify('Select one or more tasks first.'); return; }
  let p = st.p;
  st.sel.forEach(u => {
    const r = st.s.byUid.get(u);
    if (!r || r.summary) return;
    const ns = atDay(dayOf(r.start) + days, st.p.settings.defaultStart);
    const c = st.s.calendars.get(r.task.calendar, st.p.calendar).nextWorkStart(ns);
    p = r.task.mode === 'manual' ? updateTask(p, u, { start: c }) : updateTask(p, u, { constraint: 'SNET', constraintDate: c });
  });
  st.commit(p);
}

export function clearSel(what: 'hyperlink' | 'notes' | 'splits' | 'constraint') {
  const st = S();
  const set = new Set(st.sel);
  st.commit({ ...st.p, tasks: st.p.tasks.map(t => {
    if (!set.has(t.uid)) return t;
    if (what === 'hyperlink') { const { hyperlink: _h, ...r } = t; return r; }
    if (what === 'notes') return { ...t, notes: '', notesHtml: undefined };
    if (what === 'splits') { const { splits: _s, ...r } = t; return r; }
    return { ...t, constraint: 'ASAP' as const, constraintDate: null };
  }) });
}

export function balance(uids?: number[]) {
  const st = S();
  const r = levelResources(st.p, uids && uids.length ? { uids } : {});
  st.commit(r.p);
  st.notify(r.unresolved.length
    ? 'Balancing moved ' + r.moved + ' task(s). Still over capacity: ' + r.unresolved.join(', ') + ' (assigned above their capacity, or tasks that cannot move).'
    : r.moved ? 'Balancing moved ' + r.moved + ' task(s). Nobody is over capacity now.' : 'Nobody is over capacity.', r.unresolved.length > 0);
}

export function nextOverload() {
  const st = S();
  const after = st.sel.length ? (st.s.byUid.get(st.sel[0])?.start ?? -Infinity) : -Infinity;
  const hit = st.s.rows.filter(r => r.indicators.includes('overallocated') && !r.summary).sort((a, b) => a.start - b.start).find(r => r.start > after) || st.s.rows.find(r => r.indicators.includes('overallocated'));
  if (!hit) { st.notify('No task has anyone over capacity.'); return; }
  st.set({ sel: [hit.task.uid] });
  setTimeout(scrollToTask, 0);
}

export function addDrawing(kind: 'text' | 'rect' | 'oval' | 'line' | 'arrow') {
  const s2 = S();
  const r = s2.sel.length ? s2.s.byUid.get(s2.sel[0]) : s2.s.rows[0];
  const id = Math.max(0, ...s2.p.gantt.drawings.map(d => d.id)) + 1;
  const line = kind === 'line' || kind === 'arrow';
  const d = { id, kind, at: r ? r.finish : s2.s.start, row: 0, uid: r?.task.uid, dx: 24, dy: line ? 12 : -4, w: line ? 80 : 150, h: line ? 0 : 32, text: kind === 'text' ? 'Text box' : '', color: '#22303c', fill: kind === 'text' ? '#fff6d8' : kind === 'rect' || kind === 'oval' ? '#e7eef6' : '#ffffff' };
  s2.commit({ ...s2.p, gantt: { ...s2.p.gantt, drawings: s2.p.gantt.drawings.concat(d) } });
  s2.notify(kind === 'text' ? 'Text box added beside the selected task. Double-click to edit, drag to move, right-click to delete.' : 'Shape added. Drag to move, right-click to delete.');
}

export function applySavedView(id: string) {
  const v = S().p.views.find(x => x.id === id);
  if (!v) return;
  S().setUI({ view: v.screen as ViewName, table: (v.table in TABLES ? v.table : 'entry') as TableName, filter: v.filter || 'all', group: v.group || null, highlight: v.highlight, filterArgs: [] });
}

export const SORTS: [string, string][] = [['id', 'Row order'], ['start', 'Start date'], ['finish', 'Finish date'], ['priority', 'Priority'], ['cost', 'Cost'], ['name', 'Name'], ['duration', 'Duration'], ['totalSlack', 'Total float']];

export const SCHEMES: [string, string, string, string][] = [
  ['fjord', '#4f7fb4', '#d64545', '#2c3a47'], ['glacier', '#3a9fb5', '#e0603f', '#1f3a4d'], ['moss', '#6a9a5b', '#c94a43', '#2c3b2a'], ['ochre', '#d99a2b', '#b8433b', '#45331c'],
  ['heather', '#8a74c9', '#cf5878', '#2f2645'], ['granite', '#8693a1', '#c95a52', '#2b3138'], ['clay', '#d9805f', '#a83c3c', '#3d2826'], ['ink', '#9aa3ae', '#444c56', '#1f2328']
];
// Recolours the task, critical and summary bars of the current Gantt view.
export function applyScheme(viewName: string, [, task, crit, sum]: [string, string, string, string]) {
  const st = S();
  const styles = stylesFor(st.p.gantt, viewName).map(s0 => {
    const s = { ...s0 };
    if (/^(Task|Rolled Up Task)$/.test(s.name)) s.color = task;
    if (s.name === 'Critical') s.color = crit;
    if (s.name === 'Progress') s.color = sum;
    if (/Summary/.test(s.name) && !/Project|Group|Baseline|Manual|Inactive/.test(s.name)) { s.color = sum; s.startColor = sum; s.endColor = sum; }
    if (s.name === 'Milestone') s.endColor = sum;
    return s;
  });
  st.commit({ ...st.p, gantt: { ...st.p.gantt, styles: { ...st.p.gantt.styles, [viewName]: styles } } });
}

function fmtToggle(k: 'b' | 'i' | 'u' | 's') { const f = activeFormat(S()); applyFormat({ [k]: !f[k] }); }
const canFormat = () => S().sel.length > 0 || !!S().colSel;

// The list itself. Sections follow the menu bar.
export const COMMANDS: Command[] = [
  // File
  { id: 'file.new', section: 'File', label: 'New plan…', icon: 'plus', keys: 'Mod+Alt+N', run: () => S().setUI({ home: 'new' }) },
  { id: 'file.blank', section: 'File', label: 'New blank plan', icon: 'plus', run: newBlank },
  { id: 'file.open', section: 'File', label: 'Open…', icon: 'folder', keys: 'Mod+O', run: openFile, hint: 'Cairn plans, project XML, Primavera XER, MPX, CSV or Excel' },
  { id: 'file.recent', section: 'File', label: 'Plans in this browser', icon: 'clock', run: () => S().setUI({ home: 'open' }) },
  { id: 'file.save', section: 'File', label: 'Save', icon: 'save', keys: 'Mod+S', run: () => saveFile(false), hint: 'Save a .cairn file' },
  { id: 'file.saveAs', section: 'File', label: 'Save as…', icon: 'save', keys: 'Mod+Shift+S', run: () => saveFile(true) },
  { id: 'file.import', section: 'File', label: 'Import…', icon: 'upload', run: () => S().open('importFile'), hint: 'Bring in a plan or a task list from another tool' },
  { id: 'file.export', section: 'File', label: 'Export…', icon: 'download', run: () => S().open('exportFile') },
  { id: 'file.exportXml', section: 'File', label: 'Export as project XML', icon: 'file', run: () => exportFile('xml') },
  { id: 'file.exportXer', section: 'File', label: 'Export as Primavera XER', icon: 'file', run: () => exportFile('xer') },
  { id: 'file.exportXlsx', section: 'File', label: 'Export to Excel', icon: 'table', run: () => exportFile('xlsx') },
  { id: 'file.exportCsv', section: 'File', label: 'Export to CSV', icon: 'table', run: () => exportFile('csv') },
  { id: 'file.exportIcs', section: 'File', label: 'Export milestones to a calendar (.ics)', icon: 'calendar', run: () => exportFile('ics') },
  { id: 'file.picture', section: 'File', label: 'Copy view as image…', icon: 'picture', run: dlg('copyPicture') },
  { id: 'file.print', section: 'File', label: 'Print or save as PDF…', icon: 'printer', keys: 'Mod+P', run: () => S().setUI({ home: 'print' }) },
  { id: 'file.settings', section: 'File', label: 'Plan settings…', icon: 'project', run: dlg('projectInfo'), hint: 'Name, start date, calendar and scheduling direction' },
  { id: 'file.prefs', section: 'File', label: 'Preferences…', icon: 'options', keys: 'Mod+,', run: dlg('options') },

  // Edit
  { id: 'edit.undo', section: 'Edit', label: 'Undo', icon: 'undo', keys: 'Mod+Z', run: () => S().undoAct(), enabled: () => S().undo.length > 0 },
  { id: 'edit.redo', section: 'Edit', label: 'Redo', icon: 'redo', keys: 'Mod+Y / Mod+Shift+Z', run: () => S().redoAct(), enabled: () => S().redo.length > 0 },
  { id: 'edit.cut', section: 'Edit', label: 'Cut', icon: 'cut', keys: 'Mod+X', run: () => copyRows(true), enabled: one },
  { id: 'edit.copy', section: 'Edit', label: 'Copy', icon: 'copy', keys: 'Mod+C', run: () => copyRows(false), enabled: one },
  { id: 'edit.paste', section: 'Edit', label: 'Paste', icon: 'paste', keys: 'Mod+V', run: () => S().notify('Click a cell, then press Ctrl+V to paste rows copied from Cairn or a spreadsheet.') },
  { id: 'edit.fillDown', section: 'Edit', label: 'Fill down', icon: 'fill', keys: 'Mod+D', run: fillDown, enabled: two },
  { id: 'edit.delete', section: 'Edit', label: 'Delete tasks', icon: 'trash', keys: 'Delete', run: deleteSelected, enabled: one },
  { id: 'edit.selectAll', section: 'Edit', label: 'Select all tasks', icon: 'check', keys: 'Mod+A', run: () => S().set({ sel: S().s.rows.map(r => r.task.uid), selMode: 'rows' }) },
  { id: 'edit.find', section: 'Edit', label: 'Find…', icon: 'find', keys: 'Mod+F', run: dlg('find') },
  { id: 'edit.replace', section: 'Edit', label: 'Find and replace…', icon: 'replace', keys: 'Mod+H', run: dlg('find', { replace: true }) },
  { id: 'edit.goto', section: 'Edit', label: 'Go to task or date…', icon: 'goto', keys: 'Mod+G', run: dlg('goto') },
  { id: 'edit.copyFormat', section: 'Edit', label: 'Copy formatting', icon: 'painter', keys: 'Mod+Alt+C', run: () => pickPainter(), enabled: () => one() || !!S().painter, checked: () => !!S().painter, hint: 'Then click the cells or rows to format' },
  { id: 'edit.clearFormat', section: 'Edit', label: 'Clear formatting', icon: 'clear', keys: 'Mod+\\', run: clearFormat, enabled: one },
  { id: 'edit.clearLinks', section: 'Edit', label: 'Remove web links', run: () => clearSel('hyperlink'), enabled: one },
  { id: 'edit.clearNotes', section: 'Edit', label: 'Remove notes', run: () => clearSel('notes'), enabled: one },
  { id: 'edit.clearSplits', section: 'Edit', label: 'Join split tasks', run: () => clearSel('splits'), enabled: one },
  { id: 'edit.clearConstraints', section: 'Edit', label: 'Remove date constraints', run: () => clearSel('constraint'), enabled: one },

  // Insert
  { id: 'insert.task', section: 'Insert', label: 'Task', icon: 'task', keys: 'Mod+Enter', run: () => insertTask({}, 'New task'), hint: 'Adds a task below the selection' },
  { id: 'insert.milestone', section: 'Insert', label: 'Milestone', icon: 'milestone', keys: 'Mod+Shift+Enter', run: insertMilestone },
  { id: 'insert.phase', section: 'Insert', label: 'Phase (group the selected tasks)', icon: 'summary', keys: 'Mod+Alt+G', run: insertSummary },
  { id: 'insert.repeating', section: 'Insert', label: 'Repeating task…', icon: 'recur', run: dlg('recurring') },
  { id: 'insert.blank', section: 'Insert', label: 'Blank row', icon: 'rowheight', run: () => insertTask({}, '') },
  { id: 'insert.quick', section: 'Insert', label: 'Quick add…', icon: 'sparkle', keys: 'Mod+J', run: () => window.dispatchEvent(new CustomEvent('cairn:quickadd')), hint: 'Type “Pour slab 5d after 4 @Crew” to add a task in one line' },
  { id: 'insert.column', section: 'Insert', label: 'Column…', icon: 'addcol', run: () => window.dispatchEvent(new CustomEvent('pc:insertcolumn', { detail: S().colSel || S().cell?.col || 'name' })) },
  { id: 'insert.link', section: 'Insert', label: 'Web link…', icon: 'hyperlink', keys: 'Mod+Shift+K', run: forSel('hyperlink'), enabled: one },
  { id: 'insert.note', section: 'Insert', label: 'Note…', icon: 'note', keys: 'Mod+Alt+M', run: forSel('notes'), enabled: one },
  { id: 'insert.person', section: 'Insert', label: 'Person or resource…', icon: 'addres', run: dlg('resource', { create: 'Work' }) },
  { id: 'insert.material', section: 'Insert', label: 'Material…', icon: 'layers', run: dlg('resource', { create: 'Material' }) },
  { id: 'insert.costItem', section: 'Insert', label: 'Cost item…', icon: 'costs', run: dlg('resource', { create: 'Cost' }) },
  { id: 'insert.text', section: 'Insert', label: 'Text box on the chart', icon: 'drawing', run: () => addDrawing('text') },
  { id: 'insert.rect', section: 'Insert', label: 'Rectangle on the chart', run: () => addDrawing('rect') },
  { id: 'insert.arrow', section: 'Insert', label: 'Arrow on the chart', run: () => addDrawing('arrow') },

  // Task
  { id: 'task.details', section: 'Task', label: 'Task details', icon: 'info', keys: 'Alt+Enter', run: () => (S().ui.inspector && S().sel.length ? S().setUI({ inspector: false }) : openInspector()), checked: () => S().ui.inspector, hint: 'Show the details panel for the selected task' },
  { id: 'task.indent', section: 'Task', label: 'Indent', icon: 'indent', keys: 'Mod+]', run: () => indentSel(1), enabled: one },
  { id: 'task.outdent', section: 'Task', label: 'Outdent', icon: 'outdent', keys: 'Mod+[', run: () => indentSel(-1), enabled: one },
  { id: 'task.moveUp', section: 'Task', label: 'Move up', icon: 'up', keys: 'Mod+Shift+↑', run: () => moveSel(-1), enabled: one },
  { id: 'task.moveDown', section: 'Task', label: 'Move down', icon: 'down', keys: 'Mod+Shift+↓', run: () => moveSel(1), enabled: one },
  { id: 'task.link', section: 'Task', label: 'Link tasks', icon: 'link', keys: 'Mod+L', run: linkSel, enabled: two, hint: 'Each selected task starts after the one before it' },
  { id: 'task.unlink', section: 'Task', label: 'Unlink tasks', icon: 'unlink', keys: 'Mod+Shift+L', run: unlinkSel, enabled: one },
  { id: 'task.split', section: 'Task', label: 'Split task', icon: 'split', run: splitModeOn, checked: () => S().splitMode, hint: 'Click a bar where the work pauses' },
  { id: 'task.auto', section: 'Task', label: 'Auto-schedule', icon: 'auto', run: () => modeSel('auto'), enabled: one, hint: 'Dates follow links, constraints and calendars' },
  { id: 'task.pin', section: 'Task', label: 'Pin dates', icon: 'pin', run: () => modeSel('manual'), enabled: one, hint: 'Dates stay where you put them' },
  { id: 'task.snap', section: 'Task', label: 'Snap to links', icon: 'respect', run: respectLinks, enabled: one, hint: 'Move the selected tasks to the dates their links allow' },
  { id: 'task.active', section: 'Task', label: 'Turn task off', icon: 'inactive', run: () => toggleSel('active'), enabled: one, hint: 'Keep the task but leave it out of dates and totals' },
  { id: 'task.timeline', section: 'Task', label: 'Show on timeline', icon: 'timeline', run: () => toggleSel('timeline'), enabled: one },
  { id: 'task.explain', section: 'Task', label: 'Why these dates?', icon: 'inspect', run: forSel('inspect'), enabled: one, hint: 'What drives the selected task, and how to fix warnings' },
  { id: 'task.shift', section: 'Task', label: 'Shift dates…', icon: 'move', run: dlg('move'), enabled: one },
  { id: 'task.jump', section: 'Task', label: 'Show task on the chart', icon: 'scroll', keys: 'Alt+J', run: scrollToTask, enabled: one },
  { id: 'task.open', section: 'Task', label: 'Open web link', icon: 'goto', run: () => { const u = S().sel[0]; if (u) openHyperlink(u); }, enabled: () => !!S().p.tasks.find(t => t.uid === S().sel[0])?.hyperlink },

  // Progress
  { id: 'track.0', section: 'Progress', label: 'Not started (0%)', icon: 'pct0', run: () => percentSel(0), enabled: one },
  { id: 'track.25', section: 'Progress', label: '25% done', icon: 'pct25', run: () => percentSel(25), enabled: one },
  { id: 'track.50', section: 'Progress', label: '50% done', icon: 'pct50', run: () => percentSel(50), enabled: one },
  { id: 'track.75', section: 'Progress', label: '75% done', icon: 'pct75', run: () => percentSel(75), enabled: one },
  { id: 'track.100', section: 'Progress', label: 'Done (100%)', icon: 'check', keys: 'Mod+Shift+D', run: () => percentSel(100), enabled: one },
  { id: 'track.uptoDate', section: 'Progress', label: 'Mark as on schedule', icon: 'check', run: onTrackSel, enabled: one, hint: 'Record progress as planned up to today' },
  { id: 'track.update', section: 'Progress', label: 'Record progress…', icon: 'updatetasks', run: dlg('updateTasks'), enabled: one, hint: 'Actual dates, % done and remaining work' },
  { id: 'track.updatePlan', section: 'Progress', label: 'Update the whole plan to a date…', icon: 'update', run: dlg('updateProject') },
  { id: 'track.statusDate', section: 'Progress', label: 'Status date…', icon: 'status', run: dlg('statusDate') },
  { id: 'track.baseline', section: 'Progress', label: 'Save baseline…', icon: 'baseline', run: dlg('baseline'), hint: 'Keep today’s plan to compare progress against' },
  { id: 'track.clearBaseline', section: 'Progress', label: 'Clear baseline…', run: dlg('baseline', { clear: true }) },
  { id: 'track.snapshot', section: 'Progress', label: 'Save date snapshot…', icon: 'interim', run: dlg('baseline', { interim: true }) },
  { id: 'track.progressLines', section: 'Progress', label: 'Progress lines…', icon: 'progressline', run: dlg('progressLines') },

  // Schedule (plan-wide)
  { id: 'plan.calendar', section: 'Schedule', label: 'Working days and holidays…', icon: 'calendar', run: dlg('workingTime') },
  { id: 'plan.shift', section: 'Schedule', label: 'Move the whole plan…', icon: 'move', run: dlg('moveProject') },
  { id: 'plan.wbs', section: 'Schedule', label: 'WBS numbering…', icon: 'wbs', run: dlg('wbsCode') },
  { id: 'plan.renumber', section: 'Schedule', label: 'Renumber WBS…', run: dlg('wbsCode', { renumber: true }) },
  { id: 'plan.fields', section: 'Schedule', label: 'Custom fields…', icon: 'custom', run: dlg('customFields') },
  { id: 'plan.summary', section: 'Schedule', label: 'Plan summary', icon: 'report', run: dlg('stats') },
  { id: 'plan.newMode', section: 'Schedule', label: 'Pin dates of new tasks', icon: 'pin', run: () => { const p = S().p; S().commit({ ...p, settings: { ...p.settings, newTaskMode: p.settings.newTaskMode === 'manual' ? 'auto' : 'manual' } }); }, checked: () => S().p.settings.newTaskMode === 'manual' },

  // People
  { id: 'team.assign', section: 'People', label: 'Assign people…', icon: 'assign', keys: 'Mod+Shift+A', run: () => { if (S().sel.length) S().open('assign'); else S().notify('Select one or more tasks first.'); } },
  { id: 'team.assignment', section: 'People', label: 'Assignment details…', icon: 'assigninfo', run: forSel('assignmentInfo'), enabled: one },
  { id: 'team.balance', section: 'People', label: 'Balance workload', icon: 'level', run: () => balance(), hint: 'Delay tasks so nobody has more work than their capacity' },
  { id: 'team.balanceSel', section: 'People', label: 'Balance selected tasks', icon: 'level', run: () => balance(S().sel), enabled: one },
  { id: 'team.balanceOne', section: 'People', label: 'Balance one person…', run: dlg('levelResource') },
  { id: 'team.unbalance', section: 'People', label: 'Undo balancing delays', icon: 'clear', run: () => { S().commit(clearLeveling(S().p)); S().notify('Balancing delays removed'); } },
  { id: 'team.balanceOpts', section: 'People', label: 'Balancing options…', icon: 'levelopts', run: dlg('levelingOptions') },
  { id: 'team.nextOverload', section: 'People', label: 'Next over-capacity task', icon: 'goto', run: nextOverload },

  // Format
  { id: 'fmt.bold', section: 'Format', label: 'Bold', icon: 'bold', keys: 'Mod+B', run: () => fmtToggle('b'), enabled: canFormat, checked: () => !!activeFormat(S()).b },
  { id: 'fmt.italic', section: 'Format', label: 'Italic', icon: 'italic', keys: 'Mod+I', run: () => fmtToggle('i'), enabled: canFormat, checked: () => !!activeFormat(S()).i },
  { id: 'fmt.underline', section: 'Format', label: 'Underline', icon: 'underline', keys: 'Mod+U', run: () => fmtToggle('u'), enabled: canFormat, checked: () => !!activeFormat(S()).u },
  { id: 'fmt.strike', section: 'Format', label: 'Strikethrough', icon: 'strike', keys: 'Mod+Shift+X', run: () => fmtToggle('s'), enabled: canFormat, checked: () => !!activeFormat(S()).s },
  { id: 'fmt.font', section: 'Format', label: 'Text…', icon: 'font', run: dlg('font'), hint: 'Font, size, style and colour of the selection' },
  { id: 'fmt.styles', section: 'Format', label: 'Text styles…', icon: 'textstyles', run: dlg('textStyles'), hint: 'Text of every task of one kind: phases, critical, milestones…' },
  { id: 'fmt.bar', section: 'Format', label: 'Bar appearance…', icon: 'barcolor', run: forSel('formatBar'), enabled: one },
  { id: 'fmt.barStyles', section: 'Format', label: 'Bar styles…', icon: 'barstyles', run: dlg('barStyles') },
  { id: 'fmt.layout', section: 'Format', label: 'Chart layout…', icon: 'layout', run: dlg('layout'), hint: 'Link lines, bar height, rounding, dates' },
  { id: 'fmt.gridlines', section: 'Format', label: 'Gridlines…', icon: 'gridlines', run: dlg('gridlines') },
  { id: 'fmt.timescale', section: 'Format', label: 'Timescale…', icon: 'timescale', run: dlg('timescale') },
  { id: 'fmt.columns', section: 'Format', label: 'Columns…', icon: 'columns', run: dlg('columns') },
  { id: 'fmt.field', section: 'Format', label: 'Column settings…', icon: 'settings', run: () => S().open('fieldSettings', { field: S().colSel || S().cell?.col || 'name' }) },

  // View
  { id: 'view.critical', section: 'View', label: 'Critical path', icon: 'critical', keys: 'Alt+C', run: toggleUI('critical'), checked: () => S().ui.critical, hint: 'Highlight the tasks that set the finish date' },
  { id: 'view.float', section: 'View', label: 'Float bars', icon: 'slack', run: toggleUI('slack'), checked: () => S().ui.slack },
  { id: 'view.late', section: 'View', label: 'Late tasks', icon: 'clock', run: toggleUI('lateTasks'), checked: () => S().ui.lateTasks },
  { id: 'view.baseline', section: 'View', label: 'Baseline bars', icon: 'baseline', run: toggleUI('baselineBars'), checked: () => S().ui.baselineBars },
  { id: 'view.timelineStrip', section: 'View', label: 'Timeline strip', icon: 'timeline', run: toggleUI('timeline'), checked: () => S().ui.timeline },
  { id: 'view.inspector', section: 'View', label: 'Details panel', icon: 'panel', keys: 'Mod+Alt+I', run: toggleUI('inspector'), checked: () => S().ui.inspector },
  { id: 'view.wbs', section: 'View', label: 'Outline numbers', icon: 'outline', run: toggleUI('outlineNumber'), checked: () => S().ui.outlineNumber },
  { id: 'view.planRow', section: 'View', label: 'Plan total row', icon: 'summary', run: toggleUI('projectSummary'), checked: () => S().ui.projectSummary },
  { id: 'view.zoomIn', section: 'View', label: 'Zoom in', icon: 'zoomin', keys: 'Alt+=', run: () => zoomBy(1) },
  { id: 'view.zoomOut', section: 'View', label: 'Zoom out', icon: 'zoomout', keys: 'Alt+-', run: () => zoomBy(-1) },
  { id: 'view.fit', section: 'View', label: 'Fit whole plan', icon: 'entire', keys: 'Alt+0', run: fitEntireProject },
  { id: 'view.fitSel', section: 'View', label: 'Fit selected tasks', icon: 'zoomsel', run: fitSelected, enabled: one },
  { id: 'view.days', section: 'View', label: 'Zoom to days', run: () => zoomToPreset(2) },
  { id: 'view.weeks', section: 'View', label: 'Zoom to weeks', run: () => zoomToPreset(4) },
  { id: 'view.months', section: 'View', label: 'Zoom to months', run: () => zoomToPreset(6) },
  { id: 'view.sort', section: 'View', label: 'Sort…', icon: 'sort', run: dlg('sort') },
  { id: 'view.filters', section: 'View', label: 'Filters…', icon: 'filter', run: dlg('moreFilters') },
  { id: 'view.newFilter', section: 'View', label: 'New filter…', icon: 'filter', run: dlg('filterEditor', {}) },
  { id: 'view.clearFilter', section: 'View', label: 'Clear filter', icon: 'filter', run: () => S().setUI({ filter: 'all', highlight: false, autoFilter: {} }), enabled: () => S().ui.filter !== 'all' },
  { id: 'view.groups', section: 'View', label: 'Groups…', icon: 'groupby', run: dlg('moreGroups') },
  { id: 'view.clearGroup', section: 'View', label: 'Clear grouping', icon: 'groupby', run: () => S().setUI({ group: null }), enabled: () => !!S().ui.group },
  { id: 'view.saveView', section: 'View', label: 'Save this view…', icon: 'save', run: dlg('saveView') },
  { id: 'view.theme', section: 'View', label: 'Dark theme', icon: 'moon', keys: 'Mod+Alt+D', run: () => S().setUI({ theme: S().ui.theme === 'dark' ? 'light' : 'dark' }), checked: () => S().ui.theme === 'dark' },

  // Help
  { id: 'help.palette', section: 'Help', label: 'Search commands and tasks', icon: 'find', keys: 'Mod+K', run: () => window.dispatchEvent(new CustomEvent('cairn:palette')) },
  { id: 'help.guide', section: 'Help', label: 'Getting started guide', icon: 'book', keys: 'F1', run: () => S().setUI({ help: 'start' }) },
  { id: 'help.keys', section: 'Help', label: 'Keyboard shortcuts', icon: 'keyboard', keys: '?', run: () => S().setUI({ help: 'keys' }) },
  { id: 'help.formats', section: 'Help', label: 'Importing from other tools', icon: 'upload', run: () => S().setUI({ help: 'import' }) },
  { id: 'help.about', section: 'Help', label: 'About Cairn', icon: 'cairn', run: () => S().setUI({ help: 'about' }) }
];

// Views, in rail order; Alt+1 … Alt+9 switch to the first nine.
export const VIEW_ORDER: [ViewName, string, string][] = [
  ['gantt', 'gantt', 'Gantt'], ['tracking', 'tracking', 'Progress'], ['taskSheet', 'sheet', 'List'], ['calendar', 'calendarview', 'Calendar'],
  ['network', 'network', 'Flow'], ['teamPlanner', 'team', 'Team'], ['resourceSheet', 'resources', 'People'], ['resourceUsage', 'availability', 'Workload'],
  ['resourceGraph', 'graph', 'Capacity'], ['taskUsage', 'usage', 'Task hours'], ['reports', 'dashboard', 'Reports']
];
VIEW_ORDER.forEach(([v, icon], i) => COMMANDS.push({ id: 'view.' + v, section: 'Views', label: VIEW_LABELS[v], icon, keys: i < 9 ? 'Alt+' + (i + 1) : undefined, run: view(v), checked: () => S().ui.view === v }));
(['detail', 'leveling', 'multiBaseline', 'timeline'] as ViewName[]).forEach(v => COMMANDS.push({ id: 'view.' + v, section: 'Views', label: VIEW_LABELS[v], icon: v === 'timeline' ? 'timeline' : 'gantt', run: view(v), checked: () => S().ui.view === v }));

const BY_ID = new Map(COMMANDS.map(c => [c.id, c]));
export const cmd = (id: string): Command => {
  const c = BY_ID.get(id);
  if (!c) throw new Error('Unknown command ' + id);
  return c;
};
export const run = (id: string) => { const c = cmd(id); if (!c.enabled || c.enabled()) c.run(); };

// Keyboard: turns a key event into the "Mod+Shift+K" form used above.
export function eventKeys(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !(e.key === '?' )) parts.push('Shift');
  let k = e.key;
  if (e.altKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);                // Alt+1 on layouts where Alt changes the character
  else if (e.altKey && e.code === 'Equal') k = '=';
  else if (e.altKey && e.code === 'Minus') k = '-';
  else if (/^Key[A-Z]$/.test(e.code) && (e.ctrlKey || e.metaKey || e.altKey)) k = e.code.slice(3);
  const names: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space', Del: 'Delete', '+': '=' };
  k = names[k] || (k.length === 1 ? k.toUpperCase() : k);
  if (k === '}' ) k = ']'; if (k === '{') k = '[';
  parts.push(k);
  return parts.join('+');
}

const KEYMAP = new Map<string, Command>();
COMMANDS.forEach(c => c.keys?.split(' / ').forEach(k => KEYMAP.set(k.replace(/\+([a-z])$/, (_m, ch: string) => '+' + ch.toUpperCase()), c)));
export const commandForKeys = (keys: string) => KEYMAP.get(keys);

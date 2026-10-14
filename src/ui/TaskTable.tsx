// The task table (left side of the Gantt views, and the Task Sheet): in-cell editing, keyboard control,
// fonts and cell formatting, dragging rows to move them and row edges to change their height, column
// customisation (insert, hide, move, resize, wrap, Field Settings), AutoFilter, groups and highlighting.
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent as RMouseEvent, type ReactElement, type ReactNode } from 'react';
import type { Row } from '../engine/schedule';
import { CONSTRAINT_NAMES, TASK_TYPE_NAMES, type Fmt } from '../engine/model';
import { insertTasks } from '../engine/ops';
import { atDay, fmtDate, parseDateText } from '../engine/time';
import { S, useStore } from './store';
import { editText, makeColumn, type Column, type Ctx } from './columns';
import Icon from './Icon';
import IndicatorIcon from './IndicatorIcon';
import { CalendarPopup } from './DatePicker';
import { FieldPicker, FilterMenu, HeaderMenu, type MenuState } from './ColumnMenus';
import { applyPainter, bestFitWidth, cellFormat, copyRows, currentColumns, deleteSelected, editTask, fontPx, fontStack, GROUP_COLORS, hideColumn, highlighted, indentSel, insertTask, linkSel, moveColumn, moveRowsTo, openHyperlink, pasteText, setRowLines, toggleCollapse, unlinkSel, updateColumn } from './actions';
import { ROW_H, type Layout } from './layout';

const IND_TITLE: Record<string, string> = {
  constraint: 'This task has a date constraint.', conflict: 'Constraint conflict: the task cannot meet its constraint date.', deadline: 'This task finishes after its deadline.',
  manualWarn: 'Potential scheduling problem: this manually scheduled task does not meet its links.', complete: 'This task was completed.', notes: 'Notes',
  inactive: 'This task is inactive.', overallocated: 'A resource on this task is overallocated. Right-click for options, or use Plan › Level.', cycle: 'This task is part of a dependency loop.'
};
const IND_ICON: Record<string, string> = { constraint: 'calendar', conflict: 'alert', deadline: 'flag', manualWarn: 'alert', complete: 'check', notes: 'note', inactive: 'inactive', overallocated: 'resources', cycle: 'repeat' };

function Indicators({ r }: { r: Row }) {
  const t = r.task;
  return (
    <span className="inds">
      {t.recurrence && <span className="ind ind-recur" title={'Recurring task: ' + r.children.length + ' occurrences'}><Icon name="recur" /></span>}
      {r.indicators.map(k => (
        <span key={k} className={'ind ind-' + k} title={(k === 'conflict' || k === 'manualWarn' || k === 'cycle') && r.conflict ? r.conflict : k === 'notes' ? t.notes.slice(0, 400) : IND_TITLE[k]}>
          <Icon name={IND_ICON[k] || 'info'} />
        </span>
      ))}
      {t.hyperlink && <button className="ind ind-link" tabIndex={-1} title={(t.hyperlink.text || t.hyperlink.address) + ' — click to open'} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); openHyperlink(t.uid); }}><Icon name="hyperlink" /></button>}
    </span>
  );
}

export const fmtStyle = (f: Fmt): CSSProperties => ({
  fontWeight: f.b ? 700 : undefined, fontStyle: f.i ? 'italic' : undefined,
  textDecoration: [f.u ? 'underline' : '', f.s ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
  color: f.color, background: f.bg, fontFamily: fontStack(f.font), fontSize: fontPx(f.size)
});

type Move = 'down' | 'right' | 'left' | 'up';

function Editor({ col, initial, onDone, defaultMinute, openCal }: { col: Column; initial: string; onDone: (value: string | null, move?: Move) => void; defaultMinute: number; openCal?: boolean }) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(initial);
  const [cal, setCal] = useState<DOMRect | null>(null);
  const p = S().p;
  useEffect(() => {
    const el = ref.current;
    if (el) { el.focus(); if (el.tagName === 'INPUT') { const n = el.value.length; el.setSelectionRange(n, n); } }
    if (openCal && box.current) setCal(box.current.getBoundingClientRect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const key = (e: KeyboardEvent) => {
    if (col.editor === 'date' && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); setCal(box.current!.getBoundingClientRect()); }
    else if (e.key === 'Enter') { e.preventDefault(); onDone(v, e.shiftKey ? 'up' : 'down'); }
    else if (e.key === 'Tab') { e.preventDefault(); onDone(v, e.shiftKey ? 'left' : 'right'); }
    else if (e.key === 'Escape') { e.preventDefault(); if (cal) setCal(null); else onDone(null); }
    e.stopPropagation();
  };
  let options: [string, string][] | null =
    col.editor === 'mode' ? [['Auto', 'Auto: dates follow links'], ['Pinned', 'Pinned: dates stay put']]
      : col.editor === 'constraint' ? Object.entries(CONSTRAINT_NAMES).map(([k, l]) => [k, l])
        : col.editor === 'type' ? Object.entries(TASK_TYPE_NAMES).map(([k, l]) => [k, l])
          : col.editor === 'bool' ? [['true', 'Yes'], ['false', 'No']] : null;
  if (col.key === 'calendar') options = [['None', 'None'], ...p.calendars.map(c => [c.id, c.name] as [string, string])];
  if (col.editor === 'list' && col.field?.options) options = col.field.options.map(o => [o, o] as [string, string]);
  const def = col.field?.custom ? p.fields[col.key] : undefined;
  if (col.editor === 'list' && def) {
    if (def.restrict) options = [['', ''], ...def.values.map(x => [x.value, x.value + (x.desc ? ' – ' + x.desc : '')] as [string, string])];
    else {
      return (
        <>
          <input ref={ref} className="cell-edit" list="pc-vlist" value={v} onChange={e => setV(e.target.value)} onKeyDown={key} onBlur={() => onDone(v)} spellCheck={false} />
          <datalist id="pc-vlist">{def.values.map(x => <option key={x.value} value={x.value}>{x.desc}</option>)}</datalist>
        </>
      );
    }
  }
  if (options) {
    const cur = options.find(o => o[1] === initial || o[0] === initial)?.[0] ?? options[0][0];
    return (
      <select ref={ref} className="cell-edit" defaultValue={cur} onKeyDown={key} onChange={e => onDone(e.target.value)} onBlur={() => onDone(null)}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  }
  if (col.editor === 'date') {
    const parsed = parseDateText(v, p.settings.dateFormat);
    return (
      <div className="cell-edit date" ref={box}>
        <input ref={ref} value={v} onChange={e => setV(e.target.value)} onKeyDown={key} onBlur={() => { if (!cal) onDone(v); }} spellCheck={false} />
        <button type="button" tabIndex={-1} className="cell-drop" aria-label="Open calendar" onMouseDown={e => { e.preventDefault(); setCal(cal ? null : box.current!.getBoundingClientRect()); }}>▾</button>
        {cal && <CalendarPopup value={parsed?.day ?? null} anchor={cal} workingDay={d => S().s.calendar.isWorkingDay(d)}
          onClose={() => { setCal(null); ref.current?.focus(); }}
          onPick={d => { setCal(null); onDone(d == null ? '' : fmtDate(atDay(d, parsed?.minute ?? defaultMinute), { time: true, format: p.settings.dateFormat }), 'down'); }} />}
      </div>
    );
  }
  return <input ref={ref} className="cell-edit" value={v} onChange={e => setV(e.target.value)} onKeyDown={key} onBlur={() => onDone(v)} spellCheck={col.key === 'name' || col.key === 'notes'} />;
}

type RowDrag = { y0: number; active: boolean; over: number | null; after: boolean; click?: () => void };
type RowSize = { uid: number; y0: number; h0: number; cur: number };

export default function TaskTable({ rows, ctx, layout, scrollTop, height, onScroll, width, headH = 44 }: { rows: Row[]; ctx: Ctx; layout: Layout; scrollTop: number; height: number; onScroll: (top: number) => void; width?: number; headH?: number }) {
  const st = useStore();
  const ui = st.ui;
  const specs = currentColumns(st);
  const cols = specs.map(c => makeColumn(c, st.p)).filter((c): c is Column => !!c);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [resize, setResize] = useState<{ key: string; x: number; w: number; cur: number } | null>(null);
  const [dragCol, setDragCol] = useState<{ key: string; x0: number; active: boolean; over: string | null } | null>(null);
  const [dragRow, setDragRow] = useState<RowDrag | null>(null);
  const [sizeRow, setSizeRow] = useState<RowSize | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const total = layout.count;
  const first = Math.max(0, layout.indexAt(scrollTop) - 5);
  const last = Math.min(total, layout.indexAt(scrollTop + height) + 6);
  const selSet = new Set(st.sel);
  const hl = highlighted(st);
  const tableW = 40 + cols.reduce((a, c) => a + c.width, 0);
  const titles = st.p.textStyles.titles;

  useEffect(() => { const b = bodyRef.current; if (b && Math.abs(b.scrollTop - scrollTop) > 1) b.scrollTop = scrollTop; }, [scrollTop]);

  // Format › Insert Column opens the field list under the selected column's heading.
  useEffect(() => {
    const open = (e: Event) => {
      const field = (e as CustomEvent<string>).detail;
      const el = headRef.current?.querySelector<HTMLElement>('[data-key="' + field + '"]') || headRef.current;
      const r = el?.getBoundingClientRect();
      setMenu({ kind: 'picker', x: r ? r.left : 100, y: r ? r.bottom + 2 : 120, before: specs.some(c => c.field === field) ? field : undefined });
    };
    window.addEventListener('pc:insertcolumn', open);
    return () => window.removeEventListener('pc:insertcolumn', open);
  });

  // Column resizing (saved with the plan when the mouse is released)
  useEffect(() => {
    if (!resize) return;
    const move = (e: MouseEvent) => setResize(r => (r ? { ...r, cur: Math.max(24, r.w + e.clientX - r.x) } : r));
    const up = () => { setResize(r => { if (r && r.cur !== r.w) updateColumn(r.key, { width: Math.round(r.cur) }); return null; }); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [resize]);
  const widthOf = (c: Column) => (resize && resize.key === c.key ? resize.cur : c.width);

  // Dragging a column header moves the column.
  useEffect(() => {
    if (!dragCol) return;
    const move = (e: MouseEvent) => {
      const head = headRef.current;
      if (!head) return;
      const active = dragCol.active || Math.abs(e.clientX - dragCol.x0) > 6;
      let over: string | null = null;
      head.querySelectorAll<HTMLElement>('.th[data-key]').forEach(th => { const r = th.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX < r.right) over = e.clientX < r.left + r.width / 2 ? th.dataset.key! : (th.nextElementSibling as HTMLElement | null)?.dataset.key ?? null; });
      setDragCol(d => (d ? { ...d, active, over } : d));
    };
    const up = () => {
      setDragCol(d => {
        if (d?.active && d.over !== d.key) moveColumn(d.key, d.over);
        else if (d && !d.active) { S().set({ colSel: d.key, sel: [], cell: null }); }
        return null;
      });
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragCol]);

  // Dragging selected row headings moves the tasks (with their subtasks).
  useEffect(() => {
    if (!dragRow) return;
    const move = (e: MouseEvent) => {
      const b = bodyRef.current;
      if (!b) return;
      const y = e.clientY - b.getBoundingClientRect().top + b.scrollTop;
      const active = dragRow.active || Math.abs(e.clientY - dragRow.y0) > 6;
      const i = Math.min(rows.length - 1, layout.indexAt(y));
      const after = y > layout.top(i) + layout.height(i) / 2;
      setDragRow(d => (d ? { ...d, active, over: i, after } : d));
      // Scroll while dragging near the edges.
      const r = b.getBoundingClientRect();
      if (active && e.clientY < r.top + 20) onScroll(Math.max(0, b.scrollTop - 24));
      if (active && e.clientY > r.bottom - 20) onScroll(b.scrollTop + 24);
    };
    const up = () => {
      setDragRow(d => {
        if (d?.active && d.over != null) {
          const target = rows[d.over];
          if (target && !target.group && target.id > 0) {
            let before: number | null;
            if (d.after) {
              // After a row: before the next row that is not one of its own subtasks when the row is collapsed.
              const next = rows[d.over + 1];
              before = next && !next.group && next.id > 0 ? next.task.uid : null;
            } else before = target.task.uid;
            if (!selSet.has(before ?? -1)) moveRowsTo(before);
          }
        } else if (d && !d.active) setTimeout(() => d.click?.(), 0); // a click without dragging selects just that row

        return null;
      });
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  });

  // Dragging the bottom edge of a row heading changes the row height (in lines).
  useEffect(() => {
    if (!sizeRow) return;
    const move = (e: MouseEvent) => setSizeRow(r => (r ? { ...r, cur: Math.max(ROW_H, r.h0 + e.clientY - r.y0) } : r));
    const up = () => setSizeRow(r => {
      if (r) {
        const lines = Math.max(1, Math.round((r.cur - 8) / 16));
        const uids = selSet.has(r.uid) ? S().sel : [r.uid];
        setRowLines(uids, r.cur <= ROW_H + 4 ? 1 : lines);
      }
      return null;
    });
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  });

  const focusBody = () => bodyRef.current?.focus({ preventScroll: true });
  const ensureVisible = (row: number) => {
    const top = layout.top(row), h = layout.height(row);
    if (top < scrollTop) onScroll(top);
    else if (top + h > scrollTop + height) onScroll(top + h - height);
  };

  const selectable = (r: Row | undefined) => !!r && !r.group;
  const selectRow = (row: number, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const r = rows[row];
    if (!r || r.id === 0 || r.group) { S().set({ sel: r && r.id === 0 ? [0] : [] }); return; }
    const uid = r.task.uid;
    const cur = S().sel.filter(u => u > 0);
    if (e?.ctrlKey || e?.metaKey) S().set({ sel: cur.includes(uid) ? cur.filter(u => u !== uid) : cur.concat(uid) });
    else if (e?.shiftKey && cur.length) {
      const anchor = rows.findIndex(x => x.task.uid === cur[0]);
      const [a, b] = anchor < row ? [anchor, row] : [row, anchor];
      const range = rows.slice(Math.max(0, a), b + 1).filter(x => x.id > 0 && !x.group).map(x => x.task.uid);
      S().set({ sel: anchor < row ? range : range.reverse() });
    } else S().set({ sel: [uid] });
  };

  // Keyboard moves scroll the active cell into view; mouse clicks never scroll (the row would move under the pointer).
  const setCell = (row: number, col: string, e?: RMouseEvent | KeyboardEvent, fromMouse = false, rowsMode = false) => {
    S().set({ cell: { row, col }, colSel: null, selMode: rowsMode ? 'rows' : 'cells' });
    selectRow(row, e as any);
    if (!fromMouse) ensureVisible(row);
  };

  const startEdit = (row: number, colKey: string, seed?: string, cal = false) => {
    const col = cols.find(c => c.key === colKey);
    if (!col?.edit) return;
    const r = rows[row];
    if (r?.group) return;
    const text = seed ?? (r ? editText(col, r, ctx) : '');
    S().set({ editing: { row, col: colKey, text, cal } });
  };

  const finishEdit = (value: string | null, move?: Move) => {
    const ed = S().editing;
    if (!ed) return;
    S().set({ editing: null });
    const col = cols.find(c => c.key === ed.col);
    if (value != null && col?.edit) {
      const r = rows[ed.row];
      const old = r ? editText(col, r, ctx) : '';
      if (value !== old || !r) {
        if (!r) {
          if (value.trim()) {
            // Typing in an empty row adds a task at the end.
            const p0 = S().p;
            const { p, uids } = insertTasks(p0, p0.tasks.length, 1, { name: col.key === 'name' ? value.trim() : '', created: new Date().toISOString() });
            S().commit(p);
            if (col.key !== 'name') editTask(uids[0], col.edit, value);
            S().set({ sel: uids });
          }
        } else editTask(r.task.uid, col.edit, value);
      }
    }
    const c = S().cell;
    if (c && move) {
      const ci = cols.findIndex(x => x.key === c.col);
      if (move === 'down') setCell(Math.min(c.row + 1, total - 1), c.col);
      if (move === 'up') setCell(Math.max(0, c.row - 1), c.col);
      if (move === 'right' && ci < cols.length - 1) setCell(c.row, cols[ci + 1].key);
      if (move === 'left' && ci > 0) setCell(c.row, cols[ci - 1].key);
    }
    focusBody();
  };

  const onKey = (e: KeyboardEvent) => {
    if (S().editing) return;
    const c = S().cell || { row: 0, col: cols.find(x => x.key === 'name')?.key || cols[0].key };
    const ci = Math.max(0, cols.findIndex(x => x.key === c.col));
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;   // move tasks: handled as a command
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); startEdit(c.row, c.col, undefined, true); return; }
    if (e.key === 'Enter' && e.altKey) return;                                             // details panel: a command
    if (ctrl && e.key === 'Enter') return;                                                 // add task: a command
    if (ctrl && e.key.toLowerCase() === 'c' && !e.shiftKey) { e.preventDefault(); copyRows(false); return; }
    if (ctrl && e.key.toLowerCase() === 'x') { e.preventDefault(); copyRows(true); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); S().set({ sel: rows.filter(r => r.id > 0 && !r.group).map(r => r.task.uid), selMode: 'rows' }); return; }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setCell(Math.min(c.row + 1, total - 1), c.col, e.shiftKey ? e : undefined); break;
      case 'ArrowUp': e.preventDefault(); setCell(Math.max(0, c.row - 1), c.col, e.shiftKey ? e : undefined); break;
      case 'ArrowRight': e.preventDefault(); if (ci < cols.length - 1) setCell(c.row, cols[ci + 1].key); break;
      case 'ArrowLeft': e.preventDefault(); if (ci > 0) setCell(c.row, cols[ci - 1].key); break;
      case 'Tab': e.preventDefault(); setCell(c.row, cols[Math.max(0, Math.min(cols.length - 1, ci + (e.shiftKey ? -1 : 1)))].key); break;
      case 'PageDown': e.preventDefault(); setCell(Math.min(total - 1, c.row + Math.floor(height / ROW_H)), c.col); break;
      case 'PageUp': e.preventDefault(); setCell(Math.max(0, c.row - Math.floor(height / ROW_H)), c.col); break;
      case 'Home': if (ctrl) { e.preventDefault(); setCell(0, c.col); } break;
      case 'End': if (ctrl) { e.preventDefault(); setCell(Math.max(0, rows.length - 1), c.col); } break;
      case 'Enter': e.preventDefault(); setCell(Math.min(c.row + 1, total - 1), c.col); break;
      case 'F2': e.preventDefault(); startEdit(c.row, c.col); break;
      case 'Delete': e.preventDefault(); if (S().colSel) S().open('confirm', { title: 'Hide column', message: 'Hide this column? The data stays in the plan.', okLabel: 'Hide', onOk: () => hideColumn(S().colSel!) }); else if (S().sel.length) deleteSelected(); break;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) { e.preventDefault(); startEdit(c.row, c.col, e.key); }
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (S().editing) return;
    const text = e.clipboardData.getData('text/plain');
    if (text) { e.preventDefault(); pasteText(text); }
  };

  const items: ReactElement[] = [];
  for (let i = first; i < last; i++) {
    const r = rows[i];
    const sel = r && selSet.has(r.task.uid);
    const ed = st.editing && st.editing.row === i ? st.editing : null;
    const top = layout.top(i), h = sizeRow && r && sizeRow.uid === r.task.uid ? sizeRow.cur : layout.height(i);
    const isHl = !!(r && hl?.has(r.task.uid));
    const changed = r ? st.changed.get(r.task.uid) : undefined;
    const group = r?.group;
    items.push(
      <div key={r ? 'r' + r.task.uid : 'b' + i} className={'tr' + (sel ? ' sel' : '') + (r?.summary ? ' summary' : '') + (r && !r.task.active ? ' inactive' : '') + (r && ui.critical && r.critical && !r.summary ? ' crit' : '') + (h > ROW_H ? ' tall' : '') + (group ? ' grp' : '') + (isHl ? ' hl' : '')}
        style={{ top, height: h, width: tableW, background: group ? GROUP_COLORS[group.level % GROUP_COLORS.length] : undefined }} onContextMenu={e => { e.preventDefault(); if (group) return; window.dispatchEvent(new CustomEvent('pc:menu', { detail: { x: e.clientX, y: e.clientY, uid: r?.task.uid } })); }}>
        <div className="td rh" style={{ width: 40, height: h - 1 }}
          onMouseDown={e => {
            if (e.button === 2 && r && selSet.has(r.task.uid)) return;
            e.preventDefault();
            if (st.painter && r && !group) { applyPainter(selSet.has(r.task.uid) ? st.sel : [r.task.uid], null); return; }
            // Bottom edge: change the row height.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (r && !group && r.id > 0 && e.clientY > rect.bottom - 5) { setSizeRow({ uid: r.task.uid, y0: e.clientY, h0: h, cur: h }); return; }
            // A selected row heading can be dragged to move the rows.
            if (r && !group && r.id > 0 && selSet.has(r.task.uid) && !e.shiftKey && !e.ctrlKey && st.selMode === 'rows') { setDragRow({ y0: e.clientY, active: false, over: null, after: false, click: () => { setCell(i, S().cell?.col || 'name', undefined, true, true); focusBody(); } }); return; }
            setCell(i, S().cell?.col || 'name', e, true, true); focusBody();
          }}
          onMouseEnter={e => { if (e.buttons === 1 && !dragRow && !sizeRow && r && !group && S().selMode === 'rows') { S().set({ cell: { row: i, col: S().cell?.col || 'name' } }); selectRow(i, { shiftKey: true }); } }}
          title={r && !group && r.id > 0 ? 'Click to select the row; drag a selected row to move it; drag the bottom edge to change its height' : undefined}>{r && !group ? (r.id > 0 ? r.id : 0) : ''}</div>
        {cols.map((c, ci) => {
          const active = st.cell && st.cell.row === i && st.cell.col === c.key;
          const w = widthOf(c);
          let content: ReactNode = null;
          let style: CSSProperties | undefined;
          if (r && group) {
            style = fmtStyle(cellFormat(r, c.key, st.p));
            if (ci === (cols.findIndex(x => x.key === 'name') >= 0 ? cols.findIndex(x => x.key === 'name') : cols.findIndex(x => x.type === 'text'))) content = <span className="grp-label" style={{ paddingLeft: group.level * 14 }}>{group.label}</span>;
            else if (['duration', 'start', 'finish', 'work', 'cost', 'percent', 'actualCost', 'actualWork', 'remainingWork', 'remainingCost'].includes(c.key)) content = <span className="v">{c.text(r, ctx)}</span>;
          } else if (r) {
            style = fmtStyle(cellFormat(r, c.key, st.p, { changed: changed?.has(c.key), highlighted: isHl }));
            if (c.key === 'indicators') content = <Indicators r={r} />;
            else if (c.key === 'mode') content = <span className={'mode ' + r.task.mode} title={c.text(r, ctx)}><Icon name={r.task.mode === 'manual' ? 'pin' : 'auto'} /></span>;
            else if (c.key === 'name') {
              content = (
                <span className="name" style={{ paddingLeft: Math.max(0, r.task.level - 1) * 14 + (ui.group ? 14 * (ui.group ? 1 : 0) : 0) }}>
                  {r.summary && !ui.group ? <button className="tog" tabIndex={-1} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); if (r.id > 0) toggleCollapse(r.task.uid); }} aria-label={ui.collapsed[r.task.uid] ? 'Expand' : 'Collapse'}><Icon name={ui.collapsed[r.task.uid] ? 'chevR' : 'chevD'} /></button> : <span className="tog-sp" />}
                  <span className={'nm' + (c.wrap || h > ROW_H + 4 ? ' wrap' : '')}>{c.text(r, ctx)}</span>
                </span>
              );
            } else if (c.key === 'hyperlink' || c.key === 'hyperlinkAddress' || c.key === 'hyperlinkHref') {
              const text = c.text(r, ctx);
              content = text ? <a className="v cell-link" href="#" onMouseDown={e => { if (e.ctrlKey || active) return; }} onClick={e => { e.preventDefault(); openHyperlink(r.task.uid); }} title="Click to open">{text}</a> : null;
            } else if (c.indicator) {
              const icon = c.indicator(r, ctx);
              const value = c.text(r, ctx);
              content = icon ? <span title={st.p.fields[c.key]?.tip !== false ? value : undefined}><IndicatorIcon name={icon} /></span> : null;
            } else {
              const text = c.text(r, ctx);
              const manualBlank = r.task.mode === 'manual' && !r.summary && (c.key === 'start' || c.key === 'finish' || c.key === 'duration') && r.task.start == null;
              content = <span className={'v' + (r.task.estimated && c.key === 'duration' ? ' est' : '') + (text === '#ERROR' ? ' err' : '') + (c.wrap ? ' wrap' : '')} title={text === '#ERROR' ? 'The formula for this field could not be calculated. Check it in Plan › Custom Fields.' : undefined}>{manualBlank ? '' : text}</span>;
            }
          }
          return (
            <div key={c.key} className={'td' + (active ? ' act' : '') + ' a-' + c.align + (st.colSel === c.key ? ' colsel' : '') + (c.wrap ? ' wrapcell' : '') + (changed?.has(c.key) ? ' changed' : '')} style={{ width: w, height: h - 1, ...style }}
              onMouseDown={e => {
                if (ed && ed.col === c.key) return;
                e.preventDefault();
                if (st.painter && r && !group) { applyPainter(selSet.has(r.task.uid) && st.sel.length > 1 ? st.sel : [r.task.uid], c.key); return; }
                if (e.button === 2) { if (!(r && selSet.has(r.task.uid))) setCell(i, c.key, e, true); else S().set({ cell: { row: i, col: c.key }, colSel: null }); return; }
                // A second click on the active cell edits it; double-click opens the task's details.
                if (active && c.edit && !e.shiftKey && !e.ctrlKey && e.detail === 1 && selectable(r)) { startEdit(i, c.key); return; }
                setCell(i, c.key, e, true); focusBody();
              }}
              onDoubleClick={() => { S().set({ editing: null }); if (r && !group) { if (r.id === 0) S().open('projectInfo'); else { S().set({ sel: [r.task.uid] }); S().setUI({ inspector: true }); } } }}>
              {ed && ed.col === c.key ? <Editor col={c} initial={ed.text} openCal={ed.cal} onDone={finishEdit} defaultMinute={c.key === 'finish' || c.key === 'actualFinish' || c.key === 'deadline' || c.field?.custom === 'Finish' ? st.p.settings.defaultFinish : st.p.settings.defaultStart} /> : content}
              {active && !ed && c.editor === 'date' && r && !group && <button className="cell-drop ghost" tabIndex={-1} aria-label="Open calendar" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startEdit(i, c.key, undefined, true); }}>▾</button>}
            </div>
          );
        })}
      </div>
    );
  }
  // Where dragged rows will go.
  let dropLine: ReactElement | null = null;
  if (dragRow?.active && dragRow.over != null) {
    const y = layout.top(dragRow.over) + (dragRow.after ? layout.height(dragRow.over) : 0);
    dropLine = <div className="row-drop" style={{ top: y - 1, width: tableW }} />;
  }

  const sortMark = (k: string) => { const s = (ui.sorts[0] || ui.sort); return s?.field === k ? (s.desc ? ' ↓' : ' ↑') : ''; };
  const titleStyle: CSSProperties | undefined = titles ? fmtStyle(titles) : undefined;
  return (
    <div className={'table' + (dragRow?.active ? ' dragging-rows' : '') + (st.painter ? ' painter' : '')} style={{ width }}>
      <div className="thead" style={{ height: headH }} ref={headRef}>
        <div className="thead-in" style={{ width: tableW + 160, transform: `translateX(${-(bodyRef.current?.scrollLeft || 0)}px)` }}>
          <div className="th rh" style={{ width: 40 }} title="Select all" onMouseDown={() => S().set({ sel: rows.filter(r => r.id > 0 && !r.group).map(r => r.task.uid), selMode: 'rows', colSel: null })} />
          {cols.map(c => (
            <div key={c.key} data-key={c.key} className={'th' + ' t-' + c.titleAlign + (c.wrapHeader ? ' wraphead' : '') + (st.colSel === c.key ? ' colsel' : '') + (ui.autoFilter[c.key] ? ' filtered' : '') + (dragCol?.active && dragCol.over === c.key ? ' dropbefore' : '')}
              style={{ width: widthOf(c), ...titleStyle }} title={c.field ? c.field.name + (c.field.custom && st.p.fields[c.key]?.formula ? ' = ' + st.p.fields[c.key].formula : '') : 'Indicators'}
              onMouseDown={e => { if (e.button !== 0 || (e.target as HTMLElement).closest('.rsz, .th-drop')) return; e.preventDefault(); setDragCol({ key: c.key, x0: e.clientX, active: false, over: null }); }}
              onDoubleClick={() => S().open('fieldSettings', { field: c.key })}
              onContextMenu={e => { e.preventDefault(); S().set({ colSel: c.key }); setMenu({ kind: 'header', x: e.clientX, y: e.clientY, field: c.key }); }}>
              <span className="th-label">{c.key === 'indicators' ? <Icon name="info" /> : c.key === 'mode' && !c.spec.title ? <Icon name="manual" /> : c.label}{sortMark(c.key)}</span>
              {c.key !== 'indicators' && <button className="th-drop" tabIndex={-1} aria-label={'Sort and filter ' + c.label} onMouseDown={e => e.stopPropagation()} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ kind: 'filter', x: r.left - 200, y: r.bottom + 2, field: c.key }); }}>{ui.autoFilter[c.key] ? <Icon name="filter" /> : '▾'}</button>}
              <span className="rsz" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setResize({ key: c.key, x: e.clientX, w: c.width, cur: c.width }); }} onDoubleClick={e => { e.stopPropagation(); updateColumn(c.key, { width: bestFitWidth(c.key) }); }} />
            </div>
          ))}
          <div className={'th add' + (dragCol?.active && dragCol.over == null ? ' dropbefore' : '')} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ kind: 'picker', x: r.left, y: r.bottom + 2 }); }} title="Add a column"><Icon name="plus" />Add Column</div>
        </div>
      </div>
      <div className="tbody" ref={bodyRef} tabIndex={0} onKeyDown={onKey} onPaste={onPaste}
        onScroll={e => { const t = e.currentTarget; onScroll(t.scrollTop); const h = headRef.current?.firstElementChild as HTMLElement | null; if (h) h.style.transform = `translateX(${-t.scrollLeft}px)`; }}>
        <div className="tbody-in" style={{ height: layout.total, width: tableW + 160 }}>{items}{dropLine}</div>
      </div>
      {menu?.kind === 'picker' && <FieldPicker x={menu.x} y={menu.y} before={menu.before} onClose={() => setMenu(null)} />}
      {menu?.kind === 'header' && <HeaderMenu x={menu.x} y={menu.y} field={menu.field} onClose={() => setMenu(null)} onInsert={() => setMenu({ kind: 'picker', x: menu.x, y: menu.y, before: menu.field })} />}
      {menu?.kind === 'filter' && <FilterMenu x={menu.x} y={menu.y} field={menu.field} onClose={() => setMenu(null)} />}
    </div>
  );
}

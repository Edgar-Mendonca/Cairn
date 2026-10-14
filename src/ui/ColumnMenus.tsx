// Column header menus: the field list for Insert Column / Add New Column, the right-click menu, and AutoFilter.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FIELDS, fieldName } from '../engine/fields';
import { S, useStore } from './store';
import { bestFitWidth, ctxOf, currentColumns, hideColumn, insertColumn, updateColumn, visibleRows } from './actions';
import { makeColumn } from './columns';
import Icon from './Icon';

export type MenuState =
  | { kind: 'picker'; x: number; y: number; before?: string }
  | { kind: 'header'; x: number; y: number; field: string }
  | { kind: 'filter'; x: number; y: number; field: string };

function Popup({ x, y, width, onClose, children, className = '' }: { x: number; y: number; width: number; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 6)), top: r.bottom > window.innerHeight - 4 ? Math.max(4, window.innerHeight - r.height - 6) : y });
    }
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', key); };
  }, [x, y, onClose]);
  return <div ref={ref} className={'popup ' + className} style={{ left: pos.left, top: pos.top, width }}>{children}</div>;
}

// Every task field in alphabetical order. Type to narrow the list.
export function FieldPicker({ x, y, before, onClose }: { x: number; y: number; before?: string; onClose: () => void }) {
  const p = useStore(s => s.p);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const shown = new Set(currentColumns().map(c => c.field));
  const list = useMemo(() => {
    const all = FIELDS.filter(f => !f.hidden).map(f => ({ key: f.key, label: fieldName(f.key, p, true), group: f.group }));
    return all.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [p]);
  const items = list.filter(f => !q || f.label.toLowerCase().includes(q.toLowerCase()));
  const pick = (key: string) => { onClose(); insertColumn(key, before); };
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  return (
    <Popup x={x} y={y} width={260} onClose={onClose} className="picker">
      <input className="inp" autoFocus placeholder="Type a field name" value={q} onChange={e => { setQ(e.target.value); setHi(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(items.length - 1, hi + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, hi - 1)); }
          if (e.key === 'Enter' && items[hi]) pick(items[hi].key);
        }} />
      <div className="picker-list" ref={listRef}>
        {items.map((f, i) => (
          <button key={f.key} className={'picker-item' + (i === hi ? ' on' : '') + (shown.has(f.key) ? ' shown' : '')} onMouseEnter={() => setHi(i)} onClick={() => pick(f.key)} title={f.group}>
            {f.label}{shown.has(f.key) && <span className="muted"> · shown</span>}
          </button>
        ))}
        {!items.length && <div className="muted pad">No field matches “{q}”.</div>}
      </div>
    </Popup>
  );
}

export function HeaderMenu({ x, y, field, onClose, onInsert }: { x: number; y: number; field: string; onClose: () => void; onInsert: () => void }) {
  const st = useStore();
  const spec = currentColumns(st).find(c => c.field === field);
  const custom = FIELDS.find(f => f.key === field)?.custom;
  const item = (label: string, icon: string, act: () => void, opts: { on?: boolean; disabled?: boolean } = {}) => (
    <button className={'cm-item' + (opts.on ? ' checked' : '')} disabled={opts.disabled} onClick={() => { onClose(); act(); }}><Icon name={icon} />{label}</button>
  );
  return (
    <Popup x={x} y={y} width={220} onClose={onClose} className="cmenu-pop">
      {item('Sort Ascending', 'sortup', () => S().setUI({ sort: { field, desc: false } }), { disabled: field === 'indicators' })}
      {item('Sort Descending', 'sortdown', () => S().setUI({ sort: { field, desc: true } }), { disabled: field === 'indicators' })}
      {st.ui.sort && item('Remove Sort', 'sort', () => S().setUI({ sort: null }))}
      <div className="cm-sep" />
      {item('Wrap Text', 'wrap', () => updateColumn(field, { wrap: !spec?.wrap }), { on: !!spec?.wrap })}
      {item('Insert Column', 'columns', onInsert)}
      {item('Hide Column', 'hide', () => hideColumn(field))}
      {item('Best Fit Width', 'fit', () => updateColumn(field, { width: bestFitWidth(field) }), { disabled: field === 'indicators' })}
      <div className="cm-sep" />
      {item('Text Styles…', 'font', () => S().open('textStyles'))}
      {item('Field Settings…', 'settings', () => S().open('fieldSettings', { field }))}
      {item('Custom Fields…', 'custom', () => S().open('customFields', { field: custom ? field : undefined }))}
    </Popup>
  );
}

// AutoFilter: sort, and choose which values to show in this column.
export function FilterMenu({ x, y, field, onClose }: { x: number; y: number; field: string; onClose: () => void }) {
  const st = useStore();
  const col = makeColumn({ field }, st.p);
  const ctx = ctxOf(st);
  const values = useMemo(() => {
    if (!col) return [];
    const set = new Set<string>();
    st.s.rows.forEach(r => { if (!r.summary) set.add(col.text(r, ctx)); });
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.s, field]);
  const current = st.ui.autoFilter[field];
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(current ?? values));
  const [q, setQ] = useState('');
  const shown = values.filter(v => !q || v.toLowerCase().includes(q.toLowerCase()));
  const all = shown.every(v => chosen.has(v));
  const apply = () => {
    const keep = values.filter(v => chosen.has(v));
    const af = { ...st.ui.autoFilter };
    if (keep.length === values.length) delete af[field]; else af[field] = keep;
    S().setUI({ autoFilter: af });
    if (!visibleRows({ ...S(), ui: { ...S().ui, autoFilter: af } }).length) S().notify('No tasks match this filter.');
    onClose();
  };
  const isText = col?.type === 'text';
  return (
    <Popup x={x} y={y} width={250} onClose={onClose} className="filter-pop">
      <button className="cm-item" onClick={() => { S().setUI({ sort: { field, desc: false } }); onClose(); }}><Icon name="sortup" />{isText ? 'Sort A to Z' : 'Sort Smallest to Largest'}</button>
      <button className="cm-item" onClick={() => { S().setUI({ sort: { field, desc: true } }); onClose(); }}><Icon name="sortdown" />{isText ? 'Sort Z to A' : 'Sort Largest to Smallest'}</button>
      <div className="cm-sep" />
      <button className="cm-item" disabled={!current} onClick={() => { const af = { ...st.ui.autoFilter }; delete af[field]; S().setUI({ autoFilter: af }); onClose(); }}><Icon name="clear" />Clear Filter from {col?.label || field}</button>
      <input className="inp" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
      <div className="filter-list">
        <label className="chk"><input type="checkbox" checked={all} onChange={() => { const n = new Set(chosen); shown.forEach(v => (all ? n.delete(v) : n.add(v))); setChosen(n); }} />(Select All)</label>
        {shown.map(v => (
          <label key={v} className="chk"><input type="checkbox" checked={chosen.has(v)} onChange={() => { const n = new Set(chosen); if (n.has(v)) n.delete(v); else n.add(v); setChosen(n); }} />{v === '' ? '(Blanks)' : v}</label>
        ))}
      </div>
      <div className="row-btns end"><button className="btn primary" onClick={apply}>OK</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Popup>
  );
}

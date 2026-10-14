// Sort, filter and group dialogs: Sort By (three keys), More Filters, the filter editor (AND/OR criteria with
// questions), interactive filter prompts, More Groups and the group editor.
import { useState } from 'react';
import type { Criterion, FilterDef, FilterTest, GroupDef } from '../engine/model';
import { FIELDS, fieldName } from '../engine/fields';
import { BUILTIN_FILTERS, BUILTIN_GROUPS, FILTER_BY_ID, TEST_NAMES, promptsOf } from '../engine/filters';
import { F, Modal } from './Modal';
import { S, useStore, type SortSpec } from './store';
import { DateInput } from './DatePicker';
import { visibleRows } from './actions';
import Icon from './Icon';

const fieldOptions = (p: Parameters<typeof fieldName>[1]) => FIELDS.filter(f => !f.hidden || f.key === 'completion').map(f => ({ key: f.key, label: fieldName(f.key, p, true) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

/* ---------- Sort ---------- */

export function SortDialog() {
  const st = useStore();
  const init: SortSpec[] = st.ui.sorts.length ? st.ui.sorts : st.ui.sort ? [st.ui.sort] : [];
  const [keys, setKeys] = useState<(SortSpec | null)[]>([init[0] || { field: 'start', desc: false }, init[1] || null, init[2] || null]);
  const [outline, setOutline] = useState(st.ui.sortOutline !== false);
  const [renumber, setRenumber] = useState(false);
  const opts = fieldOptions(st.p);
  const ok = () => {
    const ks = keys.filter((k): k is SortSpec => !!k && !!k.field);
    if (renumber && ks.length) {
      // Permanently renumber: reorder the tasks themselves (within their phases when keeping the outline).
      const cur = S();
      const order = visibleRows({ ...cur, ui: { ...cur.ui, sorts: ks, sort: ks[0], sortOutline: outline, filter: 'all', group: null, collapsed: {}, outlineLevel: 0, projectSummary: false, autoFilter: {} } }).map(r => r.task.uid);
      if (order.length) {
        const pos = new Map(order.map((u, i) => [u, i]));
        const tasks = st.p.tasks.slice().sort((a, b) => (pos.get(a.uid) ?? 1e9) - (pos.get(b.uid) ?? 1e9));
        if (!outline) tasks.forEach((t, i) => { if (t.level !== 1) tasks[i] = { ...t, level: 1 }; });
        st.commit({ ...st.p, tasks });
      }
      S().setUI({ sorts: [], sort: null });
      return;
    }
    S().setUI({ sorts: ks, sort: ks[0] || null, sortOutline: outline });
  };
  return (
    <Modal title="Sort" onOk={ok} okLabel="Sort" extra={<button type="button" className="btn" onClick={() => { S().setUI({ sorts: [], sort: null }); S().close(); }}>Reset</button>}>
      {(['Sort by', 'Then by', 'Then by'] as const).map((label, i) => (
        <div key={i} className="sort-row">
          <F label={label}><select className="inp" value={keys[i]?.field || ''} onChange={e => setKeys(keys.map((k, j) => (j === i ? (e.target.value ? { field: e.target.value, desc: k?.desc ?? false } : null) : k)))}>
            {i > 0 && <option value="">(none)</option>}{opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></F>
          <label className="chk"><input type="radio" checked={!keys[i]?.desc} disabled={!keys[i]} onChange={() => setKeys(keys.map((k, j) => (j === i && k ? { ...k, desc: false } : k)))} />Ascending</label>
          <label className="chk"><input type="radio" checked={!!keys[i]?.desc} disabled={!keys[i]} onChange={() => setKeys(keys.map((k, j) => (j === i && k ? { ...k, desc: true } : k)))} />Descending</label>
        </div>
      ))}
      <label className="chk"><input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} />Keep outline structure</label>
      <label className="chk"><input type="checkbox" checked={renumber} onChange={e => setRenumber(e.target.checked)} />Permanently renumber tasks</label>
      <p className="hint">Renumbering moves the tasks into the sorted order for good (undo with Ctrl+Z); without it the sort is only how the view shows them.</p>
    </Modal>
  );
}

/* ---------- More Filters ---------- */

export function MoreFiltersDialog({ highlight: hl0 }: { highlight?: boolean }) {
  const st = useStore();
  const [sel, setSel] = useState(st.ui.filter !== 'all' ? st.ui.filter : 'critical');
  const list = [...BUILTIN_FILTERS.filter(f => !f.hidden).map(f => ({ id: f.id, name: f.name, custom: false })), ...st.p.filters.map(f => ({ id: f.id, name: f.name, custom: true }))].sort((a, b) => a.name.localeCompare(b.name));
  const apply = (highlight: boolean) => {
    const b = FILTER_BY_ID.get(sel), c = st.p.filters.find(f => f.id === sel);
    if (b?.ask?.length || (c && promptsOf(c).length)) { S().open('filterArgs', { id: sel, highlight }); return false; }
    S().setUI({ filter: sel, filterArgs: [], highlight });
  };
  const custom = st.p.filters.find(f => f.id === sel);
  return (
    <Modal title="Filters" wide onOk={() => apply(!!hl0)} okLabel={hl0 ? 'Highlight' : 'Apply'}
      extra={<><button type="button" className="btn" onClick={() => apply(!hl0) === false ? undefined : S().close()}>{hl0 ? 'Apply' : 'Highlight'}</button>
        <button type="button" className="btn" onClick={() => S().open('filterEditor', {})}><Icon name="plus" />New…</button>
        <button type="button" className="btn" disabled={!custom} onClick={() => S().open('filterEditor', { id: sel })}>Edit…</button>
        <button type="button" className="btn" onClick={() => { const b = FILTER_BY_ID.get(sel); const src = custom || null; S().open('filterEditor', { copyOf: src ? src.id : undefined, name: 'Copy of ' + (src?.name || b?.name || 'filter') }); }}>Copy…</button>
        <button type="button" className="btn" disabled={!custom} onClick={() => { st.commit({ ...st.p, filters: st.p.filters.filter(f => f.id !== sel) }); if (st.ui.filter === sel) S().setUI({ filter: 'all' }); setSel('critical'); }}>Delete</button></>}>
      <ul className="collist pick">{list.map(f => <li key={f.id} className={f.id === sel ? 'on' : ''} onClick={() => setSel(f.id)} onDoubleClick={() => { setSel(f.id); setTimeout(() => apply(!!hl0) !== false && S().close(), 0); }}><span>{f.name}{FILTER_BY_ID.get(f.id)?.ask ? '…' : ''}</span>{f.custom && <small className="muted">this plan</small>}</li>)}</ul>
      <p className="hint">Filters ending in … ask for values. Highlight keeps every task and marks the ones that match.</p>
    </Modal>
  );
}

/* ---------- Filter editor ---------- */

export function FilterEditor({ id, copyOf, name: name0 }: { id?: string; copyOf?: string; name?: string }) {
  const st = useStore();
  const src = st.p.filters.find(f => f.id === (id || copyOf));
  const [f, setF] = useState<FilterDef>(() => src ? { ...JSON.parse(JSON.stringify(src)), id: id ? src.id : 'f' + Date.now().toString(36), name: id ? src.name : name0 || 'Copy of ' + src.name }
    : { id: 'f' + Date.now().toString(36), name: name0 || 'Filter ' + (st.p.filters.length + 1), summaries: true, criteria: [{ join: 'and', field: 'name', test: 'contains', value: '', value2: '' }] });
  const opts = fieldOptions(st.p);
  const upd = (k: number, patch: Partial<Criterion>) => setF({ ...f, criteria: f.criteria.map((c, i) => (i === k ? { ...c, ...patch } : c)) });
  const ok = (apply: boolean) => {
    if (!f.name.trim()) { S().notify('Name the filter.', true); return false; }
    const clean = { ...f, name: f.name.trim(), criteria: f.criteria.filter(c => c.field) };
    st.commit({ ...st.p, filters: st.p.filters.some(x => x.id === clean.id) ? st.p.filters.map(x => (x.id === clean.id ? clean : x)) : st.p.filters.concat(clean) });
    if (apply) { if (promptsOf(clean).length) { S().open('filterArgs', { id: clean.id }); return false; } S().setUI({ filter: clean.id, filterArgs: [], highlight: false }); }
  };
  return (
    <Modal title={'Filter: ' + f.name} xwide onOk={() => ok(true)} okLabel="Save and Apply" extra={<button type="button" className="btn" onClick={() => { if (ok(false) !== false) S().close(); }}>Save</button>}>
      <F label="Name"><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></F>
      <table className="mini crit">
        <thead><tr><th style={{ width: 80 }}>And/Or</th><th>Field Name</th><th style={{ width: 200 }}>Test</th><th>Value(s)</th><th style={{ width: 70 }} /></tr></thead>
        <tbody>{f.criteria.map((c, k) => (
          <tr key={k}>
            <td>{k > 0 ? <select className="inp" value={c.join} onChange={e => upd(k, { join: e.target.value as 'and' | 'or' })}><option value="and">And</option><option value="or">Or</option></select> : null}</td>
            <td><select className="inp" value={c.field} onChange={e => upd(k, { field: e.target.value })}>{opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></td>
            <td><select className="inp" value={c.test} onChange={e => upd(k, { test: e.target.value as FilterTest })}>{Object.entries(TEST_NAMES).map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></td>
            <td><span className="row-btns"><input className="inp" value={c.value} placeholder='Value, or "?Question" to ask' onChange={e => upd(k, { value: e.target.value })} />{(c.test === 'within' || c.test === 'notWithin') && <input className="inp" value={c.value2} placeholder="and" onChange={e => upd(k, { value2: e.target.value })} />}</span></td>
            <td className="nowrap"><button type="button" className="icon-btn" onClick={() => setF({ ...f, criteria: f.criteria.filter((_, i) => i !== k) })} aria-label="Delete row"><Icon name="x" /></button></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="row-btns"><button type="button" className="btn" onClick={() => setF({ ...f, criteria: f.criteria.concat({ join: 'and', field: 'start', test: 'gt', value: '', value2: '' }) })}><Icon name="plus" />Add criterion</button>
        <label className="chk"><input type="checkbox" checked={f.summaries} onChange={e => setF({ ...f, summaries: e.target.checked })} />Show related summary rows</label></div>
      <p className="hint">And is applied before Or. Dates and durations can be typed as usual (12 Jan 26, 5d). Write a value as ?Question (for example ?Show tasks starting after) to be asked for it each time the filter is applied.</p>
    </Modal>
  );
}

/* ---------- Interactive filter prompts ---------- */

export function FilterArgsDialog({ id, highlight }: { id: string; highlight?: boolean }) {
  const st = useStore();
  const b = FILTER_BY_ID.get(id), c = st.p.filters.find(f => f.id === id);
  const asks = b?.ask || (c ? promptsOf(c).map(q => ({ label: q.slice(1) || 'Value', kind: 'text' as const })) : []);
  const [vals, setVals] = useState<string[]>(() => asks.map((a, i) => st.ui.filter === id ? st.ui.filterArgs[i] || '' : a.kind === 'date' ? '' : ''));
  return (
    <Modal title={b?.name.replace('…', '') || c?.name || 'Filter'} onOk={() => { S().setUI({ filter: id, filterArgs: vals, highlight: !!highlight }); }}>
      {asks.map((a, i) => (
        <F key={i} label={a.label}>
          {a.kind === 'date' ? <DateInput value={vals[i]} format={st.p.settings.dateFormat} defaultMinute={0} onChange={v => setVals(vals.map((x, j) => (j === i ? v : x)))} />
            : a.kind === 'resource' ? <select className="inp" value={vals[i]} onChange={e => setVals(vals.map((x, j) => (j === i ? e.target.value : x)))}><option value="" />{st.p.resources.map(r => <option key={r.uid}>{r.name}</option>)}</select>
              : <input className="inp" autoFocus={i === 0} value={vals[i]} onChange={e => setVals(vals.map((x, j) => (j === i ? e.target.value : x)))} />}
        </F>
      ))}
    </Modal>
  );
}

/* ---------- Groups ---------- */

export function MoreGroupsDialog() {
  const st = useStore();
  const [sel, setSel] = useState(st.ui.group || 'critical');
  const list = [...BUILTIN_GROUPS.map(g => ({ id: g.id, name: g.name, custom: false })), ...st.p.groups.map(g => ({ id: g.id, name: g.name, custom: true }))];
  const custom = st.p.groups.find(g => g.id === sel);
  return (
    <Modal title="Groups" onOk={() => S().setUI({ group: sel })} okLabel="Apply"
      extra={<><button type="button" className="btn" onClick={() => S().open('groupEditor', {})}><Icon name="plus" />New…</button>
        <button type="button" className="btn" disabled={!custom} onClick={() => S().open('groupEditor', { id: sel })}>Edit…</button>
        <button type="button" className="btn" onClick={() => { const g = custom || BUILTIN_GROUPS.find(x => x.id === sel); if (g) S().open('groupEditor', { base: g }); }}>Copy…</button>
        <button type="button" className="btn" disabled={!custom} onClick={() => { st.commit({ ...st.p, groups: st.p.groups.filter(g => g.id !== sel) }); if (st.ui.group === sel) S().setUI({ group: null }); }}>Delete</button></>}>
      <ul className="collist pick">{list.map(g => <li key={g.id} className={g.id === sel ? 'on' : ''} onClick={() => setSel(g.id)} onDoubleClick={() => { S().setUI({ group: g.id }); S().close(); }}><span>{g.name}</span>{g.custom && <small className="muted">this plan</small>}</li>)}</ul>
    </Modal>
  );
}

export function GroupEditor({ id, base }: { id?: string; base?: GroupDef }) {
  const st = useStore();
  const src = st.p.groups.find(g => g.id === id) || base;
  const [g, setG] = useState<GroupDef>(() => src ? { ...JSON.parse(JSON.stringify(src)), id: id || 'g' + Date.now().toString(36), name: id ? src.name : 'Copy of ' + src.name } : { id: 'g' + Date.now().toString(36), name: 'Group ' + (st.p.groups.length + 1), summaries: false, keys: [{ field: 'resources', desc: false }] });
  const opts = fieldOptions(st.p);
  const ok = () => {
    const clean = { ...g, name: g.name.trim() || 'Group', keys: g.keys.filter(k => k.field) };
    if (!clean.keys.length) { S().notify('Choose a field to group by.', true); return false; }
    st.commit({ ...st.p, groups: st.p.groups.some(x => x.id === clean.id) ? st.p.groups.map(x => (x.id === clean.id ? clean : x)) : st.p.groups.concat(clean) });
    S().setUI({ group: clean.id });
  };
  return (
    <Modal title={'Group: ' + g.name} wide onOk={ok} okLabel="Save and Apply">
      <F label="Name"><input className="inp" value={g.name} onChange={e => setG({ ...g, name: e.target.value })} /></F>
      <table className="mini"><thead><tr><th style={{ width: 90 }} /><th>Field Name</th><th style={{ width: 140 }}>Order</th><th style={{ width: 40 }} /></tr></thead><tbody>
        {g.keys.map((k, i) => <tr key={i}>
          <td>{i === 0 ? 'Group By' : 'Then By'}</td>
          <td><select className="inp" value={k.field} onChange={e => setG({ ...g, keys: g.keys.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>{opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></td>
          <td><select className="inp" value={k.desc ? 'd' : 'a'} onChange={e => setG({ ...g, keys: g.keys.map((x, j) => (j === i ? { ...x, desc: e.target.value === 'd' } : x)) })}><option value="a">Ascending</option><option value="d">Descending</option></select></td>
          <td><button type="button" className="icon-btn" onClick={() => setG({ ...g, keys: g.keys.filter((_, j) => j !== i) })}><Icon name="x" /></button></td>
        </tr>)}
      </tbody></table>
      <div className="row-btns"><button type="button" className="btn" disabled={g.keys.length >= 10} onClick={() => setG({ ...g, keys: g.keys.concat({ field: 'priority', desc: false }) })}><Icon name="plus" />Then By</button>
        <label className="chk"><input type="checkbox" checked={g.summaries} onChange={e => setG({ ...g, summaries: e.target.checked })} />Show phases</label></div>
      <p className="hint">Group headings total work, cost and dates of their tasks. Group colours follow the outline of the groups.</p>
    </Modal>
  );
}

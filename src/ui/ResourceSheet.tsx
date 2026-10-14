// People view view: one row per resource, edited in place.
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Resource, ResourceType } from '../engine/model';
import { addResources, deleteResources, updateResource } from '../engine/ops';
import { S, useStore } from './store';
import { money } from './columns';

type Col = { key: string; label: string; width: number; align?: 'right'; get: (r: Resource) => string; set?: (r: Resource, v: string) => Partial<Resource> | string };

const num = (v: string) => { const n = parseFloat(v.replace(/[^\d.-]/g, '')); return isFinite(n) ? n : NaN; };

export default function ResourceSheet() {
  const st = useStore();
  const { p, s } = st;
  const ctx = { p, s, outlineNumber: false };
  const [edit, setEdit] = useState<{ row: number; col: string; text: string } | null>(null);
  const [cell, setCell] = useState<{ row: number; col: string }>({ row: 0, col: 'name' });
  const ref = useRef<HTMLDivElement>(null);
  const after = useRef<{ row: number; col: string } | null>(null);
  const cancel = useRef(false);
  const cal = (id: string) => p.calendars.find(c => c.id === id)?.name || id;
  const cols: Col[] = [
    { key: 'name', label: 'Name', width: 200, get: r => r.name, set: (_, v) => (v.trim() ? { name: v.trim() } : 'A resource needs a name.') },
    { key: 'type', label: 'Type', width: 80, get: r => r.type, set: (_, v) => { const t = (['Work', 'Material', 'Cost'] as ResourceType[]).find(x => x.toLowerCase().startsWith(v.trim().toLowerCase())); return t ? { type: t } : 'Type is Work, Material or Cost.'; } },
    { key: 'materialLabel', label: 'Unit', width: 90, get: r => r.materialLabel, set: (_, v) => ({ materialLabel: v }) },
    { key: 'initials', label: 'Initials', width: 64, get: r => r.initials, set: (_, v) => ({ initials: v }) },
    { key: 'group', label: 'Group', width: 120, get: r => r.group, set: (_, v) => ({ group: v }) },
    { key: 'maxUnits', label: 'Capacity', width: 80, align: 'right', get: r => (r.type === 'Work' ? Math.round(r.maxUnits * 100) + '%' : ''), set: (_, v) => { const n = num(v); return isFinite(n) && n >= 0 ? { maxUnits: n / 100 } : 'Enter a percentage.'; } },
    { key: 'stdRate', label: 'Rate', width: 100, align: 'right', get: r => (r.type === 'Cost' ? '' : money(ctx, r.stdRate) + (r.type === 'Work' ? '/hr' : '')), set: (_, v) => { const n = num(v); return isFinite(n) && n >= 0 ? { stdRate: n } : 'Enter a rate.'; } },
    { key: 'ovtRate', label: 'Overtime rate', width: 100, align: 'right', get: r => (r.type === 'Work' ? money(ctx, r.ovtRate) + '/hr' : ''), set: (_, v) => { const n = num(v); return isFinite(n) && n >= 0 ? { ovtRate: n } : 'Enter a rate.'; } },
    { key: 'costPerUse', label: 'Cost per use', width: 90, align: 'right', get: r => (r.type === 'Cost' ? '' : money(ctx, r.costPerUse)), set: (_, v) => { const n = num(v); return isFinite(n) && n >= 0 ? { costPerUse: n } : 'Enter an amount.'; } },
    { key: 'calendar', label: 'Calendar', width: 120, get: r => (r.type === 'Work' ? cal(r.calendar) : ''), set: (_, v) => { const c = p.calendars.find(x => x.name.toLowerCase() === v.trim().toLowerCase() || x.id === v); return c ? { calendar: c.id } : 'No calendar named ' + v; } }
  ];
  const rows = p.resources;
  const total = rows.length + 20;
  const commit = (row: number, col: Col, value: string) => {
    const set = col.set;
    if (!set) return;
    let res = rows[row];
    let pp = p;
    if (!res) {
      if (!value.trim()) return;
      const made = addResources(pp, 1, { name: col.key === 'name' ? value.trim() : 'Resource ' + (rows.length + 1) });
      pp = made.p; res = pp.resources[pp.resources.length - 1];
      if (col.key === 'name') { S().commit(pp); return; }
    }
    const patch = set(res, value);
    if (typeof patch === 'string') { S().notify(patch, true); return; }
    S().commit(updateResource(pp, res.uid, patch));
  };
  const key = (e: KeyboardEvent) => {
    if (edit) return;
    const ci = cols.findIndex(c => c.key === cell.col);
    if (e.key === 'ArrowDown') { e.preventDefault(); setCell({ ...cell, row: Math.min(total - 1, cell.row + 1) }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCell({ ...cell, row: Math.max(0, cell.row - 1) }); }
    else if (e.key === 'ArrowRight' || e.key === 'Tab') { e.preventDefault(); setCell({ ...cell, col: cols[Math.min(cols.length - 1, ci + 1)].key }); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setCell({ ...cell, col: cols[Math.max(0, ci - 1)].key }); }
    else if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); const r = rows[cell.row]; setEdit({ ...cell, text: r ? cols[ci].get(r) : '' }); }
    else if (e.key === 'Delete') { e.preventDefault(); const r = rows[cell.row]; if (r) { S().commit(deleteResources(p, [r.uid])); S().notify('Deleted ' + r.name + ' and removed it from its tasks.'); } }
    else if (e.key === 'Insert') { e.preventDefault(); S().open('resource', { create: 'Work' }); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setEdit({ ...cell, text: e.key }); }
  };
  const tableW = 40 + 40 + cols.reduce((a, c) => a + c.width, 0);
  return (
    <div className="rsheet">
      <div className="thead"><div className="thead-in" style={{ width: tableW }}>
        <div className="th rh" style={{ width: 40 }} /><div className="th" style={{ width: 40 }} title="Indicators" />
        {cols.map(c => <div key={c.key} className={'th' + (c.align ? ' a-right' : '')} style={{ width: c.width }}>{c.label}</div>)}
      </div></div>
      <div className="tbody" ref={ref} tabIndex={0} onKeyDown={key}>
        <div className="tbody-in" style={{ height: total * 24, width: tableW }}>
          {Array.from({ length: total }, (_, i) => {
            const r = rows[i];
            const over = r && s.overallocated.has(r.uid);
            return (
              <div key={r ? r.uid : 'b' + i} className={'tr' + (st.resSel.includes(r?.uid ?? -1) ? ' sel' : '') + (over ? ' over' : '')} style={{ top: i * 24, width: tableW }}>
                <div className="td rh" style={{ width: 40 }} onMouseDown={() => { setCell({ row: i, col: cell.col }); if (r) S().set({ resSel: [r.uid] }); }}>{r ? i + 1 : ''}</div>
                <div className="td a-center" style={{ width: 40 }} title={over ? 'This resource is overallocated: it has more work than its maximum units at some time.' : ''}>{over ? '⚠' : ''}</div>
                {cols.map(c => {
                  const active = cell.row === i && cell.col === c.key;
                  const ed = edit && edit.row === i && edit.col === c.key;
                  return (
                    <div key={c.key} className={'td' + (active ? ' act' : '') + (c.align ? ' a-right' : '')} style={{ width: c.width }}
                      onMouseDown={e => { e.preventDefault(); setCell({ row: i, col: c.key }); if (r) S().set({ resSel: [r.uid] }); ref.current?.focus(); }}
                      onDoubleClick={() => { if (r) S().open('resource', { uid: r.uid }); }}>
                      {ed ? <input className="cell-edit" autoFocus defaultValue={edit!.text}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); after.current = { row: e.key === 'Enter' ? i + 1 : i, col: e.key === 'Tab' ? cols[Math.min(cols.length - 1, cols.indexOf(c) + 1)].key : c.key }; (e.target as HTMLInputElement).blur(); }
                          if (e.key === 'Escape') { cancel.current = true; (e.target as HTMLInputElement).blur(); }
                        }}
                        onBlur={e => {
                          if (!cancel.current) commit(i, c, e.target.value);
                          cancel.current = false;
                          setEdit(null);
                          if (after.current) { setCell(after.current); after.current = null; ref.current?.focus(); }
                        }} />: r ? c.get(r) : ''}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

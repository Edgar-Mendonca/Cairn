// Balancing options options, Level Resource, WBS numbering and Assignment Information.
import { useState } from 'react';
import { CONTOUR_NAMES, type Contour, type LevelOptions, type WbsLevel, type WbsMask } from '../engine/model';
import { levelResources, clearLeveling } from '../engine/level';
import { updateAssignment } from '../engine/ops';
import { wbsCode } from '../engine/schedule';
import { formatDuration, parseDuration } from '../engine/duration';
import { atDay, fmtDate, parseDateText } from '../engine/time';
import { phasedAssignment, spreadOf, buckets } from '../engine/timephase';
import { F, Modal } from './Modal';
import { DateInput } from './DatePicker';
import { S, useStore } from './store';
import { money } from './columns';
import Icon from './Icon';

export function BalancingOptionsDialog() {
  const st = useStore();
  const [o, setO] = useState<LevelOptions>(() => ({ ...st.p.leveling }));
  const [range, setRange] = useState(o.from != null || o.to != null);
  const [from, setFrom] = useState(o.from != null ? fmtDate(o.from, { format: st.p.settings.dateFormat }) : fmtDate(st.s.start, { format: st.p.settings.dateFormat }));
  const [to, setTo] = useState(o.to != null ? fmtDate(o.to, { format: st.p.settings.dateFormat }) : fmtDate(st.s.finish, { format: st.p.settings.dateFormat }));
  const opts = (): LevelOptions => {
    const a = parseDateText(from, st.p.settings.dateFormat), b = parseDateText(to, st.p.settings.dateFormat);
    return { ...o, from: range && a ? atDay(a.day) : null, to: range && b ? atDay(b.day + 1) : null };
  };
  const save = () => st.commit({ ...st.p, leveling: opts() });
  const levelNow = () => {
    const options = opts();
    const r = levelResources({ ...st.p, leveling: options }, { options });
    st.commit({ ...r.p, leveling: options });
    S().notify(r.unresolved.length ? 'Balancing moved ' + r.moved + ' task(s). Could not resolve: ' + r.unresolved.join(', ') + '.' : 'Balancing moved ' + r.moved + ' task(s). No resource is overallocated.', r.unresolved.length > 0);
    S().close();
  };
  return (
    <Modal title="Balancing options" wide onOk={save} extra={<><button type="button" className="btn" onClick={() => { st.commit(clearLeveling(st.p)); S().notify('Balancing cleared'); }}>Clear Balancing…</button><button type="button" className="btn primary" onClick={levelNow}>Balance workload</button></>}>
      <h3>Balancing range</h3>
      <label className="chk"><input type="radio" checked={!range} onChange={() => setRange(false)} />Level entire project</label>
      <label className="chk"><input type="radio" checked={range} onChange={() => setRange(true)} />Level only tasks between</label>
      {range && <div className="grid2"><DateInput value={from} format={st.p.settings.dateFormat} defaultMinute={0} onChange={setFrom} /><DateInput value={to} format={st.p.settings.dateFormat} defaultMinute={0} onChange={setTo} /></div>}
      <h3>Resolving overallocations</h3>
      <div className="grid2">
        <F label="Balancing order"><select className="inp" value={o.order} onChange={e => setO({ ...o, order: e.target.value as LevelOptions['order'] })}><option value="id">ID Only</option><option value="standard">Standard</option><option value="priority">Priority, Standard</option></select></F>
        <F label="Look for overallocations on a"><select className="inp" value={o.basis} onChange={e => setO({ ...o, basis: e.target.value as LevelOptions['basis'] })}><option value="minute">Minute by Minute basis</option><option value="day">Day by Day basis</option><option value="week">Week by Week basis</option></select></F>
      </div>
      <label className="chk"><input type="checkbox" checked={o.clearFirst} onChange={e => setO({ ...o, clearFirst: e.target.checked })} />Clear balancing values before balancing</label>
      <label className="chk"><input type="checkbox" checked={o.withinSlack} onChange={e => setO({ ...o, withinSlack: e.target.checked })} />Level only within available slack (the project finish date does not move)</label>
      <label className="chk"><input type="checkbox" checked={o.canSplit} disabled onChange={e => setO({ ...o, canSplit: e.target.checked })} />Balancing can create splits in remaining work (planned)</label>
      <p className="hint">Standard order delays tasks by start date, then priority (0–1000, set in Task details), then slack. Priority, Standard looks at priority first. Tasks that have started, manually scheduled tasks and Must Start/Finish On tasks are not moved.</p>
    </Modal>
  );
}

export function LevelResourceDialog() {
  const st = useStore();
  const [sel, setSel] = useState<number[]>(() => [...st.s.overallocated]);
  const level = () => {
    const uids = st.s.rows.filter(r => !r.summary && r.task.assignments.some(a => sel.includes(a.res))).map(r => r.task.uid);
    const r = levelResources(st.p, { uids });
    st.commit(r.p);
    S().notify('Balancing moved ' + r.moved + ' task(s).' + (r.unresolved.length ? ' Still overallocated: ' + r.unresolved.join(', ') : ''), r.unresolved.length > 0);
  };
  return (
    <Modal title="Balance one person" onOk={level} okLabel="Level Now">
      <p>Select the resources to level:</p>
      <ul className="collist">{st.p.resources.filter(r => r.type === 'Work').map(r => <li key={r.uid}><label className="chk"><input type="checkbox" checked={sel.includes(r.uid)} onChange={e => setSel(e.target.checked ? sel.concat(r.uid) : sel.filter(x => x !== r.uid))} />{r.name}</label>{st.s.overallocated.has(r.uid) && <span className="bad">overallocated</span>}</li>)}</ul>
    </Modal>
  );
}

export function WbsCodeDialog({ renumber }: { renumber?: boolean }) {
  const st = useStore();
  const [m, setM] = useState<WbsMask>(() => st.p.wbsMask ? JSON.parse(JSON.stringify(st.p.wbsMask)) : { prefix: '', levels: [{ seq: 'num', length: 0, sep: '.' }, { seq: 'num', length: 0, sep: '.' }, { seq: 'num', length: 0, sep: '.' }] });
  const [useMask, setUseMask] = useState(!!st.p.wbsMask);
  const [clearTyped, setClearTyped] = useState(!!renumber);
  const upd = (i: number, patch: Partial<WbsLevel>) => setM({ ...m, levels: m.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const typed = st.p.tasks.filter(t => t.wbsCode).length;
  const ok = () => st.commit({ ...st.p, wbsMask: useMask ? m : null, tasks: clearTyped ? st.p.tasks.map(t => (t.wbsCode ? (({ wbsCode: _w, ...r }) => r)(t) : t)) : st.p.tasks });
  return (
    <Modal title="WBS numbering" wide onOk={ok}>
      <label className="chk"><input type="checkbox" checked={useMask} onChange={e => setUseMask(e.target.checked)} />Use a code mask (otherwise WBS codes are the outline numbers)</label>
      {useMask && <>
        <F label="Project code prefix"><input className="inp sm" value={m.prefix} onChange={e => setM({ ...m, prefix: e.target.value })} /></F>
        <F label="Code preview"><input className="inp" disabled value={wbsCode(m, [1, 2, 3, 4].slice(0, Math.max(1, m.levels.length)))} /></F>
        <table className="mini"><thead><tr><th>Level</th><th>Sequence</th><th>Length</th><th>Separator</th><th /></tr></thead><tbody>
          {m.levels.map((l, i) => <tr key={i}><td>{i + 1}</td>
            <td><select className="inp" value={l.seq} onChange={e => upd(i, { seq: e.target.value as WbsLevel['seq'] })}><option value="num">Numbers (ordered)</option><option value="upper">Uppercase Letters (ordered)</option><option value="lower">Lowercase Letters (ordered)</option></select></td>
            <td><select className="inp" value={l.length} onChange={e => upd(i, { length: +e.target.value })}><option value={0}>Any</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></td>
            <td><select className="inp" value={l.sep} onChange={e => upd(i, { sep: e.target.value })}>{['.', '-', '+', '/'].map(x => <option key={x}>{x}</option>)}</select></td>
            <td><button type="button" className="icon-btn" onClick={() => setM({ ...m, levels: m.levels.filter((_, j) => j !== i) })}><Icon name="x" /></button></td></tr>)}
        </tbody></table>
        <button type="button" className="btn" onClick={() => setM({ ...m, levels: m.levels.concat({ seq: 'num', length: 0, sep: '.' }) })}><Icon name="plus" />Add level</button>
      </>}
      <label className="chk"><input type="checkbox" checked={clearTyped} disabled={!typed} onChange={e => setClearTyped(e.target.checked)} />Renumber: replace {typed} WBS code{typed === 1 ? '' : 's'} typed by hand</label>
      <p className="hint">WBS codes update as you add, move and indent tasks. Type a code in the WBS column to fix it for one task.</p>
    </Modal>
  );
}

export function AssignmentInfoDialog({ uid, res: res0 }: { uid: number; res?: number }) {
  const st = useStore();
  const { p, s } = st;
  const r = s.byUid.get(uid);
  const list = r?.task.assignments || [];
  const [res, setRes] = useState(res0 ?? list[0]?.res);
  const a = list.find(x => x.res === res);
  const resource = p.resources.find(x => x.uid === res);
  const [f, setF] = useState(() => ({
    units: a && resource?.type === 'Work' ? Math.round(a.units * 100) + '%' : String(a?.units ?? ''), work: a ? formatDuration({ minutes: a.work, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings) : '',
    contour: (a?.contour || 'flat') as Contour, table: a?.rateTable || 0, ovt: a?.ovt ? formatDuration({ minutes: a.ovt, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings) : '0h',
    cost: String(a?.cost ?? 0)
  }));
  if (!r || !a || !resource) return <Modal title="Assignment details" noOk cancelLabel="Close"><p>{r ? 'This task has no resources assigned. Use Plan › Assign people.' : 'Select a task.'}</p></Modal>;
  const switchRes = (id: number) => { setRes(id); const b = list.find(x => x.res === id)!; const rr = p.resources.find(x => x.uid === id)!; setF({ units: rr.type === 'Work' ? Math.round(b.units * 100) + '%' : String(b.units), work: formatDuration({ minutes: b.work, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings), contour: b.contour || 'flat', table: b.rateTable || 0, ovt: b.ovt ? formatDuration({ minutes: b.ovt, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings) : '0h', cost: String(b.cost) }); };
  const ok = () => {
    const patch: Parameters<typeof updateAssignment>[3] = { contour: f.contour, rateTable: f.table };
    if (resource.type === 'Work') {
      const u = parseFloat(f.units);
      if (!(u >= 0)) { S().notify('Enter units such as 50%.', true); return false; }
      patch.units = u / 100;
      const w = parseDuration(f.work, p.settings, p.settings.workUnit);
      if (!w) { S().notify('Enter work such as 40h.', true); return false; }
      if (Math.abs(w.minutes - a.work) > 0.5) patch.work = w.minutes;
      const o = parseDuration(f.ovt, p.settings, p.settings.workUnit);
      if (o) patch.ovt = o.minutes;
    } else if (resource.type === 'Material') patch.units = Math.max(0, parseFloat(f.units) || 0);
    else patch.cost = parseFloat(f.cost.replace(/[^\d.-]/g, '')) || 0;
    const out = updateAssignment(p, uid, res!, patch);
    if (out.error) { S().notify(out.error, true); return false; }
    st.commit(out.p);
  };
  // Work by week with this contour, as a preview.
  const bk = buckets('week', r.start, r.finish + 1, p.gantt.timescale.weekStart).slice(0, 26);
  const sp = spreadOf(r, s, p);
  const prev = bk.map(b => phasedAssignment(r, sp, p, resource, { ...a, contour: f.contour }, b.start, b.end).work);
  const max = Math.max(1, ...prev);
  return (
    <Modal title="Assignment details" wide onOk={ok}>
      {list.length > 1 && <F label="Resource"><select className="inp" value={res} onChange={e => switchRes(+e.target.value)}>{list.map(x => <option key={x.res} value={x.res}>{p.resources.find(q => q.uid === x.res)?.name}</option>)}</select></F>}
      <div className="grid2">
        <F label="Task"><input className="inp" disabled value={r.task.name} /></F>
        <F label="Resource"><input className="inp" disabled value={resource.name + ' (' + resource.type + ')'} /></F>
        {resource.type !== 'Cost' && <F label={resource.type === 'Work' ? 'Units' : 'Quantity'}><input className="inp" value={f.units} onChange={e => setF({ ...f, units: e.target.value })} /></F>}
        {resource.type === 'Work' && <F label="Work"><input className="inp" value={f.work} onChange={e => setF({ ...f, work: e.target.value })} /></F>}
        {resource.type === 'Cost' && <F label="Cost"><input className="inp" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} /></F>}
        {resource.type === 'Work' && <F label="Work contour"><select className="inp" value={f.contour} onChange={e => setF({ ...f, contour: e.target.value as Contour })}>{Object.entries(CONTOUR_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>}
        {resource.type === 'Work' && <F label="Overtime work"><input className="inp" value={f.ovt} onChange={e => setF({ ...f, ovt: e.target.value })} /></F>}
        {resource.type !== 'Cost' && <F label="Cost rate table"><select className="inp" value={f.table} onChange={e => setF({ ...f, table: +e.target.value })}>{['A', 'B', 'C', 'D', 'E'].map((t, i) => <option key={t} value={i}>{t}</option>)}</select></F>}
        <F label="Start"><input className="inp" disabled value={fmtDate(r.start, { time: true, format: p.settings.dateFormat })} /></F>
        <F label="Finish"><input className="inp" disabled value={fmtDate(r.finish, { time: true, format: p.settings.dateFormat })} /></F>
        <F label="Cost"><input className="inp" disabled value={money({ p }, resource.type === 'Cost' ? a.cost : a.work / 60 * resource.stdRate + resource.costPerUse)} /></F>
      </div>
      {resource.type === 'Work' && bk.length > 1 && <div className="contour-prev"><span className="muted">Work per week with this contour</span><svg width={Math.min(560, bk.length * 22)} height={60}>{prev.map((v, i) => <rect key={i} x={i * 22 + 2} y={56 - v / max * 52} width={18} height={v / max * 52} rx={2} fill="var(--series-1)"><title>{formatDuration({ minutes: v, unit: 'h', elapsed: false, estimated: false }, p.settings)}</title></rect>)}</svg></div>}
      <p className="hint">Work contours shape how the work spreads over the task (shown in the usage views and resource graph); the task's dates do not change. Overtime work is charged at the resource's overtime rate.</p>
    </Modal>
  );
}

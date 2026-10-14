// The details form shown under a view (View › Details): the selected task's main fields with its resources and
// predecessors, edited in place. Under resource views it shows the Resource Form with the resource's tasks.
import { useEffect, useState } from 'react';
import { CONSTRAINT_NAMES, TASK_TYPE_NAMES, type LinkType, type TaskType } from '../../engine/model';
import { editCell, formatResourceNames, updateResource } from '../../engine/ops';
import { schedule } from '../../engine/schedule';
import { formatDuration, formatShort } from '../../engine/duration';
import { fmtDate } from '../../engine/time';
import { S, useStore } from '../store';
import { money } from '../columns';
import Icon from '../Icon';

const RES_VIEWS = new Set(['resourceSheet', 'resourceUsage', 'resourceGraph', 'teamPlanner']);

export function TaskForm() {
  const st = useStore();
  if (RES_VIEWS.has(st.ui.view)) return <ResourceForm />;
  return <TaskFormInner key={st.sel[0] ?? 'none'} uid={st.sel.find(u => u > 0)} />;
}

function TaskFormInner({ uid }: { uid?: number }) {
  const st = useStore();
  const { p, s } = st;
  const r = uid != null ? s.byUid.get(uid) : undefined;
  const t = r?.task;
  const durText = r ? formatDuration({ minutes: r.duration, unit: r.summary ? p.settings.durationUnit : r.task.durUnit, elapsed: r.task.elapsed, estimated: r.task.estimated }, p.settings) : '';
  const init = () => ({
    name: t?.name || '', duration: durText, start: r ? fmtDate(r.start, { time: true, format: p.settings.dateFormat }) : '', finish: r ? fmtDate(r.finish, { time: true, format: p.settings.dateFormat }) : '',
    percent: String(Math.round(r?.percent || 0)), type: (t?.type || 'FixedUnits') as TaskType, effort: !!t?.effortDriven, mode: t?.mode || 'auto',
    res: (t?.assignments || []).map(a => { const x = p.resources.find(q => q.uid === a.res); return { name: x?.name || '', units: x?.type === 'Work' ? Math.round(a.units * 100) + '%' : x?.type === 'Cost' ? String(a.cost) : String(a.units), work: x?.type === 'Work' ? formatDuration({ minutes: a.work, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings) : '' }; }),
    preds: (t?.preds || []).map(l => ({ id: String(s.byUid.get(l.pred)?.id ?? ''), type: l.type, lag: l.lag ? (l.lag > 0 ? '' : '-') + (l.lagPercent ? Math.abs(l.lag) + '%' : formatShort(Math.abs(l.lag), l.lagUnit, l.lagElapsed, p.settings)) : '0d' }))
  });
  const [f, setF] = useState(init);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setF(init()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [s]);
  const set = (patch: Partial<ReturnType<typeof init>>) => { setF({ ...f, ...patch }); setDirty(true); };
  if (!r || !t) return <div className="tform empty"><Icon name="forms" size={28} /><span>Select a task to see its details here.</span></div>;
  const rows = s.rows.filter(x => !x.group);
  const nav = (d: number) => { const k = r.i + d; const n = s.rows[k]; if (n) S().set({ sel: [n.task.uid] }); };
  const ok = () => {
    let pp = st.p;
    const errs: string[] = [];
    const run = (field: Parameters<typeof editCell>[3], text: string, before: string) => { if (text === before) return; const out = editCell(pp, schedule(pp), t.uid, field, text); if (out.error) errs.push(out.error); else pp = out.p; };
    run('name', f.name, t.name);
    if (f.mode !== t.mode) run('mode', f.mode === 'manual' ? 'Pinned' : 'Auto', '');
    run('type', f.type, t.type);
    if (f.effort !== t.effortDriven) run('effortDriven', String(f.effort), '');
    if (!r.summary) run('duration', f.duration, durText);
    if (f.start !== fmtDate(r.start, { time: true, format: p.settings.dateFormat })) run('start', f.start, '');
    if (!r.summary && f.finish !== fmtDate(r.finish, { time: true, format: p.settings.dateFormat })) run('finish', f.finish, '');
    const resText = f.res.filter(x => x.name.trim()).map(x => x.name.trim() + (x.units ? '[' + x.units + ']' : '')).join(',');
    if (resText !== formatResourceNames(st.p, t)) run('resources', resText, '\u0000');
    const predText = f.preds.filter(x => x.id.trim()).map(x => x.id.trim() + (x.type !== 'FS' || (x.lag && parseFloat(x.lag)) ? x.type : '') + (x.lag && parseFloat(x.lag) ? (x.lag.trim().startsWith('-') ? '' : '+') + x.lag.trim() : '')).join(',');
    run('preds', predText, t.preds.length ? '\u0000' : '');
    // Work typed per resource (Fixed Units: changes the duration; as in the details form).
    run('percent', f.percent, String(Math.round(r.percent)));
    if (errs.length) { S().notify(errs[0], true); return; }
    st.commit(pp);
    setDirty(false);
  };
  return (
    <div className="tform">
      <div className="tf-row">
        <label className="tf-f wide">Name<input className="inp" value={f.name} onChange={e => set({ name: e.target.value })} /></label>
        <label className="tf-f">Duration<input className="inp" value={f.duration} disabled={r.summary} onChange={e => set({ duration: e.target.value })} /></label>
        <label className="chk"><input type="checkbox" checked={f.effort} disabled={f.type === 'FixedWork'} onChange={e => set({ effort: e.target.checked })} />Effort driven</label>
        <span className="tf-mode">
          <label className="chk"><input type="radio" checked={f.mode === 'manual'} onChange={() => set({ mode: 'manual' })} />Pinned</label>
          <label className="chk"><input type="radio" checked={f.mode === 'auto'} onChange={() => set({ mode: 'auto' })} />Auto Scheduled</label>
        </span>
        <span className="sp" />
        <button className="btn" onClick={() => nav(-1)} disabled={r.i <= 0}>Previous</button>
        <button className="btn" onClick={() => nav(1)} disabled={r.i >= rows.length - 1}>Next</button>
        <button className="btn primary" disabled={!dirty} onClick={ok}>OK</button>
        <button className="btn" disabled={!dirty} onClick={() => { setF(init()); setDirty(false); }}>Cancel</button>
      </div>
      <div className="tf-row">
        <label className="tf-f">Start<input className="inp" value={f.start} onChange={e => set({ start: e.target.value })} /></label>
        <label className="tf-f">Finish<input className="inp" value={f.finish} disabled={r.summary} onChange={e => set({ finish: e.target.value })} /></label>
        <label className="tf-f">Task type<select className="inp" value={f.type} onChange={e => set({ type: e.target.value as TaskType, effort: e.target.value === 'FixedWork' ? true : f.effort })}>{Object.entries(TASK_TYPE_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="tf-f sm">% Complete<input className="inp" value={f.percent} onChange={e => set({ percent: e.target.value })} /></label>
        <span className="tf-info muted">ID {r.id} · {CONSTRAINT_NAMES[t.constraint]}{t.constraintDate != null ? ' ' + fmtDate(t.constraintDate, { format: p.settings.dateFormat }) : ''} · Total slack {formatDuration({ minutes: r.totalSlack, unit: 'd', elapsed: false, estimated: false }, p.settings)}{r.critical ? ' · Critical' : ''}</span>
      </div>
      <div className="tf-grids">
        <div className="tf-grid">
          <table className="mini"><thead><tr><th style={{ width: 40 }}>ID</th><th>Resource Name</th><th style={{ width: 90 }}>Units</th><th style={{ width: 90 }}>Work</th><th style={{ width: 26 }} /></tr></thead><tbody>
            {f.res.map((x, k) => <tr key={k}>
              <td className="muted">{p.resources.findIndex(q => q.name === x.name) + 1 || ''}</td>
              <td><input className="inp" list="tf-res" value={x.name} onChange={e => set({ res: f.res.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)) })} /></td>
              <td><input className="inp" value={x.units} onChange={e => set({ res: f.res.map((y, j) => (j === k ? { ...y, units: e.target.value } : y)) })} /></td>
              <td className="muted">{x.work}</td>
              <td><button className="icon-btn" onClick={() => set({ res: f.res.filter((_, j) => j !== k) })}><Icon name="x" /></button></td>
            </tr>)}
            <tr><td /><td colSpan={4}><button className="linkbtn" onClick={() => set({ res: f.res.concat({ name: '', units: '100%', work: '' }) })}>+ Add resource</button></td></tr>
          </tbody></table>
          <datalist id="tf-res">{p.resources.map(x => <option key={x.uid} value={x.name} />)}</datalist>
        </div>
        <div className="tf-grid">
          <table className="mini"><thead><tr><th style={{ width: 50 }}>ID</th><th>Predecessor Name</th><th style={{ width: 70 }}>Type</th><th style={{ width: 70 }}>Lag</th><th style={{ width: 26 }} /></tr></thead><tbody>
            {f.preds.map((x, k) => <tr key={k}>
              <td><input className="inp" value={x.id} onChange={e => set({ preds: f.preds.map((y, j) => (j === k ? { ...y, id: e.target.value } : y)) })} /></td>
              <td className="muted">{s.rows[+x.id - 1]?.task.name || ''}</td>
              <td><select className="inp" value={x.type} onChange={e => set({ preds: f.preds.map((y, j) => (j === k ? { ...y, type: e.target.value as LinkType } : y)) })}>{['FS', 'SS', 'FF', 'SF'].map(v => <option key={v}>{v}</option>)}</select></td>
              <td><input className="inp" value={x.lag} onChange={e => set({ preds: f.preds.map((y, j) => (j === k ? { ...y, lag: e.target.value } : y)) })} /></td>
              <td><button className="icon-btn" onClick={() => set({ preds: f.preds.filter((_, j) => j !== k) })}><Icon name="x" /></button></td>
            </tr>)}
            <tr><td /><td colSpan={4}><button className="linkbtn" onClick={() => set({ preds: f.preds.concat({ id: '', type: 'FS', lag: '0d' }) })}>+ Add predecessor</button></td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

function ResourceForm() {
  const st = useStore();
  const { p, s } = st;
  const res = p.resources.find(r => r.uid === st.resSel[0]);
  const [f, setF] = useState({ name: '', initials: '', maxUnits: '', stdRate: '', ovtRate: '', group: '' });
  useEffect(() => { if (res) setF({ name: res.name, initials: res.initials, maxUnits: Math.round(res.maxUnits * 100) + '%', stdRate: String(res.stdRate), ovtRate: String(res.ovtRate), group: res.group }); }, [res]);
  if (!res) return <div className="tform empty"><Icon name="resources" size={28} /><span>Select a resource to see its details here.</span></div>;
  const tasks = s.rows.filter(r => !r.summary && r.task.assignments.some(a => a.res === res.uid));
  const ok = () => st.commit(updateResource(p, res.uid, { name: f.name.trim() || res.name, initials: f.initials, group: f.group, maxUnits: Math.max(0, parseFloat(f.maxUnits) / 100 || 0), stdRate: Math.max(0, parseFloat(f.stdRate) || 0), ovtRate: Math.max(0, parseFloat(f.ovtRate) || 0) }));
  return (
    <div className="tform">
      <div className="tf-row">
        <label className="tf-f wide">Name<input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="tf-f sm">Initials<input className="inp" value={f.initials} onChange={e => setF({ ...f, initials: e.target.value })} /></label>
        <label className="tf-f sm">Max units<input className="inp" value={f.maxUnits} onChange={e => setF({ ...f, maxUnits: e.target.value })} /></label>
        <label className="tf-f sm">Std. rate<input className="inp" value={f.stdRate} onChange={e => setF({ ...f, stdRate: e.target.value })} /></label>
        <label className="tf-f sm">Ovt. rate<input className="inp" value={f.ovtRate} onChange={e => setF({ ...f, ovtRate: e.target.value })} /></label>
        <label className="tf-f">Group<input className="inp" value={f.group} onChange={e => setF({ ...f, group: e.target.value })} /></label>
        <span className="sp" />
        <button className="btn primary" onClick={ok}>OK</button>
      </div>
      <div className="tf-grid">
        <table className="mini"><thead><tr><th style={{ width: 50 }}>ID</th><th>Task Name</th><th>Units</th><th>Work</th><th>Start</th><th>Finish</th><th>Cost</th></tr></thead><tbody>
          {tasks.map(r => { const a = r.task.assignments.find(x => x.res === res.uid)!; return <tr key={r.task.uid} onDoubleClick={() => S().open('assignmentInfo', { uid: r.task.uid, res: res.uid })}>
            <td>{r.id}</td><td>{r.task.name}</td><td>{res.type === 'Work' ? Math.round(a.units * 100) + '%' : a.units}</td>
            <td>{formatDuration({ minutes: a.work, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings)}</td>
            <td>{fmtDate(r.start, { format: p.settings.dateFormat })}</td><td>{fmtDate(r.finish, { format: p.settings.dateFormat })}</td>
            <td>{money({ p }, res.type === 'Cost' ? a.cost : a.work / 60 * res.stdRate + res.costPerUse)}</td>
          </tr>; })}
          {!tasks.length && <tr><td colSpan={7} className="muted">No tasks assigned.</td></tr>}
        </tbody></table>
      </div>
    </div>
  );
}

// Full-screen pages: start a new plan (blank, example or import), plans kept in this browser, and print.
import { useMemo, useState, type ReactNode } from 'react';
import { deletePlan, listPlans, newBlank, newFromTemplate, S, switchPlan, useStore } from './store';
import { buildTemplate, TEMPLATES, type TemplateInfo } from '../engine/templates';
import { schedule } from '../engine/schedule';
import { todayMinutes } from '../engine/time';
import { openFile } from './actions';
import { DEFAULT_SETUP, layoutPages, pageSize, printPages, PrintPages, type PageSetup } from './print';
import { DateInput } from './DatePicker';
import { atDay, parseDateText } from '../engine/time';
import { GANTT_VIEWS } from './store';
import Icon from './Icon';
import { fmtDate } from '../engine/time';
import iconUrl from '../assets/cairn-icon.svg';

const PAGES: [string, string, string][] = [['new', 'New plan', 'plus'], ['open', 'Your plans', 'clock'], ['print', 'Print', 'printer']];

const SETUP_KEY = 'cairn.pagesetup';
function loadSetup(): PageSetup { try { return { ...DEFAULT_SETUP, ...JSON.parse(localStorage.getItem(SETUP_KEY) || '{}'), from: null, to: null }; } catch { return { ...DEFAULT_SETUP }; } }

// File › Print: page setup on the left, a preview of the pages on the right.
function PrintPage() {
  const st = useStore();
  const [o, setO] = useState<PageSetup>(loadSetup);
  const [pg, setPg] = useState(0);
  const [from, setFrom] = useState(fmtDate(st.s.start, { format: st.p.settings.dateFormat }));
  const [to, setTo] = useState(fmtDate(st.s.finish, { format: st.p.settings.dateFormat }));
  const set = (patch: Partial<PageSetup>) => { const n = { ...o, ...patch }; setO(n); setPg(0); try { const { from: _f, to: _t, ...keep } = n; localStorage.setItem(SETUP_KEY, JSON.stringify(keep)); } catch { /* ignore */ } };
  const eff = (): PageSetup => { const a = parseDateText(from, st.p.settings.dateFormat), b = parseDateText(to, st.p.settings.dateFormat); return { ...o, from: a ? atDay(a.day) : null, to: b ? atDay(b.day + 1) : null }; };
  const e = eff();
  const plan = layoutPages(st, e);
  const n = plan.pages.length;
  const cur = Math.min(pg, n - 1);
  const [W, H] = pageSize(e);
  const scale = Math.min(1, 560 / H, 720 / W);
  const views = GANTT_VIEWS.has(st.ui.view) || st.ui.view === 'taskSheet';
  return <>
    <h1>Print</h1>
    <div className="print-wrap">
      <div className="print-setup">
        <button className="btn primary big" disabled={!views} onClick={() => { S().setUI({ home: null }); setTimeout(() => printPages(e), 50); }}><Icon name="printer" />Print {n} page{n === 1 ? '' : 's'}</button>
        <p className="muted small">Choose “Save as PDF” as the printer to make a PDF.</p>
        {!views && <p className="alert inline">Printing lays out the Gantt views and the task list. Reports print from their own page; other views print as shown on screen with Ctrl+P in the browser.</p>}
        <h3>Settings</h3>
        <label className="fld"><span>Print</span><select className="inp" value={e.range} onChange={x => set({ range: x.target.value as PageSetup['range'] })}><option value="all">Entire project</option><option value="dates">Dates</option></select></label>
        {e.range === 'dates' && <div className="grid2"><DateInput value={from} format={st.p.settings.dateFormat} defaultMinute={0} onChange={setFrom} /><DateInput value={to} format={st.p.settings.dateFormat} defaultMinute={0} onChange={setTo} /></div>}
        <label className="fld"><span>Orientation</span><select className="inp" value={e.orientation} onChange={x => set({ orientation: x.target.value as PageSetup['orientation'] })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
        <label className="fld"><span>Paper</span><select className="inp" value={e.paper} onChange={x => set({ paper: x.target.value as PageSetup['paper'] })}>{['A4', 'A3', 'Letter', 'Legal', 'Tabloid'].map(q => <option key={q}>{q}</option>)}</select></label>
        <label className="fld"><span>Scaling</span><select className="inp" value={e.fitWide ? 'fit' + e.fitWide : String(e.scale)} onChange={x => { const v = x.target.value; if (v.startsWith('fit')) set({ fitWide: +v.slice(3) }); else set({ fitWide: 0, scale: +v }); }}>
          {[50, 75, 100, 125, 150].map(q => <option key={q} value={String(q)}>{q}% of the screen timescale</option>)}{[1, 2, 3, 4].map(q => <option key={'f' + q} value={'fit' + q}>Fit timescale to {q} page{q > 1 ? 's' : ''} wide</option>)}</select></label>
        <label className="fld"><span>Columns</span><select className="inp" value={e.columns} onChange={x => set({ columns: x.target.value as PageSetup['columns'] })}><option value="shown">Columns left of the divider</option><option value="all">All sheet columns</option><option value="name">Row number and task name only</option></select></label>
        <label className="fld"><span>Margins (mm)</span><input className="inp sm" type="number" min={0} max={40} value={e.margin} onChange={x => set({ margin: Math.max(0, Math.min(40, +x.target.value || 0)) })} /></label>
        <label className="chk"><input type="checkbox" checked={e.legend === 'every'} onChange={x => set({ legend: x.target.checked ? 'every' : 'none' })} />Legend on every page</label>
        <label className="chk"><input type="checkbox" checked={e.repeatName} onChange={x => set({ repeatName: x.target.checked })} />Repeat row number and task name on every page across</label>
        <label className="chk"><input type="checkbox" checked={e.gridlines} onChange={x => set({ gridlines: x.target.checked })} />Row lines</label>
        <h3>Header and footer</h3>
        {(['header', 'footer'] as const).map(k => <div key={k} className="hf">{(['Left', 'Center', 'Right'] as const).map((l, i) => <label key={l} className="fld"><span>{k === 'header' ? 'Header' : 'Footer'} {l.toLowerCase()}</span><input className="inp" value={e[k][i]} onChange={x => { const v = e[k].slice() as [string, string, string]; v[i] = x.target.value; set({ [k]: v } as Partial<PageSetup>); }} /></label>)}</div>)}
        <p className="hint">Codes: &amp;[Page] &amp;[Pages] &amp;[Project Title] &amp;[Date] &amp;[Manager] &amp;[Company] &amp;[View] &amp;[Start] &amp;[Finish]</p>
      </div>
      <div className="print-preview">
        <div className="pp-bar"><button className="icon-btn" disabled={cur <= 0} onClick={() => setPg(cur - 1)}>‹</button><span>Page {cur + 1} of {n} ({plan.across} across × {plan.down} down)</span><button className="icon-btn" disabled={cur >= n - 1} onClick={() => setPg(cur + 1)}>›</button></div>
        <div className="pp-page">{views ? <PrintPages o={e} scale={scale} only={cur} /> : <div className="muted pad">Switch to a Gantt view or the task list to preview.</div>}</div>
      </div>
    </div>
  </>;
}

// A small Gantt picture of a template's first rows, drawn from its real schedule.
function TemplateThumb({ t }: { t: TemplateInfo }) {
  const data = useMemo(() => {
    const p = buildTemplate(t.id, todayMinutes(), { baseline: false });
    const s = schedule(p);
    const d = Math.round((s.duration || 0) / 480);
    return { rows: s.rows.slice(0, 13), start: s.start, span: Math.max(1, s.finish - s.start), tasks: p.tasks.length, days: d };
  }, [t.id]);
  const W = 216, H = 120, x = (m: number) => 8 + ((m - data.start) / data.span) * (W - 16);
  return (
    <div className="bs-thumb tpl">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" aria-hidden="true">
        <rect width={W} height={H} fill="var(--bg)" />
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1={8 + f * (W - 16)} x2={8 + f * (W - 16)} y1={4} y2={H - 4} stroke="var(--line)" strokeDasharray="2 3" />)}
        {data.rows.map((r, i) => {
          const y = 8 + i * 8.5, x1 = x(r.start), x2 = Math.max(x1 + 2, x(r.finish));
          if (r.summary) return <path key={i} d={`M${x1} ${y} H${x2} V${y + 5} L${x2 - 2.5} ${y + 2.5} H${x1 + 2.5} L${x1} ${y + 5} Z`} fill="var(--sum)" />;
          if (r.finish === r.start) return <rect key={i} x={x1 - 3} y={y} width={5} height={5} transform={`rotate(45 ${x1} ${y + 2.5})`} fill="var(--sum)" />;
          return <rect key={i} x={x1} y={y} width={x2 - x1} height={5.5} rx={1} fill={r.critical ? '#d9534f' : t.color} />;
        })}
      </svg>
      <span className="tpl-meta">{data.tasks} tasks · {data.days} days</span>
    </div>
  );
}

export default function Home() {
  const st = useStore();
  const page = st.ui.home || 'new';
  const [, force] = useState(0);
  const close = () => S().setUI({ home: null });
  let body: ReactNode = null;
  if (page === 'new') {
    body = <>
      <h1>Start a plan</h1>
      <div className="bs-cards">
        <button className="bs-card" onClick={newBlank}><div className="bs-thumb blank"><Icon name="plus" size={30} /></div><b>Blank plan</b><small>An empty plan starting today.</small></button>
        <button className="bs-card" onClick={openFile}><div className="bs-thumb import"><Icon name="upload" size={30} /></div><b>Open or import a file</b><small>Cairn, project XML, Primavera XER, MPX, Excel or CSV.</small></button>
      </div>
      <h2>Examples to start from</h2>
      <div className="bs-cards">
        {TEMPLATES.map(t => (
          <button key={t.id} className="bs-card tpl" onClick={() => newFromTemplate(t.id, t.name)} title={t.desc}>
            <TemplateThumb t={t} />
            <b>{t.name}</b><small>{t.desc}</small>
          </button>
        ))}
      </div>
      <p className="bs-note">Examples start next Monday with people, links, milestones and a baseline. Change the start date in File › Plan settings and every task moves with it.</p>
    </>;
  } else if (page === 'open') {
    const plans = listPlans();
    body = <>
      <h1>Your plans</h1>
      <p className="bs-note">Plans you work on are kept in this browser. To move a plan to another computer, save it as a file.</p>
      <div className="row-btns"><button className="btn primary" onClick={openFile}><Icon name="folder" />Open a file…</button></div>
      <ul className="bs-recent">
        {plans.map(e => (
          <li key={e.id} className={e.id === st.planId ? 'on' : ''}>
            <button onClick={() => switchPlan(e.id)}><Icon name="gantt" /><span>{e.name}<small>Changed {new Date(e.updatedAt).toLocaleString()}</small></span></button>
            {e.id !== st.planId && <button className="icon-btn" title="Remove from this browser" onClick={() => S().open('confirm', { title: 'Remove plan', message: 'Remove “' + e.name + '” from this browser? Files you saved are not affected.', okLabel: 'Remove', onOk: () => { deletePlan(e.id); force(x => x + 1); } })}><Icon name="trash" /></button>}
          </li>
        ))}
        {!plans.length && <li className="muted">Plans you edit appear here.</li>}
      </ul>
    </>;
  } else if (page === 'print') {
    body = <PrintPage />;
  }
  return (
    <div className="home">
      <header className="home-bar">
        <img src={iconUrl} alt="" width={26} height={26} />
        <b>Cairn</b>
        <nav>{PAGES.map(([k, l, ic]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => S().setUI({ home: k })}><Icon name={ic} />{l}</button>)}</nav>
        <span className="sp" />
        <button className="btn" onClick={close}><Icon name="close" />Back to {st.p.name}</button>
      </header>
      <main>{body}</main>
    </div>
  );
}

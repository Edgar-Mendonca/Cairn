// Built-in reports: dashboards, resource, cost and in-progress reports drawn from the live plan.
// Each report is a page of charts and tables that updates as the plan changes and prints.
import { useMemo, type ReactNode } from 'react';
import type { Project } from '../../engine/model';
import type { Row, Schedule } from '../../engine/schedule';
import { buckets, phasedResource, phasedTask, shareIn, spreadOf, type Bucket } from '../../engine/timephase';
import { earnedValue } from '../../engine/fields';
import { formatDuration } from '../../engine/duration';
import { fmtDate, formatUnitLabel, todayMinutes, type Minutes } from '../../engine/time';
import { S, useStore } from '../store';
import { money } from '../columns';
import { BUILTIN_FILTERS } from '../../engine/filters';
import Icon from '../Icon';
import { BarChart, Card, DataTable, LineChart, Ring, Tiles } from './charts';

export interface ReportDef { id: string; name: string; group: string; desc: string }
export const REPORTS: ReportDef[] = [
  { id: 'overview', name: 'Plan overview', group: 'Dashboards', desc: 'Progress, milestones and late tasks at a glance.' },
  { id: 'burndown', name: 'Burndown', group: 'Dashboards', desc: 'Remaining work and remaining tasks against the baseline.' },
  { id: 'costOverview', name: 'Cost overview', group: 'Dashboards', desc: 'Cost to date, remaining cost and cost by phase.' },
  { id: 'workOverview', name: 'Work overview', group: 'Dashboards', desc: 'Work done, work remaining and work by resource.' },
  { id: 'upcoming', name: 'Coming up', group: 'Dashboards', desc: 'What starts and finishes in the next two weeks.' },
  { id: 'overallocated', name: 'Over capacity', group: 'People', desc: 'Resources with more work than they can do, and when.' },
  { id: 'resourceOverview', name: 'People overview', group: 'People', desc: 'Work and status of each resource.' },
  { id: 'cashFlow', name: 'Cash flow', group: 'Costs', desc: 'Cost per week and cumulative cost.' },
  { id: 'costOverruns', name: 'Cost overruns', group: 'Costs', desc: 'Tasks and resources over their baseline cost.' },
  { id: 'earnedValue', name: 'Earned value', group: 'Costs', desc: 'Planned value, earned value and actual cost over time.' },
  { id: 'resourceCost', name: 'Cost by person', group: 'Costs', desc: 'Cost by resource and resource type.' },
  { id: 'taskCost', name: 'Cost by phase', group: 'Costs', desc: 'Cost status of each phase.' },
  { id: 'critical', name: 'Critical tasks', group: 'In progress', desc: 'Unfinished tasks on the critical path.' },
  { id: 'late', name: 'Late tasks', group: 'In progress', desc: 'Tasks behind schedule at the status date.' },
  { id: 'milestones', name: 'Milestones', group: 'In progress', desc: 'Late, upcoming and completed milestones.' },
  { id: 'slipping', name: 'Slipping tasks', group: 'In progress', desc: 'Tasks finishing after their baseline finish.' }
];

interface R { p: Project; s: Schedule }
const leaves = (s: Schedule) => s.rows.filter(r => !r.summary && r.task.active);
const top = (s: Schedule) => s.rows.filter(r => r.parent === -1 && r.task.active);
const hrs = (p: Project, m: number) => formatDuration({ minutes: m, unit: p.settings.workUnit, elapsed: false, estimated: false }, p.settings);
const days = (p: Project, m: number) => formatDuration({ minutes: m, unit: 'd', elapsed: false, estimated: false }, p.settings);
const d8 = (p: Project, t: Minutes | null) => (t == null ? 'NA' : fmtDate(t, { weekday: false, format: p.settings.dateFormat }));
const cur = (p: Project, v: number) => money({ p }, v).replace(/\.00$/, '');
const shortHrs = (v: number) => { const h = v / 60; return Math.abs(h) >= 10000 ? (h / 1000).toFixed(1) + 'k h' : Math.round(h).toLocaleString('en-US') + ' h'; };
const shortCur = (p: Project) => (v: number) => { const c = p.settings.currency; const a = Math.abs(v); return (v < 0 ? '-' : '') + c + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : Math.round(a)); };
const status = (p: Project) => p.statusDate ?? todayMinutes();
const isLate = (r: Row, c: R) => BUILTIN_FILTERS.find(f => f.id === 'late')!.test(r, c, []);
const weeks = (c: R): Bucket[] => { const a = Math.min(c.s.start, c.p.baselines[0] ? Math.min(...Object.values(c.p.baselines[0].tasks).map(b => b.start)) : c.s.start); const b = Math.max(c.s.finish, c.p.baselines[0] ? Math.max(...Object.values(c.p.baselines[0].tasks).map(x => x.finish)) : c.s.finish); const bk = buckets('week', a, b + 1, c.p.gantt.timescale.weekStart); return bk.length > 160 ? buckets('month', a, b + 1) : bk; };
const lbl = (bk: Bucket[]) => bk.map(b => formatUnitLabel(bk.length && bk[0].end - bk[0].start > 8 * 1440 ? "MMM 'yy" : 'd MMM', b.start));
const nameCell = (r: Row) => <button className="linkbtn" onClick={() => { S().set({ sel: [r.task.uid] }); S().setUI({ view: 'gantt' }); setTimeout(() => window.dispatchEvent(new CustomEvent('pc:scrollto', { detail: r.task.uid })), 50); }}>{r.task.name}</button>;

function cumulative(v: number[]): number[] { let a = 0; return v.map(x => (a += x)); }

function Overview({ p, s }: R) {
  const c = { p, s };
  const ms = leaves(s).filter(r => r.duration === 0);
  const late = leaves(s).filter(r => isLate(r, c));
  const tops = top(s);
  return <>
    <Card title="Progress" note={p.statusDate != null ? 'Status date ' + d8(p, p.statusDate) : 'As of today'}>
      <div className="ov-row"><Ring value={s.percent} label="complete" />
        <Tiles items={[{ label: 'Start', value: d8(p, s.start) }, { label: 'Finish', value: d8(p, s.finish), note: p.baselines[0] ? 'Baseline ' + d8(p, Math.max(...Object.values(p.baselines[0].tasks).map(b => b.finish))) : undefined }, { label: 'Duration', value: days(p, s.duration) }, { label: 'Cost', value: cur(p, s.cost) }, { label: 'Work', value: hrs(p, s.work) }, { label: 'Late tasks', value: String(late.length), tone: late.length ? 'bad' : 'good' }]} /></div>
    </Card>
    <Card title="% Complete by phase"><BarChart horizontal labels={tops.map(r => r.task.name)} series={[{ name: '% Complete', values: tops.map(r => r.percent) }]} fmt={v => Math.round(v) + '%'} /></Card>
    <Card title="Milestones due" wide>
      <DataTable cols={[{ label: 'Name' }, { label: 'Finish' }, { label: 'Status' }]} rows={ms.filter(r => r.percent < 100).slice(0, 12).map(r => [nameCell(r), d8(p, r.finish), isLate(r, c) ? <span className="bad">Late</span> : r.finish < status(p) + 14 * 1440 ? 'Due soon' : 'On schedule'])} empty="No open milestones." />
    </Card>
    <Card title="Late tasks" wide>
      <DataTable cols={[{ label: 'Name' }, { label: 'Start' }, { label: 'Finish' }, { label: 'Duration', right: true }, { label: '% Complete', right: true }, { label: 'Resources' }]} rows={late.slice(0, 15).map(r => [nameCell(r), d8(p, r.start), d8(p, r.finish), days(p, r.duration), r.percent + '%', r.task.assignments.map(a => p.resources.find(x => x.uid === a.res)?.name).join(', ')])} empty="No late tasks." />
    </Card>
  </>;
}

function Burndown({ p, s }: R) {
  const c = { p, s };
  const bk = useMemo(() => weeks(c), [s]);
  const all = phasedTask({ ...s.rows[0], i: -1 } as Row, s, p, bk);
  const W = s.work, BW = top(s).reduce((a, r) => a + (r.baseline?.work || 0), 0);
  const actualCum = cumulative(all.actualWork), planCum = cumulative(all.work), baseCum = cumulative(all.baselineWork);
  const now = status(p);
  const remaining = bk.map((b, k) => Math.max(0, W - (b.end <= now ? actualCum[k] : planCum[k])));
  const lv = leaves(s);
  const tasksRem = bk.map(b => lv.filter(r => r.finish > b.end || (r.percent < 100 && b.end <= now)).length);
  const baseTasksRem = bk.map(b => lv.filter(r => (r.baseline ? r.baseline.finish > b.end : true)).length);
  return <>
    <Card title="Work burndown" wide note="Remaining work: actual progress up to the status date, then as scheduled.">
      <LineChart labels={lbl(bk)} series={[{ name: 'Remaining work', values: remaining }, { name: 'Baseline remaining work', values: bk.map((_, k) => Math.max(0, BW - baseCum[k])), dash: true, color: 'var(--series-2)' }, { name: 'Remaining actual work', values: bk.map((b, k) => (b.end <= now ? Math.max(0, W - actualCum[k]) : NaN)), color: 'var(--series-3)' }]} fmt={shortHrs} />
    </Card>
    <Card title="Task burndown" wide note="Number of unfinished tasks at the end of each period.">
      <LineChart labels={lbl(bk)} series={[{ name: 'Remaining tasks', values: tasksRem }, { name: 'Baseline remaining tasks', values: baseTasksRem, dash: true, color: 'var(--series-2)' }]} fmt={v => String(Math.round(v))} />
    </Card>
    {!p.baselines[0] && <p className="rnote">Set a baseline (Plan › Set Baseline) to compare against the plan.</p>}
  </>;
}

function CostOverview({ p, s }: R) {
  const c = { p, s };
  const bk = useMemo(() => weeks(c), [s]);
  const all = phasedTask({ ...s.rows[0], i: -1 } as Row, s, p, bk);
  const tops = top(s);
  const bc = tops.reduce((a, r) => a + (r.baseline?.cost || 0), 0);
  return <>
    <Card title="Cost to date" wide><Tiles items={[{ label: 'Cost', value: cur(p, s.cost) }, { label: 'Actual cost', value: cur(p, s.actualCost) }, { label: 'Remaining cost', value: cur(p, s.cost - s.actualCost) }, { label: 'Baseline cost', value: p.baselines[0] ? cur(p, bc) : '—' }, { label: 'Cost variance', value: p.baselines[0] ? cur(p, s.cost - bc) : '—', tone: s.cost > bc + 0.5 && p.baselines[0] ? 'bad' : undefined }, { label: '% complete', value: s.percent + '%' }]} /></Card>
    <Card title="Cumulative cost" wide><LineChart labels={lbl(bk)} series={[{ name: 'Cumulative cost', values: cumulative(all.cost) }, { name: 'Cumulative baseline cost', values: cumulative(all.baselineCost), dash: true, color: 'var(--series-2)' }, { name: 'Cumulative actual cost', values: cumulative(all.actualCost), color: 'var(--series-3)' }]} fmt={shortCur(p)} /></Card>
    <Card title="Cost status by phase" wide><BarChart horizontal stacked labels={tops.map(r => r.task.name)} series={[{ name: 'Actual cost', values: tops.map(r => r.actualCost) }, { name: 'Remaining cost', values: tops.map(r => r.cost - r.actualCost), color: 'var(--series-3)' }]} fmt={shortCur(p)} /></Card>
  </>;
}

function WorkOverview({ p, s }: R) {
  const tops = top(s);
  const res = p.resources.filter(r => r.type === 'Work');
  const rw = res.map(r => { let w = 0, a = 0; s.rows.forEach(x => { if (x.summary) return; x.task.assignments.forEach(as => { if (as.res === r.uid) { w += as.work; a += as.work * x.percent / 100; } }); }); return { r, w, a }; });
  return <>
    <Card title="Work" wide><Tiles items={[{ label: 'Work', value: hrs(p, s.work) }, { label: 'Actual work', value: hrs(p, top(s).reduce((a, r) => a + r.actualWork, 0)) }, { label: 'Remaining work', value: hrs(p, s.work - top(s).reduce((a, r) => a + r.actualWork, 0)) }, { label: '% work complete', value: s.work ? Math.round(top(s).reduce((a, r) => a + r.actualWork, 0) / s.work * 100) + '%' : '0%' }]} /></Card>
    <Card title="Work by phase"><BarChart horizontal stacked labels={tops.map(r => r.task.name)} series={[{ name: 'Actual work', values: tops.map(r => r.actualWork) }, { name: 'Remaining work', values: tops.map(r => r.work - r.actualWork), color: 'var(--series-3)' }]} fmt={shortHrs} /></Card>
    <Card title="Work by resource"><BarChart horizontal stacked labels={rw.map(x => x.r.name)} series={[{ name: 'Actual work', values: rw.map(x => x.a) }, { name: 'Remaining work', values: rw.map(x => x.w - x.a), color: 'var(--series-3)' }]} fmt={shortHrs} /></Card>
  </>;
}

function Upcoming({ p, s }: R) {
  const now = status(p), next = now + 14 * 1440;
  const lv = leaves(s);
  const starting = lv.filter(r => r.start >= now && r.start < next).sort((a, b) => a.start - b.start);
  const finishing = lv.filter(r => r.finish >= now && r.finish < next && r.percent < 100).sort((a, b) => a.finish - b.finish);
  const done = lv.filter(r => r.actualFinish != null && r.actualFinish >= now - 7 * 1440 && r.actualFinish <= now);
  const row = (r: Row) => [nameCell(r), d8(p, r.start), d8(p, r.finish), r.percent + '%', r.task.assignments.map(a => p.resources.find(x => x.uid === a.res)?.name).join(', ')];
  const cols = [{ label: 'Name' }, { label: 'Start' }, { label: 'Finish' }, { label: '% Complete', right: true }, { label: 'Resources' }];
  return <>
    <Card title={'Starting in the next two weeks (from ' + d8(p, now) + ')'} wide><DataTable cols={cols} rows={starting.map(row)} empty="Nothing starts in the next two weeks." /></Card>
    <Card title="Due in the next two weeks" wide><DataTable cols={cols} rows={finishing.map(row)} empty="Nothing is due in the next two weeks." /></Card>
    <Card title="Completed in the last week" wide><DataTable cols={cols} rows={done.map(row)} empty="Nothing finished in the last week." /></Card>
  </>;
}

function Overallocated({ p, s }: R) {
  const c = { p, s };
  const bk = useMemo(() => weeks(c), [s]);
  const over = p.resources.filter(r => s.overallocated.has(r.uid));
  return <>
    <Card title="Overallocated resources" wide>
      <DataTable cols={[{ label: 'Resource' }, { label: 'Max units', right: true }, { label: 'Work', right: true }, { label: 'First overallocated' }, { label: 'Periods', right: true }]} rows={over.map(r => { const t = s.overTimes.get(r.uid) || []; const w = phasedResource(r.uid, s, p, [{ start: s.start - 1440 * 3650, end: s.finish + 1440 * 3650 }]).work[0]; return [r.name, Math.round(r.maxUnits * 100) + '%', hrs(p, w), t[0] ? d8(p, t[0][0]) : '', String(t.length)]; })} empty="No resource is overallocated." />
    </Card>
    {over.slice(0, 4).map(r => { const ph = phasedResource(r.uid, s, p, bk); const cal = s.calendars.get(r.calendar, p.calendar); return (
      <Card key={r.uid} title={r.name + ': work against availability'}>
        <BarChart labels={lbl(bk)} series={[{ name: 'Work', values: ph.work }, { name: 'Available', values: bk.map((b, k) => ph.avail[k] * cal.workBetween(b.start, b.end)), color: 'var(--series-3)' }]} fmt={shortHrs} />
      </Card>); })}
    {over.length > 0 && <p className="rnote">Use Plan › Balance workload, or move work between resources in the Team board.</p>}
  </>;
}

function ResourceOverview({ p, s }: R) {
  const res = p.resources;
  const stats = res.map(r => { let w = 0, a = 0, cost = 0; s.rows.forEach(x => { if (x.summary) return; x.task.assignments.forEach(as => { if (as.res === r.uid) { w += as.work; a += as.work * x.percent / 100; cost += r.type === 'Cost' ? as.cost : as.work / 60 * r.stdRate + r.costPerUse + (r.type === 'Material' ? as.units * r.stdRate : 0); } }); }); return { r, w, a, cost }; });
  const work = stats.filter(x => x.r.type === 'Work');
  return <>
    <Card title="Resource stats" wide><BarChart horizontal stacked labels={work.map(x => x.r.name)} series={[{ name: 'Actual work', values: work.map(x => x.a) }, { name: 'Remaining work', values: work.map(x => x.w - x.a), color: 'var(--series-3)' }]} fmt={shortHrs} /></Card>
    <Card title="Work status" wide>
      <DataTable cols={[{ label: 'Resource' }, { label: 'Type' }, { label: 'Start' }, { label: 'Finish' }, { label: 'Work', right: true }, { label: 'Remaining work', right: true }, { label: 'Cost', right: true }, { label: 'Status' }]}
        rows={stats.map(x => { const ts = s.rows.filter(r => !r.summary && r.task.assignments.some(a => a.res === x.r.uid)); return [x.r.name, x.r.type, ts.length ? d8(p, Math.min(...ts.map(t => t.start))) : 'NA', ts.length ? d8(p, Math.max(...ts.map(t => t.finish))) : 'NA', x.r.type === 'Work' ? hrs(p, x.w) : '', x.r.type === 'Work' ? hrs(p, x.w - x.a) : '', cur(p, x.cost), s.overallocated.has(x.r.uid) ? <span className="bad">Overallocated</span> : ts.length ? 'OK' : 'Not assigned']; })} />
    </Card>
  </>;
}

function CashFlow({ p, s }: R) {
  const c = { p, s };
  const bk = useMemo(() => weeks(c), [s]);
  const all = phasedTask({ ...s.rows[0], i: -1 } as Row, s, p, bk);
  return <>
    <Card title="Cost per period" wide><BarChart labels={lbl(bk)} series={[{ name: 'Cost', values: all.cost }]} fmt={shortCur(p)} /></Card>
    <Card title="Cumulative cost" wide><LineChart labels={lbl(bk)} series={[{ name: 'Cumulative cost', values: cumulative(all.cost) }]} fmt={shortCur(p)} /></Card>
    <Card title="Cost by phase and period" wide>
      <DataTable cols={[{ label: 'Phase' }, ...bk.slice(0, 12).map((b, k) => ({ label: lbl(bk)[k], right: true })), { label: 'Total', right: true }]}
        rows={top(s).map(r => { const ph = phasedTask(r, s, p, bk.slice(0, 12)); return [r.task.name, ...ph.cost.map(v => (v ? shortCur(p)(v) : '')), cur(p, r.cost)]; })} />
    </Card>
  </>;
}

function CostOverruns({ p, s }: R) {
  const tops = top(s);
  const tasks = leaves(s).filter(r => r.baseline && r.cost - r.baseline.cost > 0.5).sort((a, b) => (b.cost - b.baseline!.cost) - (a.cost - a.baseline!.cost));
  return <>
    <Card title="Cost variance by phase" wide note="Cost minus baseline cost. Above zero is over budget.">
      <BarChart horizontal labels={tops.map(r => r.task.name)} series={[{ name: 'Cost variance', values: tops.map(r => r.cost - (r.baseline?.cost ?? r.cost)) }]} fmt={shortCur(p)} />
    </Card>
    <Card title="Tasks over budget" wide>
      <DataTable cols={[{ label: 'Name' }, { label: 'Cost', right: true }, { label: 'Baseline cost', right: true }, { label: 'Variance', right: true }]} rows={tasks.slice(0, 20).map(r => [nameCell(r), cur(p, r.cost), cur(p, r.baseline!.cost), <span className="bad">{cur(p, r.cost - r.baseline!.cost)}</span>])} empty={p.baselines[0] ? 'No task is over its baseline cost.' : 'Set a baseline to compare costs.'} />
    </Card>
  </>;
}

function EarnedValueReport({ p, s }: R) {
  const c = { p, s };
  const bk = useMemo(() => weeks(c), [s]);
  const all = phasedTask({ ...s.rows[0], i: -1 } as Row, s, p, bk);
  const now = status(p);
  // Earned value over time: each task's baseline cost times the share of its work done by then.
  const ev = bk.map(b => leaves(s).reduce((a, r) => { const bac = r.baseline?.cost || 0; if (!bac || r.percent <= 0) return a; const t = Math.min(b.end, r.completeThrough); return a + bac * shareIn(r, spreadOf(r, s, p), null, r.start, t); }, 0));
  const rootEv = earnedValue({ ...s.rows[0], summary: true, children: s.rows.filter(r => r.parent === -1).map(r => r.i), i: -999 } as Row, c);
  const spi = rootEv.bcws ? rootEv.bcwp / rootEv.bcws : 0, cpi = rootEv.acwp ? rootEv.bcwp / rootEv.acwp : 0;
  const upto = bk.findIndex(b => b.start > now);
  const cut = (v: number[]) => v.map((x, k) => (upto >= 0 && k >= upto ? NaN : x)); // earned value and actual cost stop at the status date
  return <>
    <Card title="Earned value indicators" wide><Tiles items={[{ label: 'Planned value (BCWS)', value: cur(p, rootEv.bcws) }, { label: 'Earned value (BCWP)', value: cur(p, rootEv.bcwp) }, { label: 'Actual cost (ACWP)', value: cur(p, rootEv.acwp) }, { label: 'SPI', value: spi ? spi.toFixed(2) : '—', tone: spi && spi < 0.95 ? 'bad' : spi ? 'good' : undefined }, { label: 'CPI', value: cpi ? cpi.toFixed(2) : '—', tone: cpi && cpi < 0.95 ? 'bad' : cpi ? 'good' : undefined }, { label: 'BAC', value: cur(p, rootEv.bac) }]} /></Card>
    <Card title="Earned value over time" wide note={'Cumulative values; the status date is ' + d8(p, now) + '.'}>
      <LineChart labels={lbl(bk)} series={[{ name: 'Planned value', values: cumulative(all.baselineCost) }, { name: 'Earned value', values: cut(ev), color: 'var(--series-3)' }, { name: 'Actual cost', values: cut(cumulative(all.actualCost)), color: 'var(--series-2)' }]} fmt={shortCur(p)} />
    </Card>
    {!p.baselines[0] && <p className="rnote">Earned value needs a baseline: set one with Plan › Set Baseline, and a status date with Plan › Status Date.</p>}
  </>;
}

function ResourceCost({ p, s }: R) {
  const data = p.resources.map(r => { let cost = 0; s.rows.forEach(x => { if (x.summary) return; x.task.assignments.forEach(a => { if (a.res !== r.uid) return; cost += r.type === 'Cost' ? a.cost : r.type === 'Material' ? a.units * r.stdRate + r.costPerUse : a.work / 60 * r.stdRate + r.costPerUse; }); }); return { r, cost }; }).sort((a, b) => b.cost - a.cost);
  const byType = (['Work', 'Material', 'Cost'] as const).map(t => data.filter(d => d.r.type === t).reduce((a, d) => a + d.cost, 0));
  return <>
    <Card title="Cost by resource type"><BarChart horizontal labels={['Work', 'Material', 'Cost']} series={[{ name: 'Cost', values: byType }]} fmt={shortCur(p)} /></Card>
    <Card title="Cost by resource"><BarChart horizontal labels={data.map(d => d.r.name)} series={[{ name: 'Cost', values: data.map(d => d.cost) }]} fmt={shortCur(p)} /></Card>
    <Card title="Cost details" wide><DataTable cols={[{ label: 'Resource' }, { label: 'Type' }, { label: 'Std. rate', right: true }, { label: 'Cost', right: true }]} rows={data.map(d => [d.r.name, d.r.type, d.r.type === 'Cost' ? '' : cur(p, d.r.stdRate), cur(p, d.cost)])} /></Card>
  </>;
}

function TaskCost({ p, s }: R) {
  const tops = top(s);
  return <>
    <Card title="Cost by phase" wide><BarChart horizontal labels={tops.map(r => r.task.name)} series={[{ name: 'Cost', values: tops.map(r => r.cost) }, ...(p.baselines[0] ? [{ name: 'Baseline cost', values: tops.map(r => r.baseline?.cost || 0), color: 'var(--series-2)' }] : [])]} fmt={shortCur(p)} /></Card>
    <Card title="Cost status" wide><DataTable cols={[{ label: 'Name' }, { label: 'Fixed cost', right: true }, { label: 'Actual cost', right: true }, { label: 'Remaining', right: true }, { label: 'Cost', right: true }, { label: 'Baseline', right: true }, { label: 'Variance', right: true }]}
      rows={s.rows.filter(r => r.summary || r.parent === -1).map(r => [<span style={{ paddingLeft: (r.task.level - 1) * 12 }}>{nameCell(r)}</span>, cur(p, r.task.fixedCost), cur(p, r.actualCost), cur(p, r.cost - r.actualCost), cur(p, r.cost), r.baseline ? cur(p, r.baseline.cost) : '', r.baseline ? cur(p, r.cost - r.baseline.cost) : ''])} /></Card>
  </>;
}

function TaskList({ p, s, kind }: R & { kind: 'critical' | 'late' | 'slipping' }) {
  const c = { p, s };
  const list = leaves(s).filter(r => kind === 'critical' ? r.critical && r.percent < 100 : kind === 'late' ? isLate(r, c) : r.percent < 100 && r.baseline && r.finish > r.baseline.finish);
  const fv = (r: Row) => (r.baseline ? days(p, s.calendar.workBetween(r.baseline.finish, r.finish)) : '');
  return <>
    {kind === 'slipping' && list.length > 0 && <Card title="Finish variance" wide><BarChart horizontal labels={list.slice(0, 15).map(r => r.task.name)} series={[{ name: 'Finish variance (days)', values: list.slice(0, 15).map(r => s.calendar.workBetween(r.baseline!.finish, r.finish) / p.settings.minutesPerDay) }]} fmt={v => (Math.round(v * 10) / 10) + 'd'} /></Card>}
    <Card title={kind === 'critical' ? 'Critical tasks' : kind === 'late' ? 'Late tasks' : 'Slipping tasks'} wide note={kind === 'late' ? 'Tasks that should be further along at ' + d8(p, status(p)) + '.' : kind === 'critical' ? 'Unfinished tasks with no slack: a delay to any of them delays the project.' : 'Unfinished tasks scheduled to finish after their baseline finish.'}>
      <DataTable cols={[{ label: 'ID', right: true }, { label: 'Name' }, { label: 'Start' }, { label: 'Finish' }, { label: kind === 'slipping' ? 'Finish variance' : 'Remaining duration', right: true }, { label: '% Complete', right: true }, { label: 'Resources' }]}
        rows={list.map(r => [r.id, nameCell(r), d8(p, r.start), d8(p, r.finish), kind === 'slipping' ? fv(r) : days(p, r.remaining), r.percent + '%', r.task.assignments.map(a => p.resources.find(x => x.uid === a.res)?.name).join(', ')])} empty="None." />
    </Card>
  </>;
}

function Milestones({ p, s }: R) {
  const c = { p, s };
  const ms = leaves(s).filter(r => r.duration === 0);
  const late = ms.filter(r => isLate(r, c) || (r.baseline && r.finish > r.baseline.finish && r.percent < 100));
  const upcoming = ms.filter(r => r.percent < 100 && !late.includes(r));
  const done = ms.filter(r => r.percent >= 100);
  const cols = [{ label: 'Name' }, { label: 'Finish' }, { label: 'Baseline finish' }, { label: 'Variance', right: true }];
  const row = (r: Row) => [nameCell(r), d8(p, r.finish), r.baseline ? d8(p, r.baseline.finish) : 'NA', r.baseline ? days(p, s.calendar.workBetween(r.baseline.finish, r.finish)) : ''];
  return <>
    <Card title="Late milestones" wide><DataTable cols={cols} rows={late.map(row)} empty="No late milestones." /></Card>
    <Card title="Upcoming milestones" wide><DataTable cols={cols} rows={upcoming.map(row)} empty="No upcoming milestones." /></Card>
    <Card title="Completed milestones" wide><DataTable cols={cols} rows={done.map(row)} empty="No milestones completed yet." /></Card>
  </>;
}

export function Reports() {
  const st = useStore();
  const { p, s, ui } = st;
  const rep = REPORTS.find(r => r.id === ui.report) || REPORTS[0];
  let body: ReactNode;
  const c = { p, s };
  switch (rep.id) {
    case 'burndown': body = <Burndown {...c} />; break;
    case 'costOverview': body = <CostOverview {...c} />; break;
    case 'workOverview': body = <WorkOverview {...c} />; break;
    case 'upcoming': body = <Upcoming {...c} />; break;
    case 'overallocated': body = <Overallocated {...c} />; break;
    case 'resourceOverview': body = <ResourceOverview {...c} />; break;
    case 'cashFlow': body = <CashFlow {...c} />; break;
    case 'costOverruns': body = <CostOverruns {...c} />; break;
    case 'earnedValue': body = <EarnedValueReport {...c} />; break;
    case 'resourceCost': body = <ResourceCost {...c} />; break;
    case 'taskCost': body = <TaskCost {...c} />; break;
    case 'critical': case 'late': case 'slipping': body = <TaskList {...c} kind={rep.id} />; break;
    case 'milestones': body = <Milestones {...c} />; break;
    default: body = <Overview {...c} />;
  }
  const groups = [...new Set(REPORTS.map(r => r.group))];
  return (
    <div className="reports">
      <aside className="rp-nav">
        {groups.map(g => <div key={g}><h4>{g}</h4>{REPORTS.filter(r => r.group === g).map(r => <button key={r.id} className={r.id === rep.id ? 'on' : ''} onClick={() => S().setUI({ report: r.id })}>{r.name}</button>)}</div>)}
      </aside>
      <div className="rp-page" id="report-page">
        <header className="rp-head">
          <div><h1>{rep.name}</h1><p>{p.name} · {d8(p, s.start)} – {d8(p, s.finish)} · {rep.desc}</p></div>
          <span className="sp" />
          <button className="btn" onClick={() => { document.body.classList.add('print-report'); setTimeout(() => { window.print(); document.body.classList.remove('print-report'); }, 50); }}><Icon name="printer" />Print</button>
        </header>
        <div className="rp-grid">{body}</div>
      </div>
    </div>
  );
}

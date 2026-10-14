import { describe, expect, it } from 'vitest';
import { blankProject, newTask, type Project, type Task } from './model';
import { schedule } from './schedule';
import { addResources, deleteTasks, editCell, indent, insertTasks, linkTasks, markOnTrack, moveTasks, setBaseline, setMode, setPercent, unlinkTasks, formatPredecessors, formatResourceNames, createsCycle } from './ops';
import { isoDateTime, parseIso } from './time';
import { hours24Calendar } from './calendar';

const T = (s: string) => parseIso(s)!;
const S = (t: number) => isoDateTime(t).slice(0, 16);
const D = 480; // one day of work

// Builds a project from [name, duration text, predecessors text?, level?] rows starting Mon 5 Jan 2026 8:00.
function plan(rows: [string, string, string?, number?][], tweak?: (p: Project) => void) {
  let p = blankProject('Test');
  p.start = T('2026-01-05T08:00');
  rows.forEach(([name, , , level]) => p.tasks.push(newTask(p, { name, level: level ?? 1, estimated: false })));
  let s = schedule(p);
  rows.forEach(([, dur], i) => { const r = editCell(p, s, p.tasks[i].uid, 'duration', dur); p = r.p; });
  s = schedule(p);
  rows.forEach(([, , preds], i) => { if (preds) { const r = editCell(p, s, p.tasks[i].uid, 'preds', preds); if (r.error) throw new Error(r.error); p = r.p; } });
  if (tweak) tweak(p);
  return { p, s: schedule(p) };
}
const row = (s: ReturnType<typeof schedule>, name: string) => s.rows.find(r => r.task.name === name)!;
const dates = (s: ReturnType<typeof schedule>, name: string) => [S(row(s, name).start), S(row(s, name).finish)];
const task = (p: Project, name: string) => p.tasks.find(t => t.name === name)!;

describe('links and lags', () => {
  it('chains finish-to-start: next task starts 8:00 the next working day; a milestone sits at 17:00', () => {
    const { s } = plan([['A', '5d'], ['B', '3d', '1'], ['M', '0d', '2']]);
    expect(dates(s, 'A')).toEqual(['2026-01-05T08:00', '2026-01-09T17:00']);
    expect(dates(s, 'B')).toEqual(['2026-01-12T08:00', '2026-01-14T17:00']);
    expect(dates(s, 'M')).toEqual(['2026-01-14T17:00', '2026-01-14T17:00']);
    expect(row(s, 'M').task.milestone).toBe(true);
    expect(S(s.finish)).toBe('2026-01-14T17:00');
  });

  it('applies lag, lead, percentage lag and elapsed lag', () => {
    const { s } = plan([['A', '5d'], ['Lag', '1d', '1FS+1d'], ['Lead', '1d', '1FS-1d'], ['Pct', '1d', '1SS+50%'], ['Elapsed', '1d', '1FS+2ed']]);
    expect(dates(s, 'Lag')[0]).toBe('2026-01-13T08:00');
    expect(dates(s, 'Lead')[0]).toBe('2026-01-09T08:00');
    expect(dates(s, 'Pct')[0]).toBe('2026-01-07T13:00'); // 2.5 days into A ends at the 12:00 lunch break, so work starts at 13:00
    expect(dates(s, 'Elapsed')[0]).toBe('2026-01-12T08:00'); // Fri 17:00 + 48 clock hours = Sun 17:00 -> Mon 8:00
  });

  it('handles SS, FF and SF links', () => {
    const { s } = plan([['A', '5d'], ['SS', '2d', '1SS+2d'], ['FF', '2d', '1FF'], ['SF', '1d', '1SF']]);
    expect(dates(s, 'SS')).toEqual(['2026-01-07T08:00', '2026-01-08T17:00']);
    expect(dates(s, 'FF')).toEqual(['2026-01-08T08:00', '2026-01-09T17:00']);
    expect(dates(s, 'SF')[1]).toBe('2026-01-05T17:00');
  });

  it('schedules hour durations within the day, skipping lunch', () => {
    const { s } = plan([['A', '4h'], ['B', '2h', '1'], ['C', '3h', '2']]);
    expect(dates(s, 'A')).toEqual(['2026-01-05T08:00', '2026-01-05T12:00']);
    expect(dates(s, 'B')).toEqual(['2026-01-05T13:00', '2026-01-05T15:00']);
    expect(dates(s, 'C')).toEqual(['2026-01-05T15:00', '2026-01-06T09:00']);
  });

  it('formats predecessors back the way they were typed', () => {
    const { p, s } = plan([['A', '5d'], ['B', '1d', '1SS+2d, 3'], ['C', '1d'], ['D', '1d', '1FF-1w,3FS+50%']]);
    expect(formatPredecessors(p, s, task(p, 'B'))).toBe('1SS+2d,3');
    expect(formatPredecessors(p, s, task(p, 'D'))).toBe('1FF-1w,3FS+50%');
  });

  it('rejects loops and links between a summary and its subtasks', () => {
    const { p, s } = plan([['A', '1d'], ['B', '1d', '1'], ['C', '1d', '2']]);
    expect(editCell(p, s, task(p, 'A').uid, 'preds', '3').error).toMatch(/loop/);
    const nested = plan([['S', '1d'], ['S1', '1d', undefined, 2], ['S2', '1d', undefined, 2]]);
    expect(editCell(nested.p, nested.s, task(nested.p, 'S2').uid, 'preds', '1').error).toBeTruthy();
    expect(createsCycle(p, task(p, 'C').uid, [{ pred: task(p, 'A').uid, type: 'FS', lag: 0, lagUnit: 'd', lagElapsed: false, lagPercent: false }])).toBe(false);
  });
});

describe('critical path and slack', () => {
  it('finds the critical path, total slack and free slack', () => {
    const { s } = plan([['A', '3d'], ['B', '2d', '1'], ['C', '1d'], ['D', '1d', '2,3']]);
    expect(row(s, 'A').critical).toBe(true);
    expect(row(s, 'B').critical).toBe(true);
    expect(row(s, 'C').critical).toBe(false);
    expect(row(s, 'C').totalSlack).toBe(4 * D);
    expect(row(s, 'C').freeSlack).toBe(4 * D);
    expect(row(s, 'D').critical).toBe(true);
  });

  it('a deadline shortens slack and is flagged when missed', () => {
    const { s } = plan([['A', '3d'], ['B', '2d']], p => { p.tasks[1].deadline = T('2026-01-05T17:00'); });
    expect(row(s, 'B').totalSlack).toBe(-D);
    expect(row(s, 'B').critical).toBe(true);
    expect(row(s, 'B').indicators).toContain('deadline');
  });
});

describe('constraints', () => {
  it('typing a start date sets Start No Earlier Than', () => {
    let { p, s } = plan([['A', '2d']]);
    p = editCell(p, s, p.tasks[0].uid, 'start', '14 Jan 26').p;
    s = schedule(p);
    expect(p.tasks[0].constraint).toBe('SNET');
    expect(dates(s, 'A')).toEqual(['2026-01-14T08:00', '2026-01-15T17:00']);
    p = editCell(p, s, p.tasks[0].uid, 'finish', '23 Jan 26').p;
    s = schedule(p);
    expect(p.tasks[0].constraint).toBe('FNET');
    expect(dates(s, 'A')).toEqual(['2026-01-22T08:00', '2026-01-23T17:00']);
  });

  it('honors Must Start On over links and shows negative slack', () => {
    const { s } = plan([['A', '5d'], ['B', '1d', '1']], p => { p.tasks[1].constraint = 'MSO'; p.tasks[1].constraintDate = T('2026-01-07T08:00'); });
    expect(dates(s, 'B')[0]).toBe('2026-01-07T08:00');
    expect(row(s, 'B').indicators).toContain('conflict');
    expect(row(s, 'A').totalSlack).toBeLessThan(0);
  });

  it('lets links win when the honour-constraints option is off', () => {
    const { s } = plan([['A', '5d'], ['B', '1d', '1']], p => { p.settings.honorConstraints = false; p.tasks[1].constraint = 'MSO'; p.tasks[1].constraintDate = T('2026-01-07T08:00'); });
    expect(dates(s, 'B')[0]).toBe('2026-01-12T08:00');
  });

  it('applies Finish No Later Than, Must Finish On and As Late As Possible', () => {
    const { s } = plan([['A', '5d'], ['B', '2d'], ['C', '1d'], ['D', '1d', '3']], p => {
      p.tasks[1].constraint = 'MFO'; p.tasks[1].constraintDate = T('2026-01-08T17:00');
      p.tasks[2].constraint = 'ALAP';
    });
    expect(dates(s, 'B')).toEqual(['2026-01-07T08:00', '2026-01-08T17:00']);
    expect(dates(s, 'C')).toEqual(['2026-01-08T08:00', '2026-01-08T17:00']); // as late as D (before project finish) allows
    expect(dates(s, 'D')).toEqual(['2026-01-09T08:00', '2026-01-09T17:00']);
  });
});

describe('summary tasks, manual tasks, calendars and progress', () => {
  it('rolls up summaries and applies summary links to subtasks', () => {
    const { s } = plan([['Prep', '2d'], ['Phase', '1d', '1'], ['P1', '3d', undefined, 2], ['P2', '2d', '3', 2]]);
    expect(dates(s, 'P1')[0]).toBe('2026-01-07T08:00');
    expect(dates(s, 'Phase')).toEqual(['2026-01-07T08:00', '2026-01-13T17:00']);
    expect(row(s, 'Phase').duration).toBe(5 * D);
    expect(row(s, 'Phase').summary).toBe(true);
    expect(row(s, 'P2').wbs).toBe('2.2');
  });

  it('keeps manually scheduled tasks where they were put and warns about links', () => {
    let { p, s } = plan([['A', '5d'], ['B', '2d', '1']]);
    p = setMode(p, s, [p.tasks[1].uid], 'manual').p;
    p = editCell(p, schedule(p), p.tasks[1].uid, 'start', '7 Jan 26').p;
    s = schedule(p);
    expect(dates(s, 'B')).toEqual(['2026-01-07T08:00', '2026-01-08T17:00']);
    expect(row(s, 'B').indicators).toContain('manualWarn');
    p = setMode(p, s, [p.tasks[1].uid], 'auto').p;
    expect(dates(schedule(p), 'B')[0]).toBe('2026-01-12T08:00');
  });

  it('uses a task calendar and holidays', () => {
    const { s } = plan([['A', '2d'], ['B', '1d', '1'], ['C', '1d', '2']], p => {
      p.calendars[0].exceptions.push({ name: 'Holiday', start: '2026-01-07', finish: '2026-01-07', times: [] });
      p.tasks[2].calendar = '24hours';
    });
    expect(dates(s, 'B')).toEqual(['2026-01-08T08:00', '2026-01-08T17:00']);
    expect(dates(s, 'C')).toEqual(['2026-01-08T17:00', '2026-01-09T01:00']);
  });

  it('ignores inactive tasks in the schedule', () => {
    const { s } = plan([['A', '5d'], ['B', '1d', '1'], ['C', '1d', '2']], p => { p.tasks[1].active = false; });
    expect(dates(s, 'C')[0]).toBe('2026-01-05T08:00');
    expect(row(s, 'B').indicators).toContain('inactive');
  });

  it('records progress and pins actual start', () => {
    let { p, s } = plan([['A', '4d'], ['B', '2d', '1']]);
    p = setPercent(p, s, [p.tasks[0].uid], 50).p;
    expect(p.tasks[0].actualStart).toBe(T('2026-01-05T08:00'));
    p = { ...p, start: T('2026-01-06T08:00') };
    s = schedule(p);
    expect(dates(s, 'A')[0]).toBe('2026-01-05T08:00'); // actual start no longer moves
    expect(row(s, 'A').remaining).toBe(2 * D);
    p = setPercent(p, s, [p.tasks[0].uid], 100).p;
    expect(schedule(p).rows[0].indicators).toContain('complete');
  });

  it('marks tasks on track up to the status date', () => {
    let { p, s } = plan([['A', '4d']]);
    p = { ...p, statusDate: T('2026-01-06T17:00') };
    p = markOnTrack(p, s, [p.tasks[0].uid], 0).p;
    expect(p.tasks[0].percent).toBe(50);
  });

  it('saves baselines', () => {
    const { p, s } = plan([['A', '4d']]);
    const b = setBaseline(p, s, 0);
    expect(b.baselines[0]!.tasks[p.tasks[0].uid].finish).toBe(T('2026-01-08T17:00'));
    expect(schedule(b).rows[0].baseline?.duration).toBe(4 * D);
  });
});

describe('work, units and task types (task-type table)', () => {
  function withPeople() {
    const r = plan([['A', '4d']]);
    let p = addResources(r.p, 2).p;
    p = { ...p, resources: p.resources.map((x, i) => ({ ...x, name: ['Ann', 'Bob'][i], stdRate: [50, 40][i] })) };
    return p;
  }
  it('Fixed Units: duration change updates work; units change updates duration', () => {
    let p = withPeople();
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    expect(p.tasks[0].assignments[0].work).toBe(4 * D);
    p = editCell(p, schedule(p), p.tasks[0].uid, 'duration', '6d').p;
    expect(p.tasks[0].assignments[0].work).toBe(6 * D);
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann[50%]').p;
    expect(p.tasks[0].duration).toBe(12 * D);
    p = editCell(p, schedule(p), p.tasks[0].uid, 'work', '24h').p;
    expect(p.tasks[0].duration).toBe(6 * D);
  });

  it('Fixed Work: duration change updates units', () => {
    let p = withPeople();
    p = editCell(p, schedule(p), p.tasks[0].uid, 'type', 'Fixed Work').p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'duration', '8d').p;
    expect(p.tasks[0].assignments[0].units).toBe(0.5);
    expect(p.tasks[0].assignments[0].work).toBe(4 * D);
  });

  it('Fixed Duration: units change updates work; work change updates units', () => {
    let p = withPeople();
    p = editCell(p, schedule(p), p.tasks[0].uid, 'type', 'Fixed Duration').p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann[50%]').p;
    expect(p.tasks[0].duration).toBe(4 * D);
    expect(p.tasks[0].assignments[0].work).toBe(2 * D);
    p = editCell(p, schedule(p), p.tasks[0].uid, 'work', '32h').p;
    expect(p.tasks[0].assignments[0].units).toBe(1);
  });

  it('effort driven: adding a resource keeps total work and shortens the task', () => {
    let p = withPeople();
    p = { ...p, tasks: [{ ...p.tasks[0], effortDriven: true }] };
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann,Bob').p;
    expect(p.tasks[0].duration).toBe(2 * D);
    expect(p.tasks[0].assignments.map(a => a.work)).toEqual([2 * D, 2 * D]);
  });

  it('not effort driven: adding a resource adds work', () => {
    let p = withPeople();
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann,Bob').p;
    expect(p.tasks[0].duration).toBe(4 * D);
    expect(schedule(p).rows[0].work).toBe(8 * D);
  });

  it('costs work, material, cost resources and fixed cost; creates new resources from names', () => {
    let p = withPeople();
    p = addResources(p, 1, { name: 'Cement', type: 'Material', stdRate: 10, materialLabel: 'bags' }).p;
    p = addResources(p, 1, { name: 'Permit', type: 'Cost' }).p;
    const r = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann, Cement[20 bags], Permit[$500], Carla[50%]');
    p = r.p;
    expect(r.message).toMatch(/Carla/);
    p = editCell(p, schedule(p), p.tasks[0].uid, 'fixedCost', '100').p;
    const s = schedule(p);
    // Ann 32 h × 50 + Cement 20 × 10 + Permit 500 + Carla 16 h × 0 + fixed 100
    expect(s.rows[0].cost).toBe(1600 + 200 + 500 + 0 + 100);
    expect(formatResourceNames(p, p.tasks[0])).toBe('Ann,Cement[20 bags],Permit[$500],Carla[50%]');
  });

  it('flags overallocated resources', () => {
    let { p } = plan([['A', '2d'], ['B', '2d']]);
    p = addResources(p, 1, { name: 'Ann' }).p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[1].uid, 'resources', 'Ann').p;
    const s = schedule(p);
    expect(s.overallocated.has(p.resources[0].uid)).toBe(true);
    expect(s.rows[0].indicators).toContain('overallocated');
    p = editCell(p, s, p.tasks[1].uid, 'preds', '1').p;
    expect(schedule(p).overallocated.size).toBe(0);
  });
});

describe('outline editing', () => {
  it('inserts, indents, outdents, moves and deletes with subtasks', () => {
    let { p } = plan([['A', '1d'], ['B', '1d'], ['C', '1d'], ['D', '1d']]);
    const [a, b, c, dd] = p.tasks.map(t => t.uid);
    p = indent(p, [b, c], 1).p;
    expect(p.tasks.map(t => t.level)).toEqual([1, 2, 2, 1]);
    p = indent(p, [c], 1).p;
    expect(p.tasks.map(t => t.level)).toEqual([1, 2, 3, 1]);
    p = indent(p, [b], -1).p; // B moves out with its subtask C
    expect(p.tasks.map(t => t.level)).toEqual([1, 1, 2, 1]);
    p = moveTasks(p, [dd], -1).p; // D moves above B and its subtask
    expect(p.tasks.map(t => t.uid)).toEqual([a, dd, b, c]);
    p = insertTasks(p, 3, 2).p;
    expect(p.tasks.length).toBe(6);
    expect(p.tasks[3].level).toBe(2);
    p = deleteTasks(p, [b]).p; // removes B and its subtasks
    expect(p.tasks.map(t => t.name)).toEqual(['A', 'D']);
  });

  it('links and unlinks the selected tasks', () => {
    let { p } = plan([['A', '1d'], ['B', '1d'], ['C', '1d']]);
    const uids = p.tasks.map(t => t.uid);
    p = linkTasks(p, uids).p;
    expect(dates(schedule(p), 'C')[0]).toBe('2026-01-07T08:00');
    p = unlinkTasks(p, [uids[1]]).p;
    expect(p.tasks.every(t => !t.preds.length)).toBe(true);
  });
});

describe('scale', () => {
  it('schedules 5,000 linked tasks quickly', () => {
    const p = blankProject('Big');
    p.start = T('2026-01-05T08:00');
    p.calendars.push(hours24Calendar());
    for (let i = 0; i < 5000; i++) {
      const t: Task = newTask(p, { name: 'T' + i, level: i % 20 === 0 ? 1 : 2, duration: (1 + (i % 5)) * D, estimated: false });
      if (i % 20 > 1) t.preds = [{ pred: p.tasks[i - 1].uid, type: 'FS', lag: 0, lagUnit: 'd', lagElapsed: false, lagPercent: false }];
      p.tasks.push(t);
    }
    const t0 = performance.now();
    const s = schedule(p);
    const ms = performance.now() - t0;
    expect(s.rows.length).toBe(5000);
    expect(ms).toBeLessThan(1500);
  });
});

describe('resource leveling', () => {
  it('delays tasks until resources are free, by priority, and can be cleared', async () => {
    const { levelResources, clearLeveling } = await import('./level');
    let { p } = plan([['A', '2d'], ['B', '2d'], ['C', '1d']]);
    p = addResources(p, 1, { name: 'Ann' }).p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[1].uid, 'resources', 'Ann').p;
    p = editCell(p, schedule(p), p.tasks[2].uid, 'resources', 'Ann').p;
    p = { ...p, tasks: p.tasks.map((t, i) => (i === 1 ? { ...t, priority: 900 } : t)) };
    const r = levelResources(p);
    expect(r.unresolved).toEqual([]);
    expect(r.moved).toBe(2);
    const s = schedule(r.p);
    expect(s.overallocated.size).toBe(0);
    expect(dates(s, 'B')[0]).toBe('2026-01-05T08:00'); // highest priority goes first
    expect(dates(s, 'A')[0]).toBe('2026-01-07T08:00');
    expect(dates(s, 'C')[0]).toBe('2026-01-09T08:00');
    expect(schedule(clearLeveling(r.p)).overallocated.size).toBe(1);
  });

  it('reports resources that cannot be leveled', async () => {
    const { levelResources } = await import('./level');
    let { p } = plan([['A', '2d']]);
    p = addResources(p, 1, { name: 'Ann' }).p;
    p = editCell(p, schedule(p), p.tasks[0].uid, 'resources', 'Ann[200%]').p;
    expect(levelResources(p).unresolved).toEqual(['Ann']);
  });
});

describe('editing dates', () => {
  it('a start typed on a summary task holds back its subtasks', () => {
    let { p, s } = plan([['Phase', '1d'], ['A', '2d', undefined, 2], ['B', '1d', '2', 2]]);
    p = editCell(p, s, p.tasks[0].uid, 'start', '12 Jan 26').p;
    s = schedule(p);
    expect(dates(s, 'A')[0]).toBe('2026-01-12T08:00');
    expect(dates(s, 'Phase')[0]).toBe('2026-01-12T08:00');
    expect(editCell(p, s, p.tasks[0].uid, 'finish', '30 Jan 26').error).toBeTruthy();
  });

  it('typing dates on a started task changes its actual dates', () => {
    let { p, s } = plan([['A', '4d']]);
    p = setPercent(p, s, [p.tasks[0].uid], 50).p;
    s = schedule(p);
    p = editCell(p, s, p.tasks[0].uid, 'start', '6 Jan 26').p;
    expect(p.tasks[0].actualStart).toBe(T('2026-01-06T08:00'));
    s = schedule(p);
    expect(dates(s, 'A')).toEqual(['2026-01-06T08:00', '2026-01-09T17:00']);
    p = editCell(p, s, p.tasks[0].uid, 'finish', '13 Jan 26').p;
    expect(dates(schedule(p), 'A')[1]).toBe('2026-01-13T17:00');
  });

  it('accepts US-style dates', () => {
    let { p, s } = plan([['A', '1d']]);
    p = editCell(p, s, p.tasks[0].uid, 'start', '1/20/2026').p;
    s = schedule(p);
    expect(dates(s, 'A')[0]).toBe('2026-01-20T08:00');
  });
});

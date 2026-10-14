// Import and export: spreadsheets (CSV), Primavera XER, MPX and iCalendar.
import { describe, expect, it } from 'vitest';
import { fromTable, guessMapping, parseCsv } from './tabular';
import { fromXer, toXer, parseXer } from './xer';
import { fromMpx } from './mpx';
import { toIcs } from './ics';
import { schedule } from './schedule';
import { buildTemplate, TEMPLATES } from './templates';
import { parseIso } from './time';

const CSV = `ID,Task Name,Duration,Start,Predecessors,Resource Names,% Complete
1,Design,,,,,
2,  Survey,3d,2027-01-04,,Ana,50%
3,  Concept,5 days,,2,Ana;Ben[50%],
4,Build,,,,,
5,  Foundations,2w,,3,Crew,
6,  Handover,0,,5FS+2d,,`;

describe('spreadsheet import', () => {
  it('guesses the columns from their names', () => {
    expect(guessMapping(parseCsv(CSV)[0])).toEqual(['id', 'name', 'duration', 'start', 'preds', 'resources', 'percent']);
  });
  it('builds phases, durations, links and people', () => {
    const rows = parseCsv(CSV);
    const { p, report } = fromTable(rows.slice(1), guessMapping(rows[0]), { name: 'Test', source: 'test.csv' });
    expect(p.tasks.map(t => t.level)).toEqual([1, 2, 2, 1, 2, 2]);
    expect(report.tasks).toBe(6);
    expect(report.links).toBe(3);
    expect(p.resources.map(r => r.name)).toEqual(['Ana', 'Ben', 'Crew']);
    const s = schedule(p);
    const byName = (n: string) => s.rows.find(r => r.task.name === n)!;
    expect(byName('Survey').start).toBe(parseIso('2027-01-04T08:00'));
    expect(byName('Concept').start).toBeGreaterThan(byName('Survey').start);
    expect(byName('Handover').duration).toBe(0);
    expect(byName('Survey').percent).toBe(50);
    expect(p.tasks.find(t => t.name === 'Handover')!.preds[0]).toMatchObject({ type: 'FS', lag: 960 });
  });
  it('reads quoted CSV with semicolons', () => {
    expect(parseCsv('a;b\n"x;1";"say ""hi"""\n')).toEqual([['a', 'b'], ['x;1', 'say "hi"']]);
  });
});

describe('Primavera XER', () => {
  it('round-trips a plan through XER', () => {
    const p = buildTemplate(TEMPLATES[0].id, parseIso('2026-11-02T08:00')!);
    const s = schedule(p);
    const xer = toXer(p, s);
    expect(Object.keys(parseXer(xer))).toEqual(expect.arrayContaining(['PROJECT', 'PROJWBS', 'TASK', 'TASKPRED', 'RSRC', 'TASKRSRC']));
    const back = fromXer(xer).p;
    const s2 = schedule(back);
    const leaves = (sc: typeof s) => sc.rows.filter(r => !r.summary).map(r => r.task.name).sort();
    expect(leaves(s2)).toEqual(leaves(s));
    // Elapsed durations become working days (5 for 7), so the finish moves by a few days at most.
    expect(Math.abs(s2.finish - s.finish)).toBeLessThan(10 * 1440);
    expect(back.tasks.reduce((a, t) => a + t.preds.length, 0)).toBe(p.tasks.filter(t => s.byUid.get(t.uid) && !s.byUid.get(t.uid)!.summary).reduce((a, t) => a + t.preds.filter(l => !s.byUid.get(l.pred)?.summary).length, 0));
  });
});

describe('MPX', () => {
  it('reads tasks named by record 60', () => {
    const mpx = ['MPX,Cairn test,4.0,ANSI', '12,1', '30,Pump station', '60,ID,Name,Duration,Start,Outline Level,Predecessors',
      '61,90,1,40,50,3,70', '70,1,Civil works,,,1,', '70,2,Excavation,4d,05/01/2027 08:00,2,', '70,3,Base slab,3d,,2,2', '70,4,Ready,0d,,1,3'].join('\r\n');
    const { p } = fromMpx(mpx);
    expect(p.name).toBe('Pump station');
    expect(p.tasks.map(t => [t.name, t.level])).toEqual([['Civil works', 1], ['Excavation', 2], ['Base slab', 2], ['Ready', 1]]);
    const s = schedule(p);
    expect(s.rows[1].start).toBe(parseIso('2027-01-05T08:00'));
    expect(s.rows[3].duration).toBe(0);
  });
});

describe('iCalendar export', () => {
  it('lists milestones as all-day events', () => {
    const p = buildTemplate(TEMPLATES[0].id, parseIso('2026-11-02T08:00')!);
    const ics = toIcs(p);
    const s = schedule(p);
    const ms = s.rows.filter(r => !r.summary && r.duration === 0).length;
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBeGreaterThanOrEqual(ms);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
  });
});

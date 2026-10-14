import { describe, expect, it } from 'vitest';
import { fromProjectXml, isoMinutes, looksLikeProjectXml, minutesIso, toProjectXml } from './projectxml';
import { schedule } from './schedule';
import { parseXml, text } from './xml';
import { isoDateTime, parseIso } from './time';
import { buildTemplate, TEMPLATES } from './templates';
import type { Project } from './model';
import SAMPLE from './fixtures/sample-project.xml?raw';

const S = (t: number) => isoDateTime(t).slice(0, 16);
const byName = (p: Project, n: string) => p.tasks.find(t => t.name === n)!;

describe('xml reader', () => {
  it('reads elements, entities, CDATA and namespaces', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><a:Root xmlns:a="x"><b k="1 &amp; 2">x &lt; y &#65;&#x42;</b><c><![CDATA[<raw>]]></c><d/></a:Root>');
    expect(doc.name).toBe('Root');
    expect(doc.children[0].attrs.k).toBe('1 & 2');
    expect(text(doc, 'b')).toBe('x < y AB');
    expect(text(doc, 'c')).toBe('<raw>');
  });
  it('rejects broken XML', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/not well formed/);
    expect(() => parseXml('<a>')).toThrow(/unclosed/);
  });
});

describe('ISO durations', () => {
  it('converts', () => {
    expect(isoMinutes('PT16H0M0S')).toBe(960);
    expect(isoMinutes('PT7H30M0S')).toBe(450);
    expect(isoMinutes('P1DT4H0M0S')).toBe(720);
    expect(isoMinutes('nope')).toBeNull();
    expect(minutesIso(450)).toBe('PT7H30M0S');
  });
});

describe('project XML import', () => {
  const { p, report } = fromProjectXml(SAMPLE, 'sample.xml');
  const s = schedule(p);
  const d = (n: string) => { const r = s.rows.find(x => x.task.name === n)!; return [S(r.start), S(r.finish)]; };

  it('reads the header, settings and calendars', () => {
    expect(looksLikeProjectXml(SAMPLE)).toBe(true);
    expect(p.name).toBe('Pump Station Upgrade');
    expect(p.company).toBe('Example Water & Power');
    expect(S(p.start)).toBe('2026-02-02T08:00');
    expect(p.settings.minutesPerDay).toBe(480);
    expect(p.settings.currency).toBe('$');
    expect(p.calendar).toBe('cal-1');
    const std = p.calendars.find(c => c.id === 'cal-1')!;
    expect(std.week[1]).toEqual([{ from: 480, to: 720 }, { from: 780, to: 1020 }]);
    expect(std.exceptions.map(e => e.start)).toEqual(['2026-02-16']);
    expect(p.calendars.find(c => c.id === 'cal-3')!.base).toBe('cal-1');
  });

  it('builds the outline and task fields', () => {
    expect(p.tasks.map(t => [t.level, t.name])).toEqual([
      [1, 'Design'], [2, 'Survey & hydraulic model'], [2, 'Detailed design'],
      [1, 'Construction'], [2, 'Mobilise crew'], [2, 'Install pumps'], [2, 'Electrical tie-in'], [1, 'Commissioning complete']
    ]);
    const survey = byName(p, 'Survey & hydraulic model');
    expect([survey.duration, survey.percent, survey.fixedCost, survey.priority]).toEqual([2400, 100, 1500, 600]);
    expect(survey.notes).toBe('Includes <site> walk-down notes');
    expect(byName(p, 'Install pumps').duration).toBe(3600);
    expect(byName(p, 'Electrical tie-in').mode).toBe('manual');
    expect(byName(p, 'Electrical tie-in').type).toBe('FixedWork');
    expect(byName(p, 'Mobilise crew').constraint).toBe('SNET');
    expect(Object.values(survey.custom)).toEqual(['North', 3]);
    expect(report.tasks).toBe(8);
  });

  it('reads links, lags, resources, assignments and baselines', () => {
    const uid = (n: string) => byName(p, n).uid;
    expect(byName(p, 'Mobilise crew').preds[0]).toMatchObject({ pred: uid('Detailed design'), type: 'FS', lag: 480 });
    expect(byName(p, 'Electrical tie-in').preds[0]).toMatchObject({ type: 'SS', lag: 960 });
    expect(p.resources.map(r => [r.name, r.type, r.maxUnits])).toEqual([['Design Engineer', 'Work', 1], ['Site Lead', 'Work', 1], ['Fitters', 'Work', 3], ['Pipe spools', 'Material', 1], ['Crane hire', 'Cost', 1]]);
    expect(p.resources[0].rates).toEqual([{ from: parseIso('2026-03-01')!, rate: 95 }]);
    expect(p.resources[1].calendar).toBe('cal-3');
    const pumps = byName(p, 'Install pumps');
    expect(pumps.assignments.map(a => [a.units, a.work, a.cost])).toEqual([[1, 3600, 0], [2, 7200, 0], [12, 0, 0], [1, 0, 8500]]);
    expect(p.baselines[0]!.tasks[byName(p, 'Survey & hydraulic model').uid].cost).toBe(3500);
    expect(p.baselines[1]).not.toBeNull();
  });

  it('schedules to the dates saved in the file', () => {
    expect(d('Survey & hydraulic model')).toEqual(['2026-02-02T08:00', '2026-02-06T17:00']);
    expect(d('Detailed design')).toEqual(['2026-02-09T08:00', '2026-02-13T17:00']);
    expect(d('Mobilise crew')).toEqual(['2026-02-18T08:00', '2026-02-19T17:00']);
    expect(d('Install pumps')).toEqual(['2026-02-20T08:00', '2026-03-03T12:00']);
    expect(d('Electrical tie-in')).toEqual(['2026-02-26T08:00', '2026-03-02T17:00']);
    expect(d('Commissioning complete')).toEqual(['2026-03-03T12:00', '2026-03-03T12:00']);
  });

  it('reports what it could not import', () => {
    const all = report.notes.join('\n');
    expect(all).toMatch(/1 blank row/);
    expect(all).toMatch(/1 link\(s\) to other projects/);
    expect(all).toMatch(/work contours/);
  });

  it('rejects other XML', () => {
    expect(() => fromProjectXml('<Workbook><Sheet/></Workbook>')).toThrow(/not a project XML file/);
  });
});

describe('project XML export', () => {
  const summary = (p: Project) => schedule(p).rows.map(r => [r.task.name, r.task.level, r.task.mode, S(r.start), S(r.finish), r.duration, Math.round(r.cost), Math.round(r.work), r.critical]);

  it.each(TEMPLATES.map(t => t.id))('round-trips the %s template with identical results', id => {
    const p = buildTemplate(id, parseIso('2026-11-02T08:00')!);
    const back = fromProjectXml(toProjectXml(p).xml).p;
    expect(summary(back)).toEqual(summary(p));
    expect(back.resources.map(r => [r.name, r.type, r.stdRate, r.maxUnits])).toEqual(p.resources.map(r => [r.name, r.type, r.stdRate, r.maxUnits]));
    expect(back.calendars.find(c => c.id === back.calendar)!.exceptions.length).toBe(p.calendars.find(c => c.id === p.calendar)!.exceptions.length);
  });

  it('round-trips the imported file', () => {
    const p = fromProjectXml(SAMPLE).p;
    const back = fromProjectXml(toProjectXml(p).xml).p;
    expect(summary(back)).toEqual(summary(p));
    expect(back.baselines.filter(Boolean).length).toBe(2);
  });

  it('writes elements in schema order', () => {
    const ORDER: Record<string, string[]> = {
      Task: ['UID', 'ID', 'Name', 'Active', 'Manual', 'Type', 'IsNull', 'Contact', 'WBS', 'OutlineNumber', 'OutlineLevel', 'Priority', 'Start', 'Finish', 'Duration', 'ManualStart', 'ManualFinish', 'ManualDuration',
        'DurationFormat', 'Work', 'EffortDriven', 'Estimated', 'Milestone', 'Summary', 'Critical', 'FixedCost', 'FixedCostAccrual', 'PercentComplete',
        'ActualStart', 'ActualFinish', 'ConstraintType', 'CalendarUID', 'ConstraintDate', 'Deadline', 'LevelingDelay', 'LevelingDelayFormat', 'Hyperlink', 'HyperlinkAddress', 'HyperlinkSubAddress', 'Notes', 'HideBar', 'Rollup', 'PhysicalPercentComplete', 'EarnedValueMethod', 'PredecessorLink', 'ExtendedAttribute', 'Baseline'],
      Resource: ['UID', 'ID', 'Name', 'Type', 'IsNull', 'Initials', 'MaterialLabel', 'Group', 'MaxUnits', 'StandardRate', 'StandardRateFormat', 'OvertimeRate', 'OvertimeRateFormat', 'CostPerUse', 'CalendarUID', 'Notes', 'Rates'],
      Assignment: ['UID', 'TaskUID', 'ResourceUID', 'Cost', 'Finish', 'Start', 'Units', 'Work'],
      Calendar: ['UID', 'Name', 'IsBaseCalendar', 'BaseCalendarUID', 'WeekDays', 'Exceptions'],
      Exception: ['EnteredByOccurrences', 'TimePeriod', 'Occurrences', 'Name', 'Type', 'DayWorking', 'WorkingTimes']
    };
    const doc = parseXml(toProjectXml(fromProjectXml(SAMPLE).p).xml);
    const walk = (n: any) => {
      const order = ORDER[n.name];
      if (order) {
        const pos = n.children.map((c: any) => order.indexOf(c.name));
        expect(pos.every((v: number) => v >= 0)).toBe(true);
        expect(pos).toEqual([...pos].sort((a: number, b: number) => a - b));
      }
      n.children.forEach(walk);
    };
    walk(doc);
  });
});

describe('project XML: v0.7 task fields', () => {
  it('round-trips hyperlinks, contact, accrual, earned value method and bar flags', () => {
    const p = buildTemplate(TEMPLATES[0].id);
    const t = p.tasks.find(x => x.level > 1)!;
    t.hyperlink = { text: 'Spec', address: 'https://example.com/spec', sub: 'p2' };
    t.contact = 'Ana'; t.accrual = 'start'; t.evMethod = 'physical'; t.physPercent = 40; t.hideBar = true; t.rollup = true;
    const back = fromProjectXml(toProjectXml(p).xml).p.tasks.find(x => x.name === t.name)!;
    expect(back.hyperlink).toEqual({ text: 'Spec', address: 'https://example.com/spec', sub: 'p2' });
    expect([back.contact, back.accrual, back.evMethod, back.physPercent, back.hideBar, back.rollup]).toEqual(['Ana', 'start', 'physical', 40, true, true]);
  });
});

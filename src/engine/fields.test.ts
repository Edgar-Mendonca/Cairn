import { describe, expect, it } from 'vitest';
import { compile, evaluate, DateV, FormulaError, parseFormula, type FormulaEnv } from './formula';
import { blankFieldDef, blankProject, newTask, normalizeProject, type Project } from './model';
import { schedule } from './schedule';
import { editCell, setBaseline, setPercent } from './ops';
import { customValue, evalFormula, FIELDS, findField, indicatorFor } from './fields';
import { fromProjectXml, toProjectXml } from './projectxml';
import { parseIso } from './time';

const T = (s: string) => parseIso(s)!;
const run = (src: string, fields: Record<string, any> = {}) => {
  const env: FormulaEnv = {
    field: n => { if (!(n in fields)) throw new FormulaError('Unknown field [' + n + '].'); return fields[n]; },
    parseDate: t => (parseIso(t) ?? null), now: () => T('2026-10-13T09:00')
  };
  return evaluate(compile(src), env);
};

describe('formula language (syntax)', () => {
  it('follows VBA operator precedence', () => {
    expect(run('1 + 2 * 3 ^ 2')).toBe(19);
    expect(run('-2 ^ 2')).toBe(-4);
    expect(run('7 \\ 2 + 7 Mod 4')).toBe(6);
    expect(run('"a" & 1 + 2')).toBe('a3');
    expect(run('1 < 2 And Not 3 > 4 Or False')).toBe(true);
    expect(run('(1 + 2) * 3')).toBe(9);
  });

  it('works with fields, text and IIf / Switch', () => {
    const f = { Duration: 2400, '% Complete': 50, Name: 'Pour slab' };
    expect(run('[Duration] / 480', f)).toBe(5);
    expect(run('IIf([% Complete] = 100, "Done", IIf([% Complete] > 0, "Started", "Not started"))', f)).toBe('Started');
    expect(run('Switch([% Complete] < 25, "Low", [% Complete] < 75, "Mid", True, "High")', f)).toBe('Mid');
    expect(run('UCase(Left([Name], 4)) & "-" & Len([Name])', f)).toBe('POUR-9');
    expect(run('InStr([Name], "slab")', f)).toBe(6);
    expect(run('Format(0.257, "0.0%")')).toBe('25.7%');
    expect(run('Round(10 / 3, 2)')).toBe(3.33);
  });

  it('handles dates and NA', () => {
    const f = { Finish: new DateV(T('2026-10-20T17:00')), Deadline: null, 'Baseline Finish': new DateV(T('2026-10-15T17:00')) };
    expect(run('[Finish] - [Baseline Finish]', f)).toBe(5);
    expect(run('[Deadline] = "NA"', f)).toBe(true);
    expect(run('IIf([Deadline] = "NA", "No deadline", "Has deadline")', f)).toBe('No deadline');
    expect(run('DateDiff("d", [Baseline Finish], [Finish])', f)).toBe(5);
    expect(run('Year([Finish]) * 100 + Month([Finish])', f)).toBe(202610);
    expect((run('DateAdd("m", 1, [Finish])', f) as DateV).t).toBe(T('2026-11-20T17:00'));
    expect(run('Weekday([Finish])', f)).toBe(3); // Tuesday
    expect(run('[Finish] > #2026-10-01#', f)).toBe(true);
    expect((run('Date()') as DateV).t).toBe(T('2026-10-13'));
  });

  it('reports errors clearly', () => {
    expect(() => parseFormula('IIf([Duration] > 0, "a"')).toThrow(/Expected/);
    expect(() => parseFormula('[Duration')).toThrow(/closing \]/);
    expect(() => parseFormula('Foo(1)')).toThrow(/Unknown function/);
    expect(() => run('[Nope]')).toThrow(/Unknown field/);
    expect(() => run('1 / 0')).toThrow(/Division by zero/);
    expect(() => parseFormula('1 +')).toThrow(/ends too early/);
  });
});

function plan(rows: [string, string, number?][]) {
  let p = blankProject('T');
  p.start = T('2026-01-05T08:00');
  rows.forEach(([name, , level]) => p.tasks.push(newTask(p, { name, level: level ?? 1, estimated: false })));
  rows.forEach(([, d], i) => { p = editCell(p, schedule(p), p.tasks[i].uid, 'duration', d).p; });
  return p;
}
const withField = (p: Project, key: string, patch: Partial<ReturnType<typeof blankFieldDef>>) => ({ ...p, fields: { ...p.fields, [key]: { ...blankFieldDef(), ...patch } } });

describe('custom fields', () => {
  it('stores typed values by type and rejects bad input', () => {
    let p = plan([['A', '2d']]);
    const s = schedule(p), u = p.tasks[0].uid;
    p = editCell(p, s, u, 'custom:Text1', 'North').p;
    p = editCell(p, s, u, 'custom:Number2', '42.5').p;
    p = editCell(p, s, u, 'custom:Flag1', 'Yes').p;
    p = editCell(p, s, u, 'custom:Cost1', '$1,250').p;
    p = editCell(p, s, u, 'custom:Duration1', '3d').p;
    p = editCell(p, s, u, 'custom:Date1', '20 Jan 26').p;
    expect(p.tasks[0].custom).toEqual({ Text1: 'North', Number2: 42.5, Flag1: true, Cost1: 1250, Duration1: 1440, Date1: T('2026-01-20T08:00') });
    expect(editCell(p, s, u, 'custom:Number1', 'abc').error).toMatch(/number/);
    expect(editCell(p, s, u, 'custom:Text31', 'x').error).toBeTruthy();
  });

  it('calculates formulas, including working-time functions, and rolls up summaries', () => {
    let p = plan([['Phase', '1d'], ['A', '2d', 2], ['B', '3d', 2]]);
    p = withField(p, 'Number1', { alias: 'Days', formula: '[Duration] / 480', summary: 'sum' });
    p = withField(p, 'Text1', { alias: 'Health', formula: 'IIf([Total Slack] > 0, "Float", "Critical")', summary: 'formula' });
    p = withField(p, 'Duration1', { formula: 'ProjDateDiff([Start], [Finish])' });
    const s = schedule(p), c = { p, s };
    const row = (n: string) => s.rows.find(r => r.task.name === n)!;
    expect(customValue(row('A'), c, 'Number1')).toBe(2);
    expect(customValue(row('Phase'), c, 'Number1')).toBe(5);
    expect(customValue(row('A'), c, 'Text1')).toBe('Float'); // A has 1 day of slack beside the 3-day B
    expect(customValue(row('Phase'), c, 'Text1')).toBe('Critical');
    expect(customValue(row('B'), c, 'Duration1')).toBe(1440);
    expect(findField('Days', p)?.key).toBe('Number1');
    expect(editCell(p, s, row('A').task.uid, 'custom:Number1', '3').error).toMatch(/formula/);
  });

  it('shows #ERROR for broken formulas and stops self-reference', () => {
    let p = plan([['A', '2d']]);
    p = withField(p, 'Number1', { formula: '[Number1] + 1' });
    p = withField(p, 'Number2', { formula: '1 / ([Duration] - [Duration])' });
    const s = schedule(p), c = { p, s };
    expect(customValue(s.rows[0], c, 'Number1')).toBe('#ERROR');
    expect(customValue(s.rows[0], c, 'Number2')).toBe('#ERROR');
    expect(evalFormula('[% Complete] + 1', s.rows[0], c)).toBe(1);
  });

  it('chooses graphical indicators from rules', () => {
    const def = { ...blankFieldDef(), display: 'indicators' as const, indicators: [
      { test: 'gt' as const, value: '10', value2: '', icon: 'circle-red' },
      { test: 'gt' as const, value: '0', value2: '', icon: 'circle-yellow' },
      { test: 'any' as const, value: '', value2: '', icon: 'circle-green' }
    ] };
    expect(indicatorFor(def, 12, false, 'number')).toBe('circle-red');
    expect(indicatorFor(def, 5, false, 'number')).toBe('circle-yellow');
    expect(indicatorFor(def, 0, false, 'number')).toBe('circle-green');
    const text = { ...def, indicators: [{ test: 'contains' as const, value: 'late', value2: '', icon: 'flag-red' }] };
    expect(indicatorFor(text, 'Running late', false, 'text')).toBe('flag-red');
    expect(indicatorFor(text, 'Fine', false, 'text')).toBeNull();
  });

  it('computes earned value fields', () => {
    let p = plan([['A', '4d']]);
    p = setBaseline(p, schedule(p), 0);
    p = { ...p, statusDate: T('2026-01-06T17:00'), tasks: p.tasks.map(t => ({ ...t, fixedCost: 1000 })) };
    p = setBaseline(p, schedule(p), 0);
    p = setPercent(p, schedule(p), [p.tasks[0].uid], 25).p;
    const s = schedule(p), c = { p, s };
    const get = (k: string) => FIELDS.find(f => f.key === k)!.get(s.rows[0], c);
    expect(get('bcws')).toBe(500);
    expect(get('bcwp')).toBe(250);
    expect(get('acwp')).toBe(250);
    expect(get('spi')).toBe(0.5);
    expect(get('cpi')).toBe(1);
  });

  it('moves 0.5 free-form custom fields to Text and Number fields', () => {
    const raw = JSON.parse(JSON.stringify(plan([['A', '1d']])));
    delete raw.fields;
    raw.customFields = [{ id: 'f1', name: 'Area', type: 'text' }, { id: 'f2', name: 'Score', type: 'number' }];
    raw.tasks[0].custom = { f1: 'North', f2: 7 };
    const p = normalizeProject(raw);
    expect(p.fields.Text1.alias).toBe('Area');
    expect(p.fields.Number1.alias).toBe('Score');
    expect(p.tasks[0].custom).toEqual({ Text1: 'North', Number1: 7 });
  });

  it('round-trips custom fields through XML', () => {
    let p = plan([['Phase', '1d'], ['A', '2d', 2]]);
    p = withField(p, 'Text3', { alias: 'Area', values: [{ value: 'North', desc: '' }, { value: 'South', desc: '' }], restrict: true });
    p = withField(p, 'Number1', { alias: 'Days', formula: '[Duration] / 480', summary: 'sum' });
    const s = schedule(p), u = p.tasks[1].uid;
    p = editCell(p, s, u, 'custom:Text3', 'South').p;
    p = editCell(p, s, u, 'custom:Flag5', 'Yes').p;
    p = editCell(p, s, u, 'custom:Cost2', '99.5').p;
    p = editCell(p, s, u, 'custom:Finish4', '30 Jan 26').p;
    const xml = toProjectXml(p).xml;
    expect(xml).toContain('<FieldID>188743737</FieldID>'); // Text3
    const back = fromProjectXml(xml).p;
    expect(back.fields.Text3).toMatchObject({ alias: 'Area', restrict: true });
    expect(back.fields.Text3.values.map(v => v.value)).toEqual(['North', 'South']);
    expect(back.fields.Number1).toMatchObject({ alias: 'Days', formula: '[Duration] / 480', summary: 'sum' });
    expect(back.tasks[1].custom).toEqual({ Text3: 'South', Flag5: true, Cost2: 99.5, Finish4: T('2026-01-30T17:00') });
  });
});

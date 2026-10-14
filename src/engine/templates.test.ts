import { describe, expect, it } from 'vitest';
import { buildTemplate, TEMPLATES } from './templates';
import { schedule } from './schedule';
import { customValue } from './fields';
import { parseIso, isoDate } from './time';

describe('templates', () => {
  it.each(TEMPLATES.map(t => t.id))('%s builds a linked, resourced, baselined plan', id => {
    const p = buildTemplate(id, parseIso('2026-10-13')!);
    const s = schedule(p);
    expect(isoDate(p.start)).toBe('2026-10-19'); // next Monday
    expect(s.cycle).toEqual([]);
    expect(s.rows.filter(r => !r.summary && r.task.preds.length).length).toBeGreaterThan(s.rows.length / 2);
    expect(s.rows.some(r => r.critical)).toBe(true);
    expect(p.resources.length).toBeGreaterThan(3);
    expect(p.baselines[0]).not.toBeNull();
    expect(s.rows.every(r => r.indicators.every(i => i !== 'conflict' && i !== 'cycle'))).toBe(true);
    expect(s.rows.find(r => r.task.deadline != null)?.indicators).not.toContain('deadline');
  });

  it('the EPC template shows a float indicator from a formula', () => {
    const p = buildTemplate('epc');
    const s = schedule(p);
    const crit = s.rows.find(r => !r.summary && r.critical)!;
    expect(customValue(crit, { p, s }, 'Number1')).toBe(0);
    expect(p.tables.entry.some(c => c.field === 'Number1')).toBe(true);
  });
});

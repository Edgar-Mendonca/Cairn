import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickadd';

describe('quick add', () => {
  it('reads name, duration, links, people and dates', () => {
    expect(parseQuickAdd('Pour slab 5d after 4 @Crew by 20 Mar')).toEqual({ name: 'Pour slab', duration: '5d', milestone: false, after: ['4'], people: ['Crew'], by: '20 Mar' });
    expect(parseQuickAdd('Design review ! after "Detailed design", 7 @Ana[50%] @"Site team"')).toEqual({ name: 'Design review', milestone: true, after: ['Detailed design', '7'], people: ['Ana[50%]', 'Site team'] });
    expect(parseQuickAdd('Order pumps 2 weeks from 3/4/2027')).toMatchObject({ name: 'Order pumps', duration: '2weeks', from: '3/4/2027' });
  });
  it('keeps numbers that are part of the name', () => {
    const r = parseQuickAdd('Install level 3 handrails');
    expect(r.name).toBe('Install level 3 handrails');
    expect(r.duration).toBeUndefined();
  });
});

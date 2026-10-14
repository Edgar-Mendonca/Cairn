// Timescale tiers for the Gantt chart, usage views and printing (Format › Timescale).
import type { Timescale, Tier } from '../../engine/model';
import { formatUnitLabel, unitNext, unitStart, type Minutes } from '../../engine/time';

export interface TierCell { x: number; w: number; label: string; t: Minutes }

export function tierCells(tier: Tier, ts: Timescale, from: Minutes, to: Minutes, x: (t: Minutes) => number): TierCell[] {
  const out: TierCell[] = [];
  const count = Math.max(1, tier.count);
  let t = unitStart(tier.unit, from, ts.weekStart, ts.fiscalStart);
  // Align multi-unit tiers (every 3 hours, every 2 weeks) to a stable origin.
  for (let k = 0; t < to && k < 20000; k++) {
    const n = unitNext(tier.unit, t, count);
    const xa = x(t), xb = x(n);
    out.push({ x: xa, w: xb - xa, label: fit(tier, t, xb - xa, ts.fiscalStart), t });
    t = n;
  }
  return out;
}

// Uses the chosen label; when it does not fit the cell, shorter forms of the same unit.
function fit(tier: Tier, t: Minutes, w: number, fiscal: number): string {
  const full = formatUnitLabel(tier.label, t, fiscal);
  if (full.length * 6.2 + 6 <= w) return full;
  const short: Record<string, string[]> = {
    day: ['ddd d', 'd', 'd1'], week: ['d MMM', 'd'], month: ['MMM', 'M1'], quarter: ['Qn'], half: ['H1'], year: ["'yy", 'yy'], hour: ['h', ''], third: ['T'], minute: ['mm']
  };
  for (const f of short[tier.unit] || []) { const v = formatUnitLabel(f, t, fiscal); if (v.length * 6.2 + 6 <= w) return v; }
  return '';
}

export function activeTiers(ts: Timescale): Tier[] {
  return ts.tiers === 1 ? [ts.bottom] : ts.tiers === 2 ? [ts.middle, ts.bottom] : [ts.top, ts.middle, ts.bottom];
}

export const tierHeight = (ts: Timescale) => (ts.tiers === 3 ? 60 : 44);
export const pxPerDay = (ts: Timescale) => ts.px * ts.size / 100;

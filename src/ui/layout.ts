// Row positions shared by the task table and the Gantt chart. Rows are 24 px, taller when a column wraps its text,
// when a larger font is used, when a row is given more lines, or when Gantt bar styles stack bars below the first.
import type { Row } from '../engine/schedule';
import type { Column, Ctx } from './columns';
import { BASE_SIZE, rowFontPx } from './actions';

export const ROW_H = 24;
export const HEAD_H = 44;
export const BLANK_ROWS = 40;
const LINE_H = 16;

export interface Layout {
  count: number;                  // rows including the blank rows below the plan
  top: (i: number) => number;
  height: (i: number) => number;
  total: number;
  indexAt: (y: number) => number;
}

export function uniformLayout(n: number): Layout {
  const count = n + BLANK_ROWS;
  return { count, top: i => i * ROW_H, height: () => ROW_H, total: count * ROW_H, indexAt: y => Math.max(0, Math.min(count - 1, Math.floor(y / ROW_H))) };
}

let canvas: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();
function textWidth(t: string, bold: boolean, px = 12): number {
  const k = (bold ? 'b' : '') + px + '|' + t;
  let w = cache.get(k);
  if (w == null) {
    if (!canvas) { const c = document.createElement('canvas').getContext('2d'); canvas = c; }
    if (canvas) { canvas.font = (bold ? '600 ' : '') + px + 'px "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif'; w = canvas.measureText(t).width; }
    else w = t.length * px * 0.55;
    if (cache.size > 20000) cache.clear();
    cache.set(k, w);
  }
  return w;
}

// Number of lines a text needs in a column of the given width, breaking at spaces as a word processor does.
export function lineCount(text: string, width: number, bold = false, px = 12): number {
  if (!text) return 1;
  const words = text.split(/\s+/);
  let lines = 1, cur = 0;
  const space = textWidth(' ', bold, px);
  for (const w of words) {
    const ww = textWidth(w, bold, px);
    if (cur === 0) cur = ww;
    else if (cur + space + ww <= width) cur += space + ww;
    else { lines++; cur = ww; }
  }
  return Math.min(lines, 8);
}

export function makeLayout(rows: Row[], cols: Column[], ctx: Ctx, minH = ROW_H): Layout {
  const wrapCols = cols.filter(c => c.wrap);
  const p = ctx.p;
  const sized = Object.values(p.textStyles).some(f => f.size) || p.tasks.some(t => t.style && (t.style.lines || t.style.row?.size || (t.style.cells && Object.values(t.style.cells).some(f => f.size))));
  if (!wrapCols.length && !sized && minH <= ROW_H) return uniformLayout(rows.length);
  const tops = new Array<number>(rows.length + 1);
  const keys = cols.map(c => c.key);
  let y = 0;
  rows.forEach((r, i) => {
    tops[i] = y;
    const px = sized ? rowFontPx(r, p, keys) : BASE_SIZE;
    const lineH = Math.max(LINE_H, Math.round(px * 1.34));
    let lines = 1;
    for (const c of wrapCols) {
      const indent = c.key === 'name' ? 16 + Math.max(0, r.task.level - 1) * 14 : 0;
      lines = Math.max(lines, lineCount(c.text(r, ctx), c.width - 12 - indent, r.summary, px));
    }
    lines = Math.max(lines, r.task.style?.lines || 1);
    const h = lines > 1 ? lines * lineH + 8 : Math.max(ROW_H, lineH + 8);
    y += Math.max(h, minH);
  });
  tops[rows.length] = y;
  const n = rows.length, count = n + BLANK_ROWS;
  const top = (i: number) => (i <= n ? tops[i] : tops[n] + (i - n) * ROW_H);
  return {
    count, top, total: tops[n] + BLANK_ROWS * ROW_H,
    height: i => (i < n ? tops[i + 1] - tops[i] : ROW_H),
    indexAt: yy => {
      if (yy >= tops[n]) return Math.min(count - 1, n + Math.floor((yy - tops[n]) / ROW_H));
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= yy) lo = mid; else hi = mid - 1; }
      return Math.max(0, lo);
    }
  };
}

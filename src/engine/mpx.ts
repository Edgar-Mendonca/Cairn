// MPX files (an older text exchange format): records are comma-separated lines that start with a record number.
// Record 60 names the task fields in the order record 70 (a task) lists them, so the tasks are read as a table
// and go through the same import as spreadsheets.
import { fromTable, type ColumnRole, type Mapping } from './tabular';
import type { ImportReport } from './projectxml';
import type { Project } from './model';

function splitMpx(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export const looksLikeMpx = (text: string) => /^﻿?MPX[,;]/.test(text);

// Field numbers of record 61, for files whose record 60 is missing.
const BY_NUMBER: Record<string, ColumnRole> = { '1': 'name', '2': 'wbs', '3': 'level', '40': 'duration', '44': 'percent', '50': 'start', '51': 'finish', '70': 'preds', '90': 'id', '96': 'milestone' };
const BY_NAME: [RegExp, ColumnRole][] = [[/^name$/i, 'name'], [/^wbs$/i, 'wbs'], [/^outline level$/i, 'level'], [/^duration$/i, 'duration'], [/^% complete$/i, 'percent'], [/^start$/i, 'start'],
  [/^finish$/i, 'finish'], [/^predecessors$/i, 'preds'], [/^resource names$/i, 'resources'], [/^id$/i, 'id'], [/^milestone$/i, 'milestone'], [/^notes$/i, 'notes'], [/^deadline$/i, 'deadline'], [/^priority$/i, 'priority'], [/^fixed cost$/i, 'cost']];

export function fromMpx(text: string, source = 'MPX'): { p: Project; report: ImportReport } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const sep = lines[0][3] || ',';
  let names: string[] = [], numbers: string[] = [], projectName = '', dateOrder = '0';
  const rows: string[][] = [];
  const notesFor = new Map<number, string>();
  for (const line of lines) {
    const c = splitMpx(line, sep);
    switch (c[0]) {
      case '12': dateOrder = c[1] || '0'; break;           // date and time settings: 0 MDY, 1 DMY, 2 YMD
      case '30': projectName = c[1] || ''; break;          // project header: title
      case '60': names = c.slice(1); break;
      case '61': numbers = c.slice(1); break;
      case '70': rows.push(c.slice(1)); break;
      case '71': notesFor.set(rows.length - 1, c.slice(1).join(sep)); break;
    }
  }
  if (!rows.length) throw new Error('This MPX file has no tasks.');
  const map: Mapping = (names.length ? names : numbers).map((h, i) => {
    if (names.length) { const hit = BY_NAME.find(([re]) => re.test(h.trim())); if (hit) return hit[1]; }
    return BY_NUMBER[numbers[i]] || 'skip';
  });
  if (!map.includes('notes') && notesFor.size) { map.push('notes'); rows.forEach((r, i) => r.push(notesFor.get(i) || '')); }
  const r = fromTable(rows, map, { name: projectName || 'Imported MPX plan', source, dateFormat: dateOrder === '1' ? 'ndmy' : dateOrder === '2' ? 'iso' : 'nmdy' });
  return r;
}

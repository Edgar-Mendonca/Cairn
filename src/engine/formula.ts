// Custom field formulas in the common project-scheduling formula syntax (a subset of VBA expressions):
//   IIf([% Complete] = 100, "Done", IIf([Finish] > [Deadline], "Late", "On track"))
//   ProjDateDiff([Baseline Finish], [Finish]) / 480
//   [Cost] - [Baseline Cost]
// Field names go in square brackets. Strings use double quotes. Dates are written #2026-10-13# or come from fields.
// Durations and work are in minutes. Date minus date gives days; date plus a number adds days.
import type { Minutes } from './time';

export class DateV {
  constructor(readonly t: Minutes) {}
}
export type Val = number | string | boolean | DateV | null;

export interface FormulaEnv {
  field(name: string): Val;                         // value of [name]; throws for an unknown field
  dateAdd?(t: Minutes, minutes: number, cal?: string): Minutes;   // working-time arithmetic (ProjDateAdd etc.)
  workBetween?(a: Minutes, b: Minutes, cal?: string): number;
  formatDate?(t: Minutes): string;
  formatDuration?(minutes: number, unit?: number): string;
  parseDuration?(text: string): number | null;
  parseDate?(text: string): Minutes | null;
  now?(): Minutes;
}

export class FormulaError extends Error {}

/* ---------- tokens ---------- */

type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'field'; v: string } | { k: 'date'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new FormulaError('A text value is missing its closing quote.');
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      out.push({ k: 'str', v: s });
      continue;
    }
    if (c === '[') {
      const e = src.indexOf(']', i);
      if (e < 0) throw new FormulaError('A field name is missing its closing ].');
      out.push({ k: 'field', v: src.slice(i + 1, e).trim() });
      i = e + 1;
      continue;
    }
    if (c === '#') {
      const e = src.indexOf('#', i + 1);
      if (e < 0) throw new FormulaError('A date is missing its closing #.');
      out.push({ k: 'date', v: src.slice(i + 1, e).trim() });
      i = e + 1;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/\\^&=<>(),'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new FormulaError('Unexpected character “' + c + '”.');
  }
  return out;
}

/* ---------- parser (VBA precedence) ---------- */

export type Node =
  | { t: 'lit'; v: Val }
  | { t: 'field'; name: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

const KEYWORD_OPS = ['and', 'or', 'not', 'xor', 'mod', 'eqv', 'imp', 'like'];

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => { const t = toks[pos]; return !!t && ((t.k === 'op' && t.v === v) || (t.k === 'id' && t.v.toLowerCase() === v)); };
  const take = (v: string) => { if (isOp(v)) { pos++; return true; } return false; };
  const expect = (v: string) => { if (!take(v)) throw new FormulaError('Expected “' + v + '”' + (peek() ? ' before “' + String(peek().v) + '”' : ' at the end') + '.'); };

  const level = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    for (;;) {
      const op = ops.find(o => isOp(o));
      if (!op) return a;
      pos++;
      a = { t: 'bin', op, a, b: next() };
    }
  };
  const primary = (): Node => {
    const t = toks[pos++];
    if (!t) throw new FormulaError('The formula ends too early.');
    if (t.k === 'num') return { t: 'lit', v: t.v };
    if (t.k === 'str') return { t: 'lit', v: t.v };
    if (t.k === 'field') return { t: 'field', name: t.v };
    if (t.k === 'date') return { t: 'call', name: 'datevalue', args: [{ t: 'lit', v: t.v }] };
    if (t.k === 'op' && t.v === '(') { const e = expr(); expect(')'); return e; }
    if (t.k === 'id') {
      const name = t.v.toLowerCase();
      if (name === 'true') return { t: 'lit', v: true };
      if (name === 'false') return { t: 'lit', v: false };
      if (name === 'null' || name === 'empty') return { t: 'lit', v: null };
      if (name in CONSTANTS) return { t: 'lit', v: CONSTANTS[name] };
      if (KEYWORD_OPS.includes(name)) throw new FormulaError('“' + t.v + '” needs a value before it.');
      const args: Node[] = [];
      if (take('(')) {
        if (!take(')')) {
          do args.push(expr()); while (take(','));
          expect(')');
        }
      }
      if (!(name in FUNCS)) throw new FormulaError('Unknown function “' + t.v + '”.');
      return { t: 'call', name, args };
    }
    throw new FormulaError('Unexpected “' + t.v + '”.');
  };
  const power = (): Node => { const a = primary(); return take('^') ? { t: 'bin', op: '^', a, b: unary() } : a; };
  const unary = (): Node => (take('-') ? { t: 'un', op: '-', a: unary() } : take('+') ? unary() : power());
  const mult = level(['*', '/'], unary);
  const idiv = level(['\\'], mult);
  const mod = level(['mod'], idiv);
  const add = level(['+', '-'], mod);
  const concat = level(['&'], add);
  const compare = level(['=', '<>', '<=', '>=', '<', '>', 'like'], concat);
  const not = (): Node => (take('not') ? { t: 'un', op: 'not', a: not() } : compare());
  const and = level(['and'], not);
  const or = level(['or'], and);
  const xor = level(['xor', 'eqv', 'imp'], or);
  const expr = xor;
  const tree = expr();
  if (pos < toks.length) throw new FormulaError('Unexpected “' + String(toks[pos].v) + '” after the end of the formula.');
  return tree;
}

/* ---------- values ---------- */

const MIN_PER_DAY = 1440;
const isDate = (v: Val): v is DateV => v instanceof DateV;

export function toNum(v: Val): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? -1 : 0;
  if (isDate(v)) return v.t / MIN_PER_DAY;
  const s = v.trim().replace(/[,$€£¥]/g, '').replace(/%$/, '');
  if (s === '') return 0;
  const n = Number(s);
  if (!isFinite(n)) throw new FormulaError('“' + v + '” is not a number.');
  return n;
}
export const toBool = (v: Val): boolean => (typeof v === 'string' ? /^(true|yes|-1|1)$/i.test(v.trim()) : v != null && toNum(v) !== 0);
export function toStr(v: Val, env?: FormulaEnv): string {
  if (v == null) return isNullDate(v) ? 'NA' : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (isDate(v)) return env?.formatDate ? env.formatDate(v.t) : new Date(v.t * 60000).toISOString().slice(0, 16).replace('T', ' ');
  if (typeof v === 'number') return String(Math.round(v * 1e9) / 1e9);
  return v;
}
const isNullDate = (v: Val) => v === null;

function toDate(v: Val, env: FormulaEnv): DateV | null {
  if (v == null) return null;
  if (isDate(v)) return v;
  if (typeof v === 'number') return new DateV(Math.round(v * MIN_PER_DAY));
  if (typeof v === 'string') {
    if (/^\s*na\s*$/i.test(v)) return null;
    const t = env.parseDate ? env.parseDate(v) : null;
    if (t == null) throw new FormulaError('“' + v + '” is not a date.');
    return new DateV(t);
  }
  throw new FormulaError('Expected a date.');
}

function compare(a: Val, b: Val, env: FormulaEnv): number {
  // "NA" compares equal to an empty date, for formulas such as [Deadline] = "NA".
  const naA = a == null || (typeof a === 'string' && /^na$/i.test(a.trim()));
  const naB = b == null || (typeof b === 'string' && /^na$/i.test(b.trim()));
  if (naA || naB) {
    if ((a == null || isDate(a) || naA) && (b == null || isDate(b) || naB)) return naA && naB ? 0 : naA ? 1 : -1;
  }
  if (isDate(a) || isDate(b)) {
    const x = toDate(a, env), y = toDate(b, env);
    return (x ? x.t : Infinity) - (y ? y.t : Infinity);
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' || typeof b === 'string') {
    const n1 = typeof a === 'string' ? Number(a) : toNum(a), n2 = typeof b === 'string' ? Number(b) : toNum(b);
    if (isFinite(n1) && isFinite(n2)) return n1 - n2;
    const s1 = toStr(a, env), s2 = toStr(b, env);
    return s1 < s2 ? -1 : s1 > s2 ? 1 : 0;
  }
  return toNum(a) - toNum(b);
}

function like(s: string, pattern: string) {
  const re = '^' + pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/#/g, '\\d') + '$';
  return new RegExp(re, 'i').test(s);
}

/* ---------- functions ---------- */

// Duration format constants (ProjDurConv).
const CONSTANTS: Record<string, number> = {
  pjminutes: 3, pjelapsedminutes: 4, pjhours: 5, pjelapsedhours: 6, pjdays: 7, pjelapseddays: 8, pjweeks: 9, pjelapsedweeks: 10,
  pjmonths: 11, pjelapsedmonths: 12, pjpercent: 19, vbsunday: 1, vbmonday: 2, vbtuesday: 3, vbwednesday: 4, vbthursday: 5, vbfriday: 6, vbsaturday: 7
};

type Fn = (args: Val[], env: FormulaEnv) => Val;
const n = toNum, s = toStr;
const need = (args: unknown[], min: number, max = min, name = '') => {
  if (args.length < min || args.length > max) throw new FormulaError(name + ' needs ' + (min === max ? min : min + ' to ' + max) + ' argument' + (max === 1 ? '' : 's') + '.');
};
const date = (v: Val, env: FormulaEnv) => { const d = toDate(v, env); if (!d) throw new FormulaError('The date is NA.'); return d; };
const parts = (d: DateV) => { const x = new Date(d.t * 60000); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes(), wd: x.getUTCDay() }; };
const mk = (y: number, m: number, d: number, h = 0, mi = 0) => new DateV(Math.round(Date.UTC(y, m - 1, d, h, mi) / 60000));
const INTERVAL: Record<string, number> = { n: 1, h: 60, d: 1440, y: 1440, w: 1440, ww: 10080 };

function dateAdd(interval: string, k: number, d: DateV): DateV {
  const i = interval.toLowerCase();
  if (i === 'yyyy' || i === 'q' || i === 'm') {
    const p = parts(d), months = i === 'yyyy' ? k * 12 : i === 'q' ? k * 3 : k;
    return mk(p.y, p.m + months, p.d, p.h, p.mi);
  }
  const unit = i === 's' ? 1 / 60 : INTERVAL[i];
  if (!unit) throw new FormulaError('Unknown interval “' + interval + '”.');
  return new DateV(Math.round(d.t + k * unit));
}

function dateDiff(interval: string, a: DateV, b: DateV): number {
  const i = interval.toLowerCase(), pa = parts(a), pb = parts(b);
  if (i === 'yyyy') return pb.y - pa.y;
  if (i === 'q') return (pb.y * 4 + Math.floor((pb.m - 1) / 3)) - (pa.y * 4 + Math.floor((pa.m - 1) / 3));
  if (i === 'm') return (pb.y * 12 + pb.m) - (pa.y * 12 + pa.m);
  const dayA = Math.floor(a.t / 1440), dayB = Math.floor(b.t / 1440);
  if (i === 'd' || i === 'y') return dayB - dayA;
  if (i === 'w') return Math.trunc((dayB - dayA) / 7);
  if (i === 'ww') return Math.floor((dayB + 4) / 7) - Math.floor((dayA + 4) / 7);
  if (i === 'h') return Math.floor(b.t / 60) - Math.floor(a.t / 60);
  if (i === 'n') return b.t - a.t;
  if (i === 's') return (b.t - a.t) * 60;
  throw new FormulaError('Unknown interval “' + interval + '”.');
}

function format(v: Val, f: string, env: FormulaEnv): string {
  if (isDate(v)) {
    const p = parts(v), M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const lf = f.toLowerCase();
    if (lf === 'short date') return p.m + '/' + p.d + '/' + p.y;
    if (lf === 'long date') return M[p.m - 1] + ' ' + p.d + ', ' + p.y;
    if (lf === 'medium date') return p.d + '-' + M[p.m - 1].slice(0, 3) + '-' + String(p.y).slice(2);
    const pad = (x: number) => String(x).padStart(2, '0');
    return f.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|nn/g, t => ({
      yyyy: String(p.y), yy: String(p.y).slice(2), mmmm: M[p.m - 1], mmm: M[p.m - 1].slice(0, 3), mm: pad(p.m), m: String(p.m),
      dddd: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][p.wd], ddd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.wd],
      dd: pad(p.d), d: String(p.d), hh: pad(p.h), nn: pad(p.mi)
    } as Record<string, string>)[t]);
  }
  const x = n(v);
  const lf = f.toLowerCase();
  if (lf === 'percent') return (x * 100).toFixed(2) + '%';
  if (lf === 'currency') return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (lf === 'fixed') return x.toFixed(2);
  if (lf === 'standard') return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m = /^([#,0]*)(?:\.(0+|#+))?(%?)$/.exec(f);
  if (m) {
    const dp = m[2] ? m[2].length : 0, val = m[3] ? x * 100 : x;
    const str = m[1].includes(',') ? val.toLocaleString('en-US', { minimumFractionDigits: m[2]?.startsWith('0') ? dp : 0, maximumFractionDigits: dp }) : val.toFixed(dp);
    return str + m[3];
  }
  return toStr(v, env);
}

const FUNCS: Record<string, Fn> = {
  // logic
  iif: (a) => { need(a, 3, 3, 'IIf'); return toBool(a[0]) ? a[1] : a[2]; },
  switch: (a) => { if (a.length % 2) throw new FormulaError('Switch needs pairs of condition and value.'); for (let i = 0; i < a.length; i += 2) if (toBool(a[i])) return a[i + 1]; return null; },
  choose: (a) => { const i = Math.trunc(n(a[0])); return i >= 1 && i < a.length ? a[i] : null; },
  isnull: (a) => a[0] == null,
  isnumeric: (a) => { try { return a[0] != null && typeof a[0] !== 'boolean' && !isDate(a[0]) && isFinite(Number(a[0])) && String(a[0]).trim() !== ''; } catch { return false; } },
  isdate: (a, e) => { try { return toDate(a[0], e) != null; } catch { return false; } },
  // math
  abs: (a) => Math.abs(n(a[0])), int: (a) => Math.floor(n(a[0])), fix: (a) => Math.trunc(n(a[0])), sgn: (a) => Math.sign(n(a[0])),
  sqr: (a) => { const x = n(a[0]); if (x < 0) throw new FormulaError('Sqr of a negative number.'); return Math.sqrt(x); },
  exp: (a) => Math.exp(n(a[0])), log: (a) => { const x = n(a[0]); if (x <= 0) throw new FormulaError('Log of zero or less.'); return Math.log(x); },
  sin: (a) => Math.sin(n(a[0])), cos: (a) => Math.cos(n(a[0])), tan: (a) => Math.tan(n(a[0])), atn: (a) => Math.atan(n(a[0])),
  round: (a) => { const p = 10 ** Math.trunc(n(a[1] ?? 0)); return Math.round(n(a[0]) * p) / p; },
  max: (a) => Math.max(...a.map(n)), min: (a) => Math.min(...a.map(n)),
  // conversion
  cbool: (a) => toBool(a[0]), cdbl: (a) => n(a[0]), csng: (a) => n(a[0]), ccur: (a) => Math.round(n(a[0]) * 10000) / 10000,
  cint: (a) => Math.round(n(a[0])), clng: (a) => Math.round(n(a[0])), cstr: (a, e) => s(a[0], e), cvar: (a) => a[0],
  cdate: (a, e) => toDate(a[0], e), val: (a) => { const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)/.exec(s(a[0])); return m ? Number(m[0]) : 0; },
  str: (a, e) => { const x = a[0]; return typeof x === 'number' ? (x >= 0 ? ' ' : '') + String(x) : s(x, e); },
  format: (a, e) => format(a[0], a[1] == null ? '' : s(a[1]), e),
  // text
  len: (a, e) => s(a[0], e).length, lcase: (a, e) => s(a[0], e).toLowerCase(), ucase: (a, e) => s(a[0], e).toUpperCase(),
  trim: (a, e) => s(a[0], e).trim(), ltrim: (a, e) => s(a[0], e).replace(/^\s+/, ''), rtrim: (a, e) => s(a[0], e).replace(/\s+$/, ''),
  left: (a, e) => s(a[0], e).slice(0, Math.max(0, n(a[1]))), right: (a, e) => { const t = s(a[0], e), k = Math.max(0, n(a[1])); return k ? t.slice(-k) : ''; },
  mid: (a, e) => { const t = s(a[0], e), st = Math.max(1, n(a[1])) - 1; return a[2] == null ? t.slice(st) : t.substr(st, Math.max(0, n(a[2]))); },
  instr: (a, e) => {
    const [st, hay, nd] = a.length >= 3 ? [n(a[0]), s(a[1], e), s(a[2], e)] : [1, s(a[0], e), s(a[1], e)];
    return hay.toLowerCase().indexOf(nd.toLowerCase(), st - 1) + 1;
  },
  replace: (a, e) => s(a[0], e).split(s(a[1], e)).join(s(a[2], e)), space: (a) => ' '.repeat(Math.max(0, n(a[0]))),
  string: (a, e) => s(a[1], e).charAt(0).repeat(Math.max(0, n(a[0]))), asc: (a, e) => s(a[0], e).charCodeAt(0) || 0, chr: (a) => String.fromCharCode(n(a[0])),
  strcomp: (a, e) => { const x = s(a[0], e), y = s(a[1], e); return x < y ? -1 : x > y ? 1 : 0; },
  // dates
  now: (_, e) => new DateV(e.now ? e.now() : Math.round(Date.now() / 60000)),
  date: (_, e) => { const t = e.now ? e.now() : Math.round(Date.now() / 60000); return new DateV(Math.floor(t / 1440) * 1440); },
  year: (a, e) => parts(date(a[0], e)).y, month: (a, e) => parts(date(a[0], e)).m, day: (a, e) => parts(date(a[0], e)).d,
  hour: (a, e) => parts(date(a[0], e)).h, minute: (a, e) => parts(date(a[0], e)).mi, second: () => 0,
  weekday: (a, e) => { const first = a[1] == null ? 1 : n(a[1]); return ((parts(date(a[0], e)).wd + 1 - first + 7) % 7) + 1; },
  monthname: (a) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][n(a[0]) - 1] ?? '',
  weekdayname: (a) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n(a[0]) - 1] ?? '',
  dateserial: (a) => mk(n(a[0]), n(a[1]), n(a[2])),
  timeserial: (a) => new DateV(n(a[0]) * 60 + n(a[1])),
  datevalue: (a, e) => toDate(a[0], e),
  dateadd: (a, e) => { need(a, 3, 3, 'DateAdd'); return dateAdd(s(a[0]), n(a[1]), date(a[2], e)); },
  datediff: (a, e) => { need(a, 3, 5, 'DateDiff'); return dateDiff(s(a[0]), date(a[1], e), date(a[2], e)); },
  datepart: (a, e) => {
    const p = parts(date(a[1], e)), i = s(a[0]).toLowerCase();
    return ({ yyyy: p.y, q: Math.floor((p.m - 1) / 3) + 1, m: p.m, d: p.d, w: p.wd + 1, h: p.h, n: p.mi } as Record<string, number>)[i] ?? 0;
  },
  // Working-time functions (durations in minutes on the project calendar)
  projdateadd: (a, e) => { const d = date(a[0], e); return new DateV(e.dateAdd ? e.dateAdd(d.t, n(a[1]), a[2] == null ? undefined : s(a[2])) : d.t + n(a[1])); },
  projdatesub: (a, e) => { const d = date(a[0], e); return new DateV(e.dateAdd ? e.dateAdd(d.t, -n(a[1]), a[2] == null ? undefined : s(a[2])) : d.t - n(a[1])); },
  projdatediff: (a, e) => { const x = date(a[0], e), y = date(a[1], e); return e.workBetween ? e.workBetween(x.t, y.t, a[2] == null ? undefined : s(a[2])) : y.t - x.t; },
  projdateconv: (a, e) => s(toDate(a[0], e), e),
  projdatevalue: (a, e) => toDate(a[0], e),
  projdurconv: (a, e) => (e.formatDuration ? e.formatDuration(n(a[0]), a[1] == null ? undefined : n(a[1])) : String(n(a[0]))),
  projdurvalue: (a, e) => { const t = s(a[0], e); const v = e.parseDuration ? e.parseDuration(t) : Number(t); if (v == null || !isFinite(v)) throw new FormulaError('“' + t + '” is not a duration.'); return v; }
};

export const FUNCTION_GROUPS: Record<string, string[]> = {
  General: ['IIf', 'Switch', 'Choose', 'IsNull', 'IsNumeric', 'IsDate'],
  Math: ['Abs', 'Int', 'Fix', 'Round', 'Sgn', 'Sqr', 'Exp', 'Log', 'Max', 'Min'],
  Text: ['Len', 'Left', 'Right', 'Mid', 'InStr', 'Replace', 'LCase', 'UCase', 'Trim', 'Format', 'Str', 'Val', 'StrComp'],
  Conversion: ['CBool', 'CDate', 'CDbl', 'CInt', 'CLng', 'CStr', 'CCur'],
  'Date/Time': ['Now', 'Date', 'Year', 'Month', 'Day', 'Weekday', 'MonthName', 'DateAdd', 'DateDiff', 'DatePart', 'DateSerial', 'DateValue'],
  Project: ['ProjDateAdd', 'ProjDateSub', 'ProjDateDiff', 'ProjDateConv', 'ProjDateValue', 'ProjDurConv', 'ProjDurValue']
};

/* ---------- evaluation ---------- */

export function evaluate(node: Node, env: FormulaEnv): Val {
  switch (node.t) {
    case 'lit': return node.v;
    case 'field': return env.field(node.name);
    case 'call': {
      const fn = FUNCS[node.name];
      // IIf and Switch evaluate every argument in VBA; evaluating only the chosen branch avoids needless errors.
      if (node.name === 'iif') { need(node.args, 3, 3, 'IIf'); return evaluate(toBool(evaluate(node.args[0], env)) ? node.args[1] : node.args[2], env); }
      return fn(node.args.map(a => evaluate(a, env)), env);
    }
    case 'un': {
      const a = evaluate(node.a, env);
      if (node.op === 'not') return typeof a === 'boolean' ? !a : ~n(a);
      if (isDate(a)) throw new FormulaError('A date cannot be negative.');
      return -n(a);
    }
    case 'bin': {
      const op = node.op;
      if (op === 'and' || op === 'or') {
        const a = toBool(evaluate(node.a, env));
        if (op === 'and' && !a) return false;
        if (op === 'or' && a) return true;
        return toBool(evaluate(node.b, env));
      }
      const a = evaluate(node.a, env), b = evaluate(node.b, env);
      switch (op) {
        case 'xor': return toBool(a) !== toBool(b);
        case 'eqv': return toBool(a) === toBool(b);
        case 'imp': return !toBool(a) || toBool(b);
        case '&': return s(a, env) + s(b, env);
        case '=': return compare(a, b, env) === 0;
        case '<>': return compare(a, b, env) !== 0;
        case '<': return compare(a, b, env) < 0;
        case '>': return compare(a, b, env) > 0;
        case '<=': return compare(a, b, env) <= 0;
        case '>=': return compare(a, b, env) >= 0;
        case 'like': return like(s(a, env), s(b, env));
        case '+':
          if (typeof a === 'string' && typeof b === 'string') return a + b;
          if (isDate(a) && !isDate(b)) return new DateV(Math.round(a.t + n(b) * MIN_PER_DAY));
          if (isDate(b) && !isDate(a)) return new DateV(Math.round(b.t + n(a) * MIN_PER_DAY));
          return n(a) + n(b);
        case '-':
          if (isDate(a) && isDate(b)) return (a.t - b.t) / MIN_PER_DAY;
          if (isDate(a)) return new DateV(Math.round(a.t - n(b) * MIN_PER_DAY));
          if ((a == null && isDate(b)) || (b == null && isDate(a))) return null;
          return n(a) - n(b);
        case '*': return n(a) * n(b);
        case '/': { const d = n(b); if (d === 0) throw new FormulaError('Division by zero.'); return n(a) / d; }
        case '\\': { const d = Math.round(n(b)); if (d === 0) throw new FormulaError('Division by zero.'); return Math.trunc(Math.round(n(a)) / d); }
        case 'mod': { const d = Math.round(n(b)); if (d === 0) throw new FormulaError('Division by zero.'); return Math.round(n(a)) % d; }
        case '^': return n(a) ** n(b);
      }
    }
  }
  throw new FormulaError('Cannot evaluate the formula.');
}

const cache = new Map<string, Node | FormulaError>();
export function compile(src: string): Node {
  let c = cache.get(src);
  if (!c) {
    try { c = parseFormula(src); } catch (e) { c = e instanceof FormulaError ? e : new FormulaError(String(e)); }
    if (cache.size > 500) cache.clear();
    cache.set(src, c);
  }
  if (c instanceof FormulaError) throw c;
  return c;
}

// Field names a formula refers to (for checking and for the editor).
export function referencedFields(src: string): string[] {
  try { return tokenize(src).filter(t => t.k === 'field').map(t => String(t.v)); } catch { return []; }
}

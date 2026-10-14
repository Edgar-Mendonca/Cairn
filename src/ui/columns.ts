// Table columns: a field from the catalog plus the column's own settings (title, width, alignment, wrapping).
import { formatDuration, formatNumber } from '../engine/duration';
import type { ColSpec, Project } from '../engine/model';
import { formatPredecessors, formatResourceNames, formatSuccessors, type Field } from '../engine/ops';
import type { Row, Schedule } from '../engine/schedule';
import { FIELD, fieldName, indicatorFor, type FieldDef, type FRaw, type FType } from '../engine/fields';
import { fmtDate } from '../engine/time';

export interface Ctx { p: Project; s: Schedule; outlineNumber: boolean }

export interface Column {
  key: string;             // field key
  spec: ColSpec;
  label: string;           // header title
  width: number;
  align: 'left' | 'center' | 'right';
  titleAlign: 'left' | 'center' | 'right';
  wrapHeader: boolean;
  wrap: boolean;
  field?: FieldDef;
  edit?: Field;
  editor?: FieldDef['editor'];
  type: FType;
  raw: (r: Row, c: Ctx) => FRaw;
  text: (r: Row, c: Ctx) => string;
  indicator?: (r: Row, c: Ctx) => string | null;   // graphical indicator icon for custom fields
}

export const money = (c: { p: Project }, v: number) => {
  const cur = c.p.settings.currency;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + (cur.length <= 1 ? cur + s : s + ' ' + cur);
};

export function formatRaw(v: FRaw, type: FType, c: { p: Project }): string {
  if (v === '#ERROR') return '#ERROR';
  const set = c.p.settings;
  switch (type) {
    case 'text': return v == null ? '' : String(v);
    case 'int': return v == null ? '' : String(v);
    case 'number': return formatNumber(Number(v) || 0);
    case 'percent': return Math.round(Number(v) || 0) + '%';
    case 'duration': return formatDuration({ minutes: Number(v) || 0, unit: set.durationUnit, elapsed: false, estimated: false }, set);
    case 'work': return formatDuration({ minutes: Number(v) || 0, unit: set.workUnit, elapsed: false, estimated: false }, set);
    case 'date': return v == null || typeof v !== 'number' ? '' : fmtDate(v, { time: set.showTime, format: set.dateFormat });
    case 'cost': return money(c, Number(v) || 0);
    case 'flag': return v ? 'Yes' : 'No';
  }
}

const RIGHT: FType[] = ['number', 'int', 'percent', 'cost', 'work'];

export function makeColumn(spec: ColSpec, p: Project): Column | null {
  if (spec.field === 'indicators') {
    return { key: 'indicators', spec, label: spec.title ?? '', width: spec.width ?? 44, align: 'center', titleAlign: 'center', wrapHeader: true, wrap: false, type: 'text', raw: () => '', text: () => '' };
  }
  const f = FIELD.get(spec.field);
  if (!f) return null;
  const def = f.custom ? p.fields[f.key] : undefined;
  let text = (r: Row, c: Ctx) => formatRaw(f.get(r, c), f.type, c);
  // Fields shown in their own way.
  switch (f.key) {
    case 'name': text = (r, c) => (c.outlineNumber && r.id > 0 ? r.outline + ' ' : '') + r.task.name; break;
    case 'duration': text = (r, c) => (r.summary ? formatRaw(r.duration, 'duration', c) : formatDuration({ minutes: r.duration, unit: r.task.durUnit, elapsed: r.task.elapsed, estimated: r.task.estimated }, c.p.settings)); break;
    case 'preds': text = (r, c) => formatPredecessors(c.p, c.s, r.task); break;
    case 'succs': text = (r, c) => formatSuccessors(c.p, c.s, r.task); break;
    case 'resources': text = (r, c) => formatResourceNames(c.p, r.task); break;
    case 'id': text = r => String(r.id); break;
  }
  const align = spec.align ?? (f.key === 'mode' ? 'center' : RIGHT.includes(f.type) ? 'right' : f.type === 'flag' ? 'center' : 'left');
  return {
    key: f.key, spec, field: f, label: spec.title || fieldName(f.key, p), width: spec.width ?? f.width,
    align, titleAlign: spec.titleAlign ?? (align === 'right' ? 'right' : 'left'), wrapHeader: spec.wrapHeader !== false, wrap: !!spec.wrap,
    edit: f.edit, editor: def && def.values.length && f.custom === 'Text' ? 'list' : f.editor, type: f.type,
    raw: (r, c) => f.get(r, c), text,
    indicator: def && def.display === 'indicators' && def.indicators.length ? (r, c) => indicatorFor(def, f.get(r, c), r.summary, f.type) : undefined
  };
}

// The text shown when editing a cell: the stored value without formatting noise.
export function editText(col: Column, r: Row, c: Ctx): string {
  if (col.key === 'name') return r.task.name;
  if (col.key === 'notes') return r.task.notes;
  if (col.field?.custom === 'Text') return String(r.task.custom[col.key] ?? '');
  if (col.type === 'date') {
    const v = col.raw(r, c);
    return typeof v === 'number' ? fmtDate(v, { time: true, format: c.p.settings.dateFormat }) : '';
  }
  return col.text(r, c);
}

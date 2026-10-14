// Field Settings, Custom Fields (rename, value lists, formulas, summary rows, graphical indicators),
// Text Styles and the table column editor.
import { useMemo, useState } from 'react';
import { blankFieldDef, CF_COUNT, CF_TYPES, cfType, type CFType, type ColSpec, type CustomFieldDef, type Fmt, type IndicatorRule, type IndTest, type SummaryCalc } from '../engine/model';
import { FIELD, FIELDS, evalFormula, fieldName } from '../engine/fields';
import { FUNCTION_GROUPS, FormulaError, parseFormula, referencedFields } from '../engine/formula';
import { schedule } from '../engine/schedule';
import { F, Modal } from './Modal';
import { S, TABLES, tableColumns, useStore, type TableName } from './store';
import { bestFitWidth, currentColumns, insertColumn, setColumns, STYLE_ITEMS, ctxOf, FONTS, SIZES, fontPx } from './actions';
import { formatRaw } from './columns';
import IndicatorIcon, { INDICATOR_GROUPS } from './IndicatorIcon';
import Palette from './Palette';
import Icon from './Icon';

const ALIGNS = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as const;

/* ---------- Field Settings (double-click a column header) ---------- */

export function FieldSettings({ field }: { field: string }) {
  const st = useStore();
  const cols = currentColumns(st);
  const spec = cols.find(c => c.field === field) || { field };
  const [f, setF] = useState({ field: spec.field, title: spec.title || '', titleAlign: spec.titleAlign || '', align: spec.align || '', width: String(spec.width ?? FIELD.get(field)?.width ?? 44), wrapHeader: spec.wrapHeader !== false, wrap: !!spec.wrap });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const fields = useMemo(() => [{ key: 'indicators', label: 'Indicators' }, ...FIELDS.map(x => ({ key: x.key, label: fieldName(x.key, st.p, true) }))].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [st.p]);
  const ok = () => {
    const w = Math.round(Number(f.width));
    if (!(w >= 16 && w <= 2000)) { S().notify('Enter a width from 16 to 2000.', true); return false; }
    if (f.field !== field && cols.some(c => c.field === f.field)) { S().notify(fieldName(f.field, st.p) + ' is already in this table.', true); return false; }
    const next: ColSpec = { field: f.field, width: w };
    if (f.title.trim()) next.title = f.title.trim();
    if (f.titleAlign) next.titleAlign = f.titleAlign as ColSpec['titleAlign'];
    if (f.align) next.align = f.align as ColSpec['align'];
    if (!f.wrapHeader) next.wrapHeader = false;
    if (f.wrap) next.wrap = true;
    setColumns(cols.map(c => (c.field === field ? next : c)));
  };
  return (
    <Modal title="Column settings" onOk={ok} extra={<button type="button" className="btn" onClick={() => set({ width: String(bestFitWidth(f.field)) })}>Best Fit</button>}>
      <F label="Field name"><select className="inp" value={f.field} onChange={e => set({ field: e.target.value })}>{fields.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></F>
      <F label="Title (blank shows the field name)"><input className="inp" value={f.title} placeholder={fieldName(f.field, st.p)} onChange={e => set({ title: e.target.value })} /></F>
      <div className="grid2">
        <F label="Align title"><select className="inp" value={f.titleAlign} onChange={e => set({ titleAlign: e.target.value })}><option value="">Default</option>{ALIGNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Align data"><select className="inp" value={f.align} onChange={e => set({ align: e.target.value })}><option value="">Default</option>{ALIGNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Width"><input className="inp" type="number" min={16} max={2000} value={f.width} onChange={e => set({ width: e.target.value })} /></F>
        <span />
        <label className="chk"><input type="checkbox" checked={f.wrapHeader} onChange={e => set({ wrapHeader: e.target.checked })} />Header text wrapping</label>
        <label className="chk"><input type="checkbox" checked={f.wrap} onChange={e => set({ wrap: e.target.checked })} />Wrap text in cells (rows grow taller)</label>
      </div>
    </Modal>
  );
}

/* ---------- Custom Fields ---------- */

const ROLLUPS: Record<CFType, [SummaryCalc, string][]> = {
  Text: [], Flag: [['and', 'And'], ['or', 'Or']],
  Number: [['sum', 'Sum'], ['max', 'Maximum'], ['min', 'Minimum'], ['avg', 'Average'], ['count', 'Count All'], ['countNon', 'Count Nonsummary']],
  Cost: [['sum', 'Sum'], ['max', 'Maximum'], ['min', 'Minimum'], ['avg', 'Average']],
  Duration: [['sum', 'Sum'], ['max', 'Maximum'], ['min', 'Minimum'], ['avg', 'Average']],
  Date: [['max', 'Maximum'], ['min', 'Minimum']], Start: [['max', 'Maximum'], ['min', 'Minimum']], Finish: [['max', 'Maximum'], ['min', 'Minimum']]
};
const TESTS: [IndTest, string][] = [
  ['eq', 'equals'], ['ne', 'does not equal'], ['gt', 'is greater than'], ['ge', 'is greater than or equal to'], ['lt', 'is less than'], ['le', 'is less than or equal to'],
  ['between', 'is within'], ['notBetween', 'is not within'], ['contains', 'contains'], ['notContains', 'does not contain'], ['any', 'any value']
];
const FIELD_GROUPS = [...new Set(FIELDS.map(f => f.group))];

function RulesEditor({ rules, onChange }: { rules: IndicatorRule[]; onChange: (r: IndicatorRule[]) => void }) {
  const upd = (k: number, patch: Partial<IndicatorRule>) => onChange(rules.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const move = (k: number, d: number) => { const n = rules.slice(); const [x] = n.splice(k, 1); n.splice(Math.max(0, Math.min(n.length, k + d)), 0, x); onChange(n); };
  return (
    <div>
      <table className="mini rules"><thead><tr><th>Test for the field</th><th>Value(s)</th><th>Image</th><th /></tr></thead><tbody>
        {rules.map((r, k) => (
          <tr key={k}>
            <td><select className="inp" value={r.test} onChange={e => upd(k, { test: e.target.value as IndTest })}>{TESTS.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></td>
            <td>{r.test !== 'any' && <span className="row-btns"><input className="inp sm" value={r.value} onChange={e => upd(k, { value: e.target.value })} />{(r.test === 'between' || r.test === 'notBetween') && <>and<input className="inp sm" value={r.value2} onChange={e => upd(k, { value2: e.target.value })} /></>}</span>}</td>
            <td><span className="row-btns"><IndicatorIcon name={r.icon} size={16} /><select className="inp sm" value={r.icon} onChange={e => upd(k, { icon: e.target.value })}>
              {INDICATOR_GROUPS.map(([g, list]) => <optgroup key={g} label={g}>{list.map(n => <option key={n} value={n}>{n.replace(/-/g, ' ')}</option>)}</optgroup>)}
            </select></span></td>
            <td className="nowrap"><button type="button" className="icon-btn" onClick={() => move(k, -1)} aria-label="Move up">↑</button><button type="button" className="icon-btn" onClick={() => move(k, 1)} aria-label="Move down">↓</button><button type="button" className="icon-btn" onClick={() => onChange(rules.filter((_, i) => i !== k))} aria-label="Remove"><Icon name="x" /></button></td>
          </tr>
        ))}
      </tbody></table>
      <button type="button" className="btn" onClick={() => onChange(rules.concat({ test: 'eq', value: '', value2: '', icon: 'circle-green' }))}><Icon name="plus" />Add rule</button>
      <p className="hint">Rules are tested from the top; the first that matches picks the image. Dates and durations can be typed as usual (12 Jan 26, 5d).</p>
    </div>
  );
}

export function CustomFields({ field }: { field?: string }) {
  const st = useStore();
  const [defs, setDefs] = useState<Record<string, CustomFieldDef>>(() => JSON.parse(JSON.stringify(st.p.fields)));
  const [type, setType] = useState<CFType>(() => (field && cfType(field)) || 'Text');
  const [key, setKey] = useState(() => (field && cfType(field) ? field : 'Text1'));
  const [renaming, setRenaming] = useState(false);
  const def = defs[key] || blankFieldDef();
  const attr: 'none' | 'list' | 'formula' = def.formula ? 'formula' : def.values.length || def.restrict ? 'list' : 'none';
  const [mode, setMode] = useState<'none' | 'list' | 'formula'>(attr);
  const set = (patch: Partial<CustomFieldDef>) => setDefs({ ...defs, [key]: { ...def, ...patch } });
  const keys = Array.from({ length: CF_COUNT[type] }, (_, i) => type + (i + 1));
  const choose = (k: string) => { setKey(k); setRenaming(false); const d = defs[k]; setMode(d?.formula ? 'formula' : d && (d.values.length || d.restrict) ? 'list' : 'none'); };
  const fieldType = FIELD.get(key)!.type;

  // Formula check and preview on the selected (or first) task.
  const [formulaText, setFormulaText] = useState(def.formula);
  const preview = useMemo(() => {
    if (mode !== 'formula' || !formulaText.trim()) return null;
    try { parseFormula(formulaText); } catch (e) { return { error: (e as Error).message }; }
    const bad = referencedFields(formulaText).filter(n => !FIELDS.some(f => f.name.toLowerCase() === n.toLowerCase() || f.key.toLowerCase() === n.toLowerCase() || defs[f.key]?.alias.toLowerCase() === n.toLowerCase()));
    if (bad.length) return { error: 'Unknown field' + (bad.length > 1 ? 's' : '') + ': ' + bad.map(b => '[' + b + ']').join(', ') };
    const p = { ...st.p, fields: { ...defs, [key]: { ...def, formula: formulaText } } };
    const s = schedule(p);
    const row = s.rows.find(r => r.task.uid === st.sel[0] && !r.summary) || s.rows.find(r => !r.summary);
    if (!row) return { ok: 'The formula is valid.' };
    const v = evalFormula(formulaText, row, { p, s }, key);
    if (v instanceof FormulaError) return { error: 'For task ' + row.id + ' “' + row.task.name + '”: ' + v.message };
    return { ok: 'Task ' + row.id + ' “' + row.task.name + '” gives ' + formatRaw(v, fieldType, { p }) };
  }, [formulaText, mode, defs, key, def, st.p, st.sel, fieldType]);

  const insertAtEnd = (text: string) => { setFormulaText(formulaText + (formulaText && !/[\s(]$/.test(formulaText) ? ' ' : '') + text); };
  const ok = () => {
    const out: Record<string, CustomFieldDef> = {};
    const cur = { ...defs, [key]: { ...def, formula: mode === 'formula' ? formulaText.trim() : '', values: mode === 'list' ? def.values.filter(v => v.value.trim()) : [], restrict: mode === 'list' && def.restrict } };
    if (mode === 'formula' && preview && 'error' in preview && preview.error && /Expected|Unknown|missing|ends too early|Unexpected/.test(preview.error)) { S().notify('Fix the formula first: ' + preview.error, true); return false; }
    Object.entries(cur).forEach(([k, d]) => {
      const blank = !d.alias && !d.formula && !d.values.length && d.summary === 'none' && d.display === 'data' && !d.indicators.length;
      if (!blank) out[k] = d;
    });
    st.commit({ ...st.p, fields: out });
  };
  const addColumn = () => { if (ok() === false) return; S().close(); if (!currentColumns().some(c => c.field === key)) insertColumn(key); S().notify((defs[key]?.alias || key) + ' added to the table.'); };
  const rollups = ROLLUPS[type];
  return (
    <Modal title="Custom fields" onOk={ok} xwide extra={<button type="button" className="btn" onClick={addColumn}><Icon name="columns" />Show as column</button>}>
      <div className="cf">
        <div className="cf-left">
          <F label="Type"><select className="inp" value={type} onChange={e => { const t = e.target.value as CFType; setType(t); choose(t + '1'); setFormulaText(defs[t + '1']?.formula || ''); }}>{CF_TYPES.map(t => <option key={t}>{t}</option>)}</select></F>
          <div className="cf-list" role="listbox">
            {keys.map(k => (
              <button type="button" key={k} role="option" aria-selected={k === key} className={'cf-item' + (k === key ? ' on' : '') + (defs[k] ? ' used' : '')} onClick={() => { choose(k); setFormulaText(defs[k]?.formula || ''); }}>
                {defs[k]?.alias ? defs[k].alias + ' (' + k + ')' : k}{defs[k]?.formula ? <span className="cf-tag">fx</span> : null}
              </button>
            ))}
          </div>
          {renaming
            ? <span className="row-btns"><input className="inp" autoFocus defaultValue={def.alias || key} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); set({ alias: (e.target as HTMLInputElement).value.trim() === key ? '' : (e.target as HTMLInputElement).value.trim() }); setRenaming(false); } }} onBlur={e => { set({ alias: e.target.value.trim() === key ? '' : e.target.value.trim() }); setRenaming(false); }} /></span>
            : <div className="row-btns"><button type="button" className="btn" onClick={() => setRenaming(true)}>Rename…</button><button type="button" className="btn" onClick={() => { const d = { ...defs }; delete d[key]; setDefs(d); setMode('none'); setFormulaText(''); }}>Delete</button></div>}
        </div>
        <div className="cf-right">
          <h3>Custom attributes</h3>
          <div className="row-btns">
            {([['none', 'None'], ['list', type === 'Text' ? 'Lookup (value list)' : 'Value list'], ['formula', 'Formula']] as const).map(([k, l]) => (
              <label key={k} className="chk"><input type="radio" checked={mode === k} disabled={k === 'list' && type !== 'Text' && type !== 'Number'} onChange={() => setMode(k)} />{l}</label>
            ))}
          </div>
          {mode === 'list' && <div className="cf-box">
            <table className="mini"><thead><tr><th>Value</th><th>Description</th><th /></tr></thead><tbody>
              {def.values.map((v, i) => <tr key={i}>
                <td><input className="inp" value={v.value} onChange={e => set({ values: def.values.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} /></td>
                <td><input className="inp" value={v.desc} onChange={e => set({ values: def.values.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })} /></td>
                <td><button type="button" className="icon-btn" onClick={() => set({ values: def.values.filter((_, j) => j !== i) })} aria-label="Remove"><Icon name="x" /></button></td>
              </tr>)}
            </tbody></table>
            <div className="row-btns"><button type="button" className="btn" onClick={() => set({ values: def.values.concat({ value: '', desc: '' }) })}><Icon name="plus" />Add value</button>
              <label className="chk"><input type="checkbox" checked={def.restrict} onChange={e => set({ restrict: e.target.checked })} />Restrict field to items in the value list</label></div>
          </div>}
          {mode === 'formula' && <div className="cf-box">
            <div className="row-btns">
              <select className="inp" value="" onChange={e => { if (e.target.value) insertAtEnd('[' + e.target.value + ']'); }}>
                <option value="">Insert field…</option>
                {FIELD_GROUPS.map(g => <optgroup key={g} label={g}>{FIELDS.filter(x => x.group === g && x.key !== key).map(x => <option key={x.key} value={x.custom && defs[x.key]?.alias ? defs[x.key].alias : x.name}>{x.custom && defs[x.key]?.alias ? defs[x.key].alias + ' (' + x.key + ')' : x.name}</option>)}</optgroup>)}
              </select>
              <select className="inp" value="" onChange={e => { if (e.target.value) insertAtEnd(e.target.value + '('); }}>
                <option value="">Insert function…</option>
                {Object.entries(FUNCTION_GROUPS).map(([g, list]) => <optgroup key={g} label={g}>{list.map(fn => <option key={fn} value={fn}>{fn}</option>)}</optgroup>)}
              </select>
            </div>
            <textarea className="inp mono" rows={5} value={formulaText} spellCheck={false} onChange={e => setFormulaText(e.target.value)}
              placeholder={'Example: IIf([% Complete] = 100, "Done", IIf([Finish] > [Baseline Finish], "Late", "On track"))'} />
            {preview && ('error' in preview ? <p className="alert inline">{preview.error}</p> : <p className="ok inline">{preview.ok}</p>)}
            <p className="hint">{key} = … Durations and work are in minutes ([Duration] / 480 gives days). Dates subtract to days. Compare a date with "NA" to test for no date.</p>
          </div>}
          <h3>Calculation for summary rows</h3>
          <div className="row-btns">
            <label className="chk"><input type="radio" checked={def.summary === 'none'} onChange={() => set({ summary: 'none' })} />None</label>
            {rollups.length > 0 && <label className="chk"><input type="radio" checked={def.summary !== 'none' && def.summary !== 'formula'} onChange={() => set({ summary: rollups[0][0] })} />Rollup:
              <select className="inp sm" disabled={def.summary === 'none' || def.summary === 'formula'} value={def.summary === 'none' || def.summary === 'formula' ? rollups[0][0] : def.summary} onChange={e => set({ summary: e.target.value as SummaryCalc })}>{rollups.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            <label className="chk"><input type="radio" checked={def.summary === 'formula'} disabled={mode !== 'formula'} onChange={() => set({ summary: 'formula' })} />Use formula</label>
          </div>
          <h3>Values to display</h3>
          <div className="row-btns">
            <label className="chk"><input type="radio" checked={def.display === 'data'} onChange={() => set({ display: 'data' })} />Data</label>
            <label className="chk"><input type="radio" checked={def.display === 'indicators'} onChange={() => set({ display: 'indicators', indicators: def.indicators.length ? def.indicators : [{ test: 'any', value: '', value2: '', icon: 'circle-green' }] })} />Graphical indicators</label>
          </div>
          {def.display === 'indicators' && <div className="cf-box">
            <RulesEditor rules={def.indicators} onChange={r => set({ indicators: r })} />
            <label className="chk"><input type="checkbox" checked={def.summaryIndicators == null} onChange={e => set({ summaryIndicators: e.target.checked ? null : JSON.parse(JSON.stringify(def.indicators)) })} />Summary rows use the same rules</label>
            {def.summaryIndicators && <><h4>Summary rows</h4><RulesEditor rules={def.summaryIndicators} onChange={r => set({ summaryIndicators: r })} /></>}
            <label className="chk"><input type="checkbox" checked={def.tip} onChange={e => set({ tip: e.target.checked })} />Show data values in tooltips</label>
          </div>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Text Styles ---------- */

export function TextStyles() {
  const st = useStore();
  const [styles, setStyles] = useState<Record<string, Fmt>>(() => JSON.parse(JSON.stringify(st.p.textStyles)));
  const [item, setItem] = useState('all');
  const cur = styles[item] || {};
  const set = (patch: Partial<Fmt>) => { const n: Fmt = { ...cur, ...patch }; (Object.keys(n) as (keyof Fmt)[]).forEach(k => { if (!n[k]) delete n[k]; }); setStyles({ ...styles, [item]: n }); };
  const preview = { fontWeight: cur.b ? 700 : undefined, fontStyle: cur.i ? 'italic' : undefined, textDecoration: [cur.u ? 'underline' : '', cur.s ? 'line-through' : ''].join(' ').trim() || undefined, color: cur.color, background: cur.bg, fontFamily: cur.font ? '"' + cur.font + '"' : undefined, fontSize: fontPx(cur.size) };
  return (
    <Modal title="Text styles" onOk={() => { const out: Record<string, Fmt> = {}; Object.entries(styles).forEach(([k, v]) => { if (Object.keys(v).length) out[k] = v; }); st.commit({ ...st.p, textStyles: out }); }}>
      <F label="Item to change"><select className="inp" value={item} onChange={e => setItem(e.target.value)}>{STYLE_ITEMS.map(([k, l]) => <option key={k} value={k}>{l}{styles[k] && Object.keys(styles[k]).length ? '  •' : ''}</option>)}</select></F>
      <div className="grid2">
        <F label="Font"><select className="inp" value={cur.font || ''} onChange={e => set({ font: e.target.value || undefined })}><option value="">Segoe UI (default)</option>{FONTS.map(x => <option key={x} value={x} style={{ fontFamily: x }}>{x}</option>)}</select></F>
        <F label="Size"><select className="inp" value={String(cur.size || 9)} onChange={e => set({ size: +e.target.value === 9 ? undefined : +e.target.value })}>{SIZES.map(x => <option key={x} value={x}>{x}</option>)}</select></F>
      </div>
      <div className="row-btns">
        <label className="chk"><input type="checkbox" checked={!!cur.b} onChange={e => set({ b: e.target.checked })} /><b>Bold</b></label>
        <label className="chk"><input type="checkbox" checked={!!cur.i} onChange={e => set({ i: e.target.checked })} /><i>Italic</i></label>
        <label className="chk"><input type="checkbox" checked={!!cur.u} onChange={e => set({ u: e.target.checked })} /><u>Underline</u></label>
        <label className="chk"><input type="checkbox" checked={!!cur.s} onChange={e => set({ s: e.target.checked })} /><s>Strikethrough</s></label>
      </div>
      <div className="grid2">
        <div><h4>Colour</h4><Palette value={cur.color} onPick={c => set({ color: c })} /></div>
        <div><h4>Background</h4><Palette value={cur.bg} onPick={c => set({ bg: c })} auto="No colour" /></div>
      </div>
      <div className="ts-preview" style={preview}>Sample task name · 5 days · Mon 19 Oct 26</div>
      <p className="hint">Formatting set on individual rows or cells (Task › Font) shows on top of these styles. Gantt Bar Text and Timescale Tiers style the chart; Row and Column Titles style the table headings.</p>
    </Modal>
  );
}

/* ---------- Table columns (Format › Columns › Table) ---------- */

export function TableColumns() {
  const st = useStore();
  const [table, setTable] = useState<TableName>(st.ui.table);
  const [cols, setCols] = useState<ColSpec[]>(() => tableColumns(st.p, st.ui.table));
  const [q, setQ] = useState('');
  const label = (k: string) => (k === 'indicators' ? 'Indicators' : fieldName(k, st.p, true));
  const move = (i: number, d: number) => { const c = cols.slice(); const [x] = c.splice(i, 1); c.splice(Math.max(0, Math.min(c.length, i + d)), 0, x); setCols(c); };
  const available = [{ key: 'indicators' }, ...FIELDS].map(f => f.key).filter(k => !cols.some(c => c.field === k) && label(k).toLowerCase().includes(q.toLowerCase())).sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }));
  return (
    <Modal title="Columns" wide onOk={() => { if (!cols.length) { S().notify('A table needs at least one column.', true); return false; } setColumns(cols, table); if (table !== st.ui.table) S().setUI({ table }); }}
      extra={<button type="button" className="btn" onClick={() => setCols(TABLES[table].cols.map(field => ({ field })))}>Reset table</button>}>
      <F label="Table"><select className="inp" value={table} onChange={e => { const t = e.target.value as TableName; setTable(t); setCols(tableColumns(st.p, t)); }}>{Object.entries(TABLES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></F>
      <div className="cols2">
        <div><h3>Columns, left to right</h3><ul className="collist">{cols.map((c, i) => <li key={c.field}><span>{c.title ? c.title + ' (' + label(c.field) + ')' : label(c.field)}</span><button type="button" className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up">↑</button><button type="button" className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down">↓</button><button type="button" className="icon-btn" onClick={() => setCols(cols.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" /></button></li>)}</ul></div>
        <div><h3>Add a field</h3><input className="inp" placeholder="Search fields" value={q} onChange={e => setQ(e.target.value)} />
          <ul className="collist add">{available.map(k => <li key={k}><button type="button" className="linkbtn" onClick={() => setCols(cols.concat({ field: k }))}>+ {label(k)}</button></li>)}</ul></div>
      </div>
      <p className="hint">Tables are saved with the plan. Tip: right-click a column heading to insert, hide or set up a column; drag a heading to move it.</p>
    </Modal>
  );
}

export { ctxOf };

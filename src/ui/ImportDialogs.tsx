// Importing a task list (CSV or Excel): choose the header row and say which column is which, with a live preview.
// Also the Export chooser.
import { useMemo, useState } from 'react';
import { S } from './store';
import { Modal } from './Modal';
import Icon from './Icon';
import { fromTable, guessMapping, ROLE_LABELS, type ColumnRole, type Mapping } from '../engine/tabular';
import { exportFile } from './actions';

const ROLES = Object.keys(ROLE_LABELS) as ColumnRole[];

export function ImportTableDialog({ rows, fileName }: { rows: string[][]; fileName: string }) {
  const [hasHeader, setHasHeader] = useState(true);
  const header = hasHeader ? rows[0] : rows[0].map((_, i) => 'Column ' + (i + 1));
  const body = hasHeader ? rows.slice(1) : rows;
  const [map, setMap] = useState<Mapping>(() => guessMapping(rows[0]));
  const width = Math.max(...rows.slice(0, 50).map(r => r.length));
  const cols = Array.from({ length: width }, (_, i) => i);
  const preview = useMemo(() => { try { return { r: fromTable(body, map, { name: fileName, source: fileName }) }; } catch (e: any) { return { err: e.message as string }; } }, [body, map, fileName]);
  const ok = () => {
    if (!('r' in preview) || !preview.r) { S().notify(preview.err || 'Nothing to import.', true); return false; }
    const name = fileName.replace(/\.[^.]+$/, '');
    preview.r.p.name = name;
    S().load(preview.r.p, 'Imported ' + preview.r.report.tasks + ' tasks from ' + fileName);
    if (preview.r.report.notes.length) setTimeout(() => S().open('importReport', { report: preview.r!.report, fileName }), 0);
  };
  return (
    <Modal title={'Import ' + fileName} onOk={ok} okLabel="Import" xwide>
      <p className="hint">Tell Cairn what each column holds. The guesses come from the column names; change any that are wrong. Durations like 5d or 2w, dates in most formats, and links such as <code>3</code> or <code>5SS+2d</code> are understood.</p>
      <label className="chk"><input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />The first row holds column names</label>
      <div className="imp-wrap">
        <table className="mini imp">
          <thead>
            <tr>{cols.map(i => <th key={i}><select className="inp" value={map[i] || 'skip'} onChange={e => { const m = map.slice(); while (m.length < width) m.push('skip'); const role = e.target.value as ColumnRole; if (role !== 'skip') m.forEach((x, k) => { if (x === role) m[k] = 'skip'; }); m[i] = role; setMap(m); }}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></th>)}</tr>
            <tr>{cols.map(i => <th key={i} className="imp-h">{header[i] || ''}</th>)}</tr>
          </thead>
          <tbody>{body.slice(0, 8).map((r, k) => <tr key={k}>{cols.map(i => <td key={i} className={(map[i] || 'skip') === 'skip' ? 'off' : ''}>{r[i] || ''}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {'r' in preview && preview.r
        ? <p className="ok inline"><Icon name="check" /> {preview.r.report.tasks} tasks, {preview.r.report.links} links and {preview.r.report.resources} people will be imported.{preview.r.report.notes.length ? ' ' + preview.r.report.notes.join(' ') : ''}</p>
        : <p className="alert inline">{preview.err}</p>}
    </Modal>
  );
}

const EXPORTS: [string, string, string, () => void][] = [
  ['file', 'Project XML (.xml)', 'Opens in most desktop schedulers. Tasks, links, calendars, people, assignments, baselines.', () => exportFile('xml')],
  ['file', 'Primavera P6 (.xer)', 'Activities with WBS, relationships, resources and assignments.', () => exportFile('xer')],
  ['table', 'Excel (.xlsx)', 'The columns you see, with the outline indented.', () => exportFile('xlsx')],
  ['table', 'CSV (.csv)', 'The columns you see, as plain text.', () => exportFile('csv')],
  ['usage', 'Hours and cost by week (.xlsx)', 'Work, cost and baseline work per task per week.', () => exportFile('timephased')],
  ['calendar', 'Calendar (.ics)', 'Milestones and deadlines for Outlook, Google or Apple Calendar.', () => exportFile('ics')],
  ['pdf', 'PDF', 'Print with page setup, then choose “Save as PDF”.', () => S().setUI({ home: 'print' })],
  ['picture', 'Image (PNG or SVG)', 'The current view, for slides and reports.', () => S().open('copyPicture')]
];

export function ExportDialog() {
  return (
    <Modal title="Export" noOk cancelLabel="Close" wide>
      <div className="exp-list">
        {EXPORTS.map(([ic, t, d, go]) => <button key={t} className="exp-item" onClick={() => { S().close(); go(); }}><Icon name={ic} size={22} /><span><b>{t}</b><small>{d}</small></span></button>)}
      </div>
    </Modal>
  );
}

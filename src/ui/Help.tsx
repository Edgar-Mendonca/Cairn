// Help: a getting-started guide, the keyboard shortcut sheet, importing from other tools, and About Cairn.
import { S, useStore } from './store';
import Icon from './Icon';
import { COMMANDS, keyLabel, run } from './commands';
import { version } from '../../package.json';
import logoUrl from '../assets/cairn-logo.svg';
import logoLightUrl from '../assets/cairn-logo-light.svg';

const PAGES: [string, string, string][] = [['start', 'Getting started', 'book'], ['keys', 'Keyboard shortcuts', 'keyboard'], ['import', 'Importing and exporting', 'upload'], ['about', 'About Cairn', 'cairn']];
const K = ({ k }: { k: string }) => <kbd>{keyLabel(k)}</kbd>;

function Start() {
  return <>
    <h2>Plan your first project in ten minutes</h2>
    <ol className="steps">
      <li><b>Start a plan.</b> Choose <a onClick={() => run('file.new')}>File › New plan</a> and pick a blank plan or one of the five examples. Set the start date and working days in <a onClick={() => run('file.settings')}>File › Plan settings</a>.</li>
      <li><b>Add tasks.</b> Click an empty row in the Task column and type. Press Enter to go to the next row. Type a duration such as <code>5d</code>, <code>2w</code>, <code>4h</code>, or <code>0</code> for a milestone.
        Faster: press <K k="Mod+J" /> and type a whole task in one line, for example <code>Pour slab 5d after 4 @Crew</code>.</li>
      <li><b>Make phases.</b> Select tasks and press <K k="Mod+]" /> to tuck them under the task above, which becomes a phase that totals them. <K k="Mod+[" /> moves them back out. Drag row numbers to reorder.</li>
      <li><b>Link tasks.</b> Select two or more tasks and press <K k="Mod+L" />: each starts when the one before it finishes. Or type row numbers in “Depends on”: <code>3</code> (after 3 finishes), <code>3SS+2d</code> (2 days after 3 starts), <code>3FF</code> (finish together), <code>3SF</code>.
        Dates then move by themselves when anything changes. Pin a task (Task › Pin dates) to keep its dates where you put them.</li>
      <li><b>Assign people.</b> Type names in “Assigned to” (<code>Ana, Crew[200%]</code>), or use <a onClick={() => run('team.assign')}>Plan › Assign people</a>. The Workload and Capacity views show who is over capacity; <a onClick={() => run('team.balance')}>Plan › Balance workload</a> delays tasks to fix it.</li>
      <li><b>See what matters.</b> Turn on <a onClick={() => run('view.critical')}>Critical path</a> to see the tasks that set the finish date. Select a task and open the Details panel (<K k="Alt+Enter" />) to see how far it can slip and why it starts when it does.</li>
      <li><b>Track progress.</b> Save a baseline (Progress › Save baseline) once the plan is agreed. Then record % done, or Progress › Mark as on schedule. The Progress view shows each task against its baseline, and Reports summarise cost, work and late tasks.</li>
      <li><b>Save and share.</b> Your plan is kept in this browser as you work. <K k="Mod+S" /> saves a <code>.cairn</code> file. Export to project XML, Primavera XER, Excel or CSV, print or save a PDF with <K k="Mod+P" />, or copy the chart as an image.</li>
    </ol>
    <h3>Views on the left</h3>
    <p>Gantt (tasks and bars) · Progress (against the baseline) · List (table only) · Calendar · Flow (how tasks connect) · Team (drag work between people) · People · Workload (hours per person per day) · Capacity (chart of load against availability) · Task hours · Reports.</p>
    <h3>Good to know</h3>
    <ul>
      <li>Everything can be undone with <K k="Mod+Z" />.</li>
      <li>Press <K k="Mod+K" /> and start typing to find any command or task.</li>
      <li>Right-click a row or a bar for the most useful actions, including text formatting.</li>
      <li>Your plans never leave your computer unless you save or export them.</li>
    </ul>
  </>;
}

const GRID_KEYS: [string, string][] = [['Enter / Tab', 'Save the cell and move down / right'], ['F2', 'Edit the cell'], ['Esc', 'Cancel editing'], ['Alt+↓', 'Open the date picker in a date cell'],
  ['Arrow keys', 'Move between cells'], ['Shift+click', 'Select a range of rows'], ['Mod+click', 'Add a row to the selection'], ['Mod+wheel', 'Zoom the chart']];

function Keys() {
  const sections = [...new Set(COMMANDS.filter(c => c.keys).map(c => c.section))];
  return <>
    <h2>Keyboard shortcuts</h2>
    <p className="muted">Press <kbd>?</kbd> any time to open this sheet. On a Mac use ⌘ for Ctrl.</p>
    <div className="keys-grid">
      {sections.map(sec => (
        <section key={sec}><h3>{sec}</h3>
          <table className="keys"><tbody>{COMMANDS.filter(c => c.keys && c.section === sec).map(c => <tr key={c.id}><td>{c.label.replace(/…$/, '')}</td><td><kbd>{keyLabel(c.keys)}</kbd></td></tr>)}</tbody></table>
        </section>
      ))}
      <section><h3>In the table</h3><table className="keys"><tbody>{GRID_KEYS.map(([k, a]) => <tr key={k}><td>{a}</td><td><kbd>{keyLabel(k)}</kbd></td></tr>)}</tbody></table></section>
    </div>
  </>;
}

function Formats() {
  return <>
    <h2>Importing and exporting</h2>
    <p>Open any of these with <a onClick={() => run('file.open')}>File › Open</a>, or drag the file onto the window.</p>
    <table className="fmt-table"><thead><tr><th>Format</th><th>Open</th><th>Save</th><th>Notes</th></tr></thead><tbody>
      <tr><td>Cairn plan (.cairn)</td><td>✓</td><td>✓</td><td>Everything, exactly as you left it.</td></tr>
      <tr><td>Project XML (.xml)</td><td>✓</td><td>✓</td><td>The exchange format most desktop schedulers save and open. Tasks, links, calendars, people, assignments, baselines and custom fields.</td></tr>
      <tr><td>Primavera P6 (.xer)</td><td>✓</td><td>✓</td><td>Activities, WBS, relationships, calendars, resources and assignments.</td></tr>
      <tr><td>MPX (.mpx)</td><td>✓</td><td></td><td>An older text exchange format.</td></tr>
      <tr><td>Excel (.xlsx) and CSV</td><td>✓</td><td>✓</td><td>Opening a task list asks which column is which: name, duration, start, finish, depends on, people, outline level.</td></tr>
      <tr><td>Calendar (.ics)</td><td></td><td>✓</td><td>Milestones and deadlines, for Outlook, Google Calendar or Apple Calendar.</td></tr>
      <tr><td>PDF, PNG, SVG</td><td></td><td>✓</td><td>Print or save as PDF with File › Print; images with File › Export › Copy view as image.</td></tr>
    </tbody></table>
    <h3>Have an .mpp file?</h3>
    <p>.mpp is a closed binary format that browsers cannot read. Save it as XML first (Save As › XML Format in the program that made it, or open it in the free ProjectLibre and save as XML), then open the XML file here. Nothing is lost that Cairn supports, and a short report lists anything it had to adjust.</p>
  </>;
}

function About() {
  return <>
    <div className="about-head"><img src={logoUrl} alt="Cairn" height={52} className="logo-light" /><img src={logoLightUrl} alt="Cairn" height={52} className="logo-dark" /></div>
    <p className="lead">A free, open-source project planner that runs in your browser.</p>
    <p>A cairn is a pile of stones that walkers build to mark the trail for the people behind them. Cairn does the same for a project: each milestone is a marker, and the plan shows the way from here to done.</p>
    <dl className="about-dl">
      <dt>Version</dt><dd>{version}</dd>
      <dt>Licence</dt><dd>MIT: free to use, change and share, also commercially.</dd>
      <dt>Your data</dt><dd>Plans are kept in this browser and in files you save. Cairn has no server and sends nothing anywhere.</dd>
      <dt>Works offline</dt><dd>After the first visit, Cairn opens without a connection. Install it from the browser menu to use it like a desktop app.</dd>
      <dt>Built with</dt><dd>TypeScript and React. The scheduling engine (critical path, calendars, resources, balancing) is plain TypeScript with its own tests.</dd>
    </dl>
    <p className="muted small">Cairn is an independent project. Names of other products and file formats are used only to describe file compatibility.</p>
  </>;
}

export default function Help() {
  const page = useStore(s => s.ui.help);
  if (!page) return null;
  const close = () => S().setUI({ help: null });
  return (
    <div className="help-back" onMouseDown={close}>
      <div className="help" role="dialog" aria-label="Help" onMouseDown={e => e.stopPropagation()}>
        <nav className="help-nav">
          {PAGES.map(([k, l, ic]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => S().setUI({ help: k })}><Icon name={ic} />{l}</button>)}
        </nav>
        <div className="help-body">
          <button className="icon-btn help-x" onClick={close} title="Close (Esc)"><Icon name="close" /></button>
          {page === 'start' && <Start />}
          {page === 'keys' && <Keys />}
          {page === 'import' && <Formats />}
          {page === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

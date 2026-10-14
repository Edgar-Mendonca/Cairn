// Project templates for File › New. Each is a small, realistic plan with phases, links, milestones and resources.
import { blankFieldDef, blankProject, newTask, type ColSpec, type CustomFieldDef, type Project, type ResourceType } from './model';
import { addResources, editCell, setBaseline } from './ops';
import { schedule } from './schedule';
import { levelResources } from './level';
import { atDay, dayOf, todayMinutes, weekday, type Minutes } from './time';

// [outline level, name, duration (blank for summaries), predecessors by row number, resources]
type RowDef = [number, string, string?, string?, string?];
type ResDef = [string, ResourceType, number, Partial<{ group: string; maxUnits: number; label: string }>?];

export interface TemplateInfo {
  id: string;
  name: string;
  desc: string;
  color: string;
  resources: ResDef[];
  rows: RowDef[];
  fields?: Record<string, Partial<CustomFieldDef>>;
  values?: [row: number, field: string, value: string][];
  entryColumns?: ColSpec[];
  deadline?: [row: number, workingDaysAfterFinish: number];
}

const ENTRY: ColSpec[] = ['indicators', 'mode', 'name', 'duration', 'start', 'finish', 'preds', 'resources'].map(field => ({ field }));

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'engineering', name: 'Engineering design', color: '#2f6db1',
    desc: 'Product design from requirements to release: concept, detailed design, prototype, testing and release to manufacturing.',
    resources: [
      ['Project Engineer', 'Work', 95, { group: 'Engineering' }], ['Design Engineer', 'Work', 85, { group: 'Engineering', maxUnits: 2 }],
      ['CAD Designer', 'Work', 60, { group: 'Engineering' }], ['Test Technician', 'Work', 55, { group: 'Test' }],
      ['Prototype parts', 'Material', 450, { label: 'set' }], ['Test lab', 'Cost', 0]
    ],
    rows: [
      [1, 'Requirements'], [2, 'Kickoff and project plan', '2d', '', 'Project Engineer'], [2, 'Customer and design requirements', '5d', '2', 'Project Engineer,Design Engineer'],
      [2, 'Requirements signed off', '0d', '3'],
      [1, 'Concept design'], [2, 'Concept options and sketches', '6d', '4', 'Design Engineer[200%]'], [2, 'Concept evaluation and selection', '3d', '6', 'Project Engineer,Design Engineer'],
      [2, 'Concept design review', '0d', '7'],
      [1, 'Detailed design'], [2, '3D CAD model', '12d', '8', 'CAD Designer,Design Engineer[50%]'], [2, 'Calculations and analysis', '8d', '10SS+3d', 'Design Engineer'],
      [2, 'Drawings and bill of materials', '6d', '10', 'CAD Designer'], [2, 'Design FMEA', '3d', '11', 'Project Engineer,Design Engineer'],
      [2, 'Critical design review', '0d', '12,13'],
      [1, 'Prototype'], [2, 'Order prototype parts', '3d', '14', 'Project Engineer,Prototype parts[2 set]'], [2, 'Parts lead time', '15ed', '16'],
      [2, 'Build prototypes', '5d', '17', 'Test Technician,Design Engineer[50%]'],
      [1, 'Testing and validation'], [2, 'Test plan', '3d', '14', 'Test Technician'], [2, 'Functional testing', '6d', '18,20', 'Test Technician,Test lab[$4500]'],
      [2, 'Environmental and durability tests', '10d', '21SS+2d', 'Test Technician,Test lab[$12000]'], [2, 'Design updates from testing', '5d', '21', 'Design Engineer'],
      [2, 'Validation report', '3d', '22,23', 'Project Engineer'],
      [1, 'Release'], [2, 'Final drawing release', '2d', '24', 'CAD Designer'], [2, 'Manufacturing handover', '2d', '26', 'Project Engineer'],
      [2, 'Released to manufacturing', '0d', '27']
    ],
    deadline: [28, 10]
  },
  {
    id: 'epc', name: 'EPC project', color: '#b55a1c',
    desc: 'Engineering, procurement and construction of a process plant unit, through commissioning and handover, with long-lead equipment.',
    resources: [
      ['Project Manager', 'Work', 140, { group: 'Management' }], ['Process Engineer', 'Work', 110, { group: 'Engineering', maxUnits: 2 }],
      ['Mechanical Engineer', 'Work', 105, { group: 'Engineering', maxUnits: 2 }], ['Electrical Engineer', 'Work', 105, { group: 'Engineering', maxUnits: 2 }],
      ['Procurement Lead', 'Work', 90, { group: 'Procurement' }], ['Construction Crew', 'Work', 70, { group: 'Construction', maxUnits: 8 }],
      ['Commissioning Team', 'Work', 115, { group: 'Commissioning', maxUnits: 3 }],
      ['Structural steel', 'Material', 2800, { label: 't' }], ['Main equipment', 'Material', 850000, { label: 'lot' }], ['Heavy lift crane', 'Cost', 0]
    ],
    rows: [
      [1, 'Project setup'], [2, 'Contract award and kickoff', '2d', '', 'Project Manager'], [2, 'Project execution plan', '5d', '2', 'Project Manager'],
      [2, 'Execution plan approved', '0d', '3'],
      [1, 'Engineering'], [2, 'FEED review and design basis', '8d', '4', 'Process Engineer,Mechanical Engineer'],
      [2, 'Process design (PFDs, P&IDs)', '15d', '6', 'Process Engineer'], [2, 'HAZOP study', '4d', '7', 'Process Engineer,Project Manager[25%]'],
      [2, 'Mechanical and piping design', '25d', '7SS+5d', 'Mechanical Engineer'], [2, 'Electrical and instrumentation design', '20d', '7SS+8d', 'Electrical Engineer'],
      [2, 'Issued for construction (IFC)', '0d', '8,9,10'],
      [1, 'Procurement'], [2, 'Long-lead equipment specifications', '8d', '7SS+5d', 'Mechanical Engineer,Procurement Lead[50%]'],
      [2, 'Bid evaluation and award', '12d', '13', 'Procurement Lead,Mechanical Engineer[25%]'], [2, 'Purchase orders placed', '0d', '14'],
      [2, 'Equipment manufacturing', '70ed', '15', 'Main equipment[1 lot]'], [2, 'Factory acceptance test', '4d', '16', 'Mechanical Engineer'],
      [2, 'Shipping to site', '21ed', '17'], [2, 'Bulk materials procurement', '20d', '11', 'Procurement Lead,Structural steel[120 t]'],
      [1, 'Construction'], [2, 'Site mobilisation', '5d', '11', 'Construction Crew[300%]'], [2, 'Civil works and foundations', '25d', '21', 'Construction Crew[600%]'],
      [2, 'Structural steel erection', '15d', '22,19', 'Construction Crew[600%]'], [2, 'Equipment setting', '4d', '18,23', 'Construction Crew[400%],Heavy lift crane[$45000]'],
      [2, 'Piping installation', '25d', '24', 'Construction Crew[800%]'], [2, 'Electrical and instrumentation installation', '20d', '24SS+5d', 'Construction Crew[400%],Electrical Engineer[50%]'],
      [2, 'Mechanical completion', '0d', '25,26'],
      [1, 'Commissioning and handover'], [2, 'Pre-commissioning checks', '8d', '27', 'Commissioning Team[300%]'],
      [2, 'Commissioning and start-up', '6d', '29', 'Commissioning Team[300%],Process Engineer'], [2, 'Performance test run', '3d', '30', 'Commissioning Team,Process Engineer'],
      [2, 'Handover documentation', '8d', '29SS+5d', 'Project Manager'], [2, 'Provisional acceptance', '0d', '31,32']
    ],
    fields: {
      Text1: { alias: 'Discipline' },
      Number1: { alias: 'Float (days)', formula: '[Total Slack] / 480', summary: 'min', display: 'indicators', indicators: [
        { test: 'le', value: '0', value2: '', icon: 'circle-red' }, { test: 'lt', value: '10', value2: '', icon: 'circle-yellow' }, { test: 'any', value: '', value2: '', icon: 'circle-green' }] }
    },
    values: [[6, 'Text1', 'Process'], [7, 'Text1', 'Process'], [8, 'Text1', 'Process'], [9, 'Text1', 'Mechanical'], [10, 'Text1', 'Electrical'],
      [13, 'Text1', 'Mechanical'], [22, 'Text1', 'Civil'], [23, 'Text1', 'Structural'], [25, 'Text1', 'Piping'], [26, 'Text1', 'Electrical']],
    entryColumns: [...ENTRY.slice(0, 3), { field: 'Number1', title: 'Float', width: 54, align: 'center' }, ...ENTRY.slice(3), { field: 'Text1', width: 100 }],
    deadline: [33, 15]
  },
  {
    id: 'research', name: 'Research project', color: '#6b4fb0',
    desc: 'A funded research study: proposal and approvals, literature review, data collection, analysis, writing and publication.',
    resources: [
      ['Principal Investigator', 'Work', 90, { group: 'Research' }], ['Research Assistant', 'Work', 40, { group: 'Research', maxUnits: 2 }],
      ['Statistician', 'Work', 75, { group: 'Analysis' }], ['Survey platform', 'Cost', 0], ['Participant incentives', 'Material', 25, { label: 'voucher' }]
    ],
    rows: [
      [1, 'Proposal and approvals'], [2, 'Define research questions', '5d', '', 'Principal Investigator'], [2, 'Write funding proposal', '10d', '2', 'Principal Investigator,Research Assistant[50%]'],
      [2, 'Funding decision', '30ed', '3'], [2, 'Funding approved', '0d', '4'], [2, 'Ethics application', '5d', '3', 'Principal Investigator'],
      [2, 'Ethics review', '20ed', '6'], [2, 'Ethics approval received', '0d', '7'],
      [1, 'Literature review'], [2, 'Search and screening', '10d', '2', 'Research Assistant'], [2, 'Review and synthesis', '10d', '10', 'Research Assistant,Principal Investigator[25%]'],
      [1, 'Data collection'], [2, 'Design survey and instruments', '6d', '11', 'Principal Investigator,Statistician[25%]'], [2, 'Pilot study', '5d', '13,8', 'Research Assistant,Survey platform[$600]'],
      [2, 'Revise instruments', '3d', '14', 'Principal Investigator'], [2, 'Recruit participants', '10d', '15,5', 'Research Assistant'],
      [2, 'Main data collection', '25d', '16SS+5d', 'Research Assistant[200%],Survey platform[$2400],Participant incentives[300 voucher]'], [2, 'Data collection complete', '0d', '17'],
      [1, 'Analysis'], [2, 'Data cleaning', '5d', '18', 'Research Assistant'], [2, 'Statistical analysis', '10d', '20', 'Statistician'],
      [2, 'Interpret results', '5d', '21', 'Principal Investigator,Statistician[50%]'],
      [1, 'Writing and publication'], [2, 'Draft paper', '15d', '22', 'Principal Investigator,Research Assistant[50%]'], [2, 'Internal review', '5d', '24', 'Statistician[50%]'],
      [2, 'Submit to journal', '0d', '25'], [2, 'Final report to funder', '5d', '25', 'Principal Investigator']
    ],
    deadline: [27, 10]
  },
  {
    id: 'software', name: 'Software development', color: '#1f8a70',
    desc: 'A product release delivered in sprints: discovery, design, three build sprints, testing, launch and support.',
    resources: [
      ['Product Manager', 'Work', 85, { group: 'Product' }], ['UX Designer', 'Work', 70, { group: 'Design' }], ['Tech Lead', 'Work', 95, { group: 'Engineering' }],
      ['Developers', 'Work', 80, { group: 'Engineering', maxUnits: 4 }], ['QA Engineer', 'Work', 60, { group: 'Quality', maxUnits: 2 }], ['Cloud hosting', 'Cost', 0]
    ],
    rows: [
      [1, 'Discovery'], [2, 'Stakeholder interviews', '5d', '', 'Product Manager,UX Designer[50%]'], [2, 'Requirements and backlog', '5d', '2', 'Product Manager'],
      [2, 'Scope agreed', '0d', '3'],
      [1, 'Design'], [2, 'UX flows and wireframes', '8d', '4', 'UX Designer'], [2, 'Architecture and tech design', '6d', '4', 'Tech Lead'],
      [2, 'Design review', '0d', '6,7'],
      [1, 'Build'], [2, 'Sprint 1: core features', '2w', '8', 'Developers[300%],Tech Lead[50%]'], [2, 'Sprint 2: integrations', '2w', '10', 'Developers[300%],Tech Lead[50%]'],
      [2, 'Sprint 3: polish and fixes', '2w', '11', 'Developers[300%],Tech Lead[50%]'], [2, 'Feature complete', '0d', '12'],
      [1, 'Testing'], [2, 'Test plan and automation', '8d', '8', 'QA Engineer'], [2, 'System testing', '8d', '13,15', 'QA Engineer[200%]'],
      [2, 'Performance and security testing', '5d', '16SS+3d', 'QA Engineer,Tech Lead[50%]'], [2, 'User acceptance testing', '5d', '16', 'Product Manager'],
      [1, 'Launch'], [2, 'Release preparation', '3d', '17,18', 'Tech Lead,Cloud hosting[$1500]'], [2, 'Go live', '0d', '20'],
      [2, 'Hypercare support', '2w', '21', 'Developers,QA Engineer[50%]']
    ],
    deadline: [21, 5]
  },
  {
    id: 'construction', name: 'Building construction', color: '#8a6d1f',
    desc: 'A two-storey commercial building from permits to handover: foundations, frame, envelope, services, fit-out and inspections.',
    resources: [
      ['Site Manager', 'Work', 85, { group: 'Management' }], ['General Labour', 'Work', 45, { group: 'Trades', maxUnits: 6 }],
      ['Carpenters', 'Work', 60, { group: 'Trades', maxUnits: 4 }], ['Electricians', 'Work', 70, { group: 'Trades', maxUnits: 2 }],
      ['Plumbers', 'Work', 70, { group: 'Trades', maxUnits: 2 }], ['Concrete', 'Material', 160, { label: 'm³' }], ['Tower crane', 'Cost', 0]
    ],
    rows: [
      [1, 'Pre-construction'], [2, 'Building permit', '20d', '', 'Site Manager[25%]'], [2, 'Contracts and subcontractor award', '10d', '', 'Site Manager'],
      [2, 'Site setup and mobilisation', '5d', '2,3', 'General Labour[200%],Site Manager'],
      [1, 'Substructure'], [2, 'Excavation', '6d', '4', 'General Labour[400%]'], [2, 'Foundations', '10d', '6', 'General Labour[400%],Concrete[180 m³]'],
      [2, 'Ground floor slab', '5d', '7', 'General Labour[400%],Concrete[120 m³]'],
      [1, 'Superstructure'], [2, 'Columns and first floor', '12d', '8', 'Carpenters[300%],General Labour[300%],Concrete[140 m³],Tower crane[$18000]'],
      [2, 'Roof structure', '8d', '10', 'Carpenters[300%]'], [2, 'Structure complete', '0d', '11'],
      [1, 'Envelope'], [2, 'External walls and cladding', '15d', '10SS+5d', 'Carpenters[200%],General Labour[200%]'], [2, 'Windows and doors', '6d', '14FS-3d', 'Carpenters'],
      [2, 'Roofing and waterproofing', '6d', '11', 'General Labour[200%]'], [2, 'Building weathertight', '0d', '15,16'],
      [1, 'Services (MEP)'], [2, 'Electrical rough-in', '10d', '17', 'Electricians[200%]'], [2, 'Plumbing and drainage rough-in', '10d', '17', 'Plumbers[200%]'],
      [2, 'HVAC installation', '12d', '17', 'Plumbers,Electricians[50%]'],
      [1, 'Interior fit-out'], [2, 'Partitions and ceilings', '12d', '19,20', 'Carpenters[300%]'], [2, 'Floor finishes and painting', '10d', '23', 'General Labour[300%]'],
      [2, 'Fixtures and fittings', '6d', '24SS+4d', 'Electricians,Plumbers'],
      [1, 'Completion'], [2, 'Testing and commissioning of services', '5d', '21,25', 'Electricians,Plumbers'], [2, 'Final inspection', '2d', '27', 'Site Manager'],
      [2, 'Snagging and defects', '5d', '28', 'Carpenters,General Labour'], [2, 'Practical completion and handover', '0d', '29']
    ],
    deadline: [30, 10]
  }
];

function nextMonday(t: Minutes): Minutes {
  let d = dayOf(t);
  while (weekday(d) !== 1) d++;
  return atDay(d, 480);
}

export function buildTemplate(id: string, start: Minutes = todayMinutes(), opts: { baseline?: boolean } = {}): Project {
  const tpl = TEMPLATES.find(t => t.id === id);
  if (!tpl) throw new Error('Unknown template ' + id);
  let p = blankProject(tpl.name);
  p.start = nextMonday(start);
  tpl.resources.forEach(([name, type, rate, extra]) => {
    p = addResources(p, 1, { name, type, stdRate: rate, group: extra?.group ?? '', maxUnits: extra?.maxUnits ?? 1, materialLabel: extra?.label ?? '' }).p;
  });
  tpl.rows.forEach(([level, name]) => p.tasks.push(newTask(p, { name, level, estimated: false, mode: 'auto' })));
  const isSummary = (i: number) => i + 1 < tpl.rows.length && tpl.rows[i + 1][0] > tpl.rows[i][0];
  const apply = (field: 'duration' | 'preds' | 'resources', k: 2 | 3 | 4) => {
    tpl.rows.forEach((r, i) => {
      const v = r[k];
      if (!v || (field === 'duration' && isSummary(i))) return;
      const res = editCell(p, schedule(p), p.tasks[i].uid, field, v);
      if (res.error) throw new Error(tpl.name + ' row ' + (i + 1) + ': ' + res.error);
      p = res.p;
    });
  };
  apply('duration', 2);
  apply('preds', 3);
  apply('resources', 4);
  if (tpl.fields) p = { ...p, fields: Object.fromEntries(Object.entries(tpl.fields).map(([k, f]) => [k, { ...blankFieldDef(), ...f }])) };
  (tpl.values || []).forEach(([row, field, value]) => { p = editCell(p, schedule(p), p.tasks[row - 1].uid, ('custom:' + field) as 'custom:Text1', value).p; });
  if (tpl.entryColumns) p = { ...p, tables: { entry: tpl.entryColumns } };
  // Templates start resource-feasible: overlapping work for the same people is levelled, as Plan › Balance workload would.
  p = levelResources(p).p;
  if (tpl.deadline) {
    const [row, days] = tpl.deadline;
    const s = schedule(p);
    const r = s.rows[row - 1];
    p = { ...p, tasks: p.tasks.map((t, i) => (i === row - 1 ? { ...t, deadline: s.calendar.add(r.finish, days * p.settings.minutesPerDay) } : t)) };
  }
  if (opts.baseline !== false) p = setBaseline(p, schedule(p), 0);
  return p;
}

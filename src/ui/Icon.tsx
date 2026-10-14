// Line icons (24×24, stroked). Original drawings for Cairn.
const ICONS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14', menu: 'M4 6h16M4 12h16M4 18h16', diamond: 'M12 3l8 9-8 9-8-9z',
  outdent: 'M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4', indent: 'M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4',
  up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7',
  link: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5',
  unlink: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5M3 3l18 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  file: 'M14 3H6v18h12V7zM14 3v4h4', upload: 'M12 15V3M7 8l5-5 5 5M4 17v3h16v-3', download: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  save: 'M5 3h11l4 4v14H5zM8 3v5h7M8 21v-7h8v7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  printer: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z', table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  gantt: 'M3 3v18h18M7 7h6M10 12h7M8 17h5', network: 'M3 9h5v6H3zM16 3h5v6h-5zM16 15h5v6h-5zM8 12h4M12 6v12M12 6h4M12 18h4',
  tree: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  org: 'M12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 7v4M5 15v-2h14v2M12 11v2',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', wallet: 'M3 7h18v13H3zM3 7l3-4h12l3 4M16 13h2',
  x: 'M18 6L6 18M6 6l12 12', chevR: 'M9 6l6 6-6 6', chevD: 'M6 9l6 6 6-6', pin: 'M12 17v5M9 3h6l-1 7 4 3H6l4-3z',
  flag: 'M4 22V4h13l-2 4 2 4H4', alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  zin: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6', zout: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
  fit: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6', target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  note: 'M4 4h16v12l-4 4H4zM16 20v-4h4', panel: 'M3 4h18v16H3zM15 4v16', check: 'M20 6L9 17l-5-5',
  report: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  filter: 'M3 4h18l-7 8v6l-4 2v-8z', columns: 'M3 4h18v16H3zM9 4v16M15 4v16', layers: 'M12 2l10 6-10 6L2 8zM2 14l10 6 10-6',
  balance: 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z', deadline: 'M6 3h12l-6 8zM12 11v10'
};

const MORE: Record<string, string> = {
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1', paste: 'M8 4h8v3H8zM6 5H4v16h16V5h-2M9 12h6M9 16h6',
  task: 'M4 6h16v4H4zM8 14h12v4H8z', summary: 'M3 5h18M5 5v4M19 5v4M7 12h10v3H7zM9 18h10v3H9z', milestone: 'M12 3l8 9-8 9-8-9z',
  manual: 'M5 7h3M5 7v10h3M19 7h-3M19 7v10h-3M9 12h6', auto: 'M4 9h16v6H4z', inspect: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v3l2 2',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', timeline: 'M3 12h18M7 8v8M12 6v12M17 9v6',
  calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4', baseline: 'M4 8h12v4H4zM4 15h16M4 19h16', status: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 3',
  usage: 'M3 4h18v16H3zM3 9h18M9 4v16M3 14h18', sheet: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16', sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  outline: 'M4 5h16M8 10h12M8 15h12M4 20h16', group: 'M4 4h7v7H4zM13 13h7v7h-7zM4 15h5M15 4v5',
  level: 'M3 18h4V8H3zM10 18h4V4h-4zM17 18h4v-6h-4z', assign: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-2a5 5 0 0 1 5-5h4M17 14v6M14 17h6',
  addres: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-2a5 5 0 0 1 5-5h4M17 12v8M13 16h8', critical: 'M4 8h10v4H4zM10 14h10v4H10z',
  slack: 'M4 8h8v4H4zM12 10h8', late: 'M4 8h10v4H4zM16 6v8M14 12l2 2 2-2', gridlines: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  zoomin: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6', zoomout: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
  entire: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6M7 12h10', selected: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6M9 10h6v4H9z',
  project: 'M4 4h16v16H4zM8 8h8M8 12h5', update: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', move: 'M5 12h14M15 8l4 4-4 4M9 8l-4 4 4 4',
  wbs: 'M9 3h6v4H9zM3 15h6v4H3zM15 15h6v4h-6zM12 7v4M6 15v-4h12v4', custom: 'M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2',
  links: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5',
  inactive: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM5 5l14 14', respect: 'M4 7h7v4H4zM13 13h7v4h-7zM11 9h3v6h-1',
  find: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3', clear: 'M4 20h16M7 16L17 6l-3-3L4 13v3z', fill: 'M12 3v14M6 11l6 6 6-6M4 21h16',
  scroll: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', details: 'M3 4h18v7H3zM3 14h18v6H3z',
  network: 'M3 9h5v6H3zM16 3h5v6h-5zM16 15h5v6h-5zM8 12h4M12 6v12M12 6h4M12 18h4', resources: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  tracking: 'M4 6h12v3H4zM4 11h12v2H4zM8 16h12v3H8z', percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  options: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4', help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  sortup: 'M7 20V4M3 8l4-4 4 4M14 6h7M14 11h5M14 16h3', sortdown: 'M7 4v16M3 16l4 4 4-4M14 6h3M14 11h5M14 16h7',
  wrap: 'M3 6h18M3 12h15a3 3 0 0 1 0 6h-4M16 16l-2 2 2 2M3 18h7', hide: 'M3 4h18v16H3zM9 4v16M15 4v16M4 20L20 4',
  font: 'M5 20l7-16 7 16M8 14h8', bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', italic: 'M10 4h8M6 20h8M14 4l-4 16',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 21h14', strike: 'M5 12h14M16 7a4 3 0 0 0-4-2c-3 0-4.5 1.5-4 3.2M8 17a4 3 0 0 0 4 2c3 0 4.5-1.6 4-3.5',
  fontcolor: 'M6 16l6-13 6 13M8.5 11h7', highlight: 'M9 11l6-6 4 4-6 6zM9 11l-4 4v3h3l5-3', barcolor: 'M3 7h14v6H3zM19 15c0 1.5 1 2 1 3a1 1 0 0 1-2 0c0-1 1-1.5 1-3z',
  formula: 'M10 4h-1a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3M4 11h7M14 9l6 8M20 9l-6 8', template: 'M4 4h16v16H4zM4 9h16M9 9v11',
  textstyles: 'M4 18l5-12 5 12M6 14h6M15 10h6M15 14h6M15 18h6', paint: 'M4 4h13v5H4zM17 6h3v6h-8v3M11 15h2v6h-2z', palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 11h.01M10.5 7h.01M15 7.5h.01',
  cairn: 'M5 20h14a1 1 0 0 0 0-3H5a1 1 0 0 0 0 3zM7 16h9a1 1 0 0 0 0-3H7a1 1 0 0 0 0 3zM9 12h6a1 1 0 0 0 0-3H9a1 1 0 0 0 0 3zM10.5 8h3a1.5 1.5 0 0 0 0-3h-3a1.5 1.5 0 0 0 0 3z'
};

// New in 0.7: views, formatting and tracking commands.
const NEW: Record<string, string> = {
  folder: 'M3 6h6l2 2h10v11H3z', book: 'M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7v16M20 4v14h-7',
  keyboard: 'M3 6h18v12H3zM6 9h1M9 9h1M12 9h1M15 9h1M18 9h1M6 12h1M9 12h1M12 12h1M15 12h1M18 12h1M8 15h8',
  pct0: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', pct25: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v9h9',
  pct50: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18', pct75: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v9H3',
  calendarview: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M7 13h4M13 16h4M7 18h3',
  graph: 'M4 20V4M4 20h16M7 17v-5M11 17V8M15 17v-7M19 17v-3M4 9h16',
  team: 'M3 6h4M3 12h4M3 18h4M9 5h6v3H9zM12 11h8v3h-8zM10 17h5v3h-5z',
  painter: 'M5 3h11v5H5zM16 5h3v6h-8v3M10 14h2v7h-2z', barstyles: 'M3 6h12v4H3zM7 14h14v4H7zM17 8h4',
  layout: 'M3 4h18v16H3zM3 9h18M9 9v11', timescale: 'M3 5h18v6H3zM3 8h18M8 5v3M13 5v3M18 5v3M3 15h18M3 19h18',
  split: 'M3 10h6v4H3zM14 10h7v4h-7zM10 12h3', recur: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  hyperlink: 'M9 15l6-6M11 6l1.5-1.5a4 4 0 0 1 5.7 5.7L16.6 12M7.4 12l-1.6 1.8a4 4 0 0 0 5.7 5.7L13 18',
  goto: 'M4 12h12M12 6l6 6-6 6M20 4v16', replace: 'M4 7h9M10 4l3 3-3 3M20 17h-9M14 14l-3 3 3 3',
  groupby: 'M4 4h16v4H4zM6 8v12M6 12h12M6 16h12M6 20h12', highlightrows: 'M3 6h18M3 12h18M3 18h18M3 10h18v4H3z',
  taskpath: 'M3 5h6v4H3zM15 15h6v4h-6zM9 7h3v10h3', progressline: 'M4 4h12M4 10h8M4 16h14M14 3l-4 7 4 6',
  drawing: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3', picture: 'M4 5h16v14H4zM4 15l5-4 4 3 3-2 4 3M15 9h.01',
  pdf: 'M6 3h9l4 4v14H6zM15 3v4h4M9 13h1.5a1.5 1.5 0 0 0 0-3H9v6M14 10v6h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z',
  updatetasks: 'M4 6h12v4H4zM4 14h6v4H4zM15 16l2 2 4-4', interim: 'M4 7h10v3H4zM4 14h14v3H4zM17 4v6M14 7h6',
  levelopts: 'M3 18h4V8H3zM10 18h4V4h-4zM17 18h4v-6h-4zM16 5h5M18.5 2.5v5', availability: 'M4 5h16v16H4zM4 10h16M8 14h3v4H8z',
  assigninfo: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-2a5 5 0 0 1 5-5h3M15 13h6v8h-6zM17 16h2M17 18h2',
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z', burndown: 'M4 4v16h16M7 7l4 4 3-2 5 7', costs: 'M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8',
  milestones: 'M7 4l4 4-4 4-4-4zM17 12l4 4-4 4-4-4zM11 8h3v8', forms: 'M3 4h18v16H3zM3 12h18M7 8h5M7 16h5M15 15h3',
  window: 'M3 4h18v16H3zM3 8h18', sun2: 'M12 4v2', fontsize: 'M4 18l4-11 4 11M5.5 14h5M14 18l3-7 3 7M15 16h4',
  rowheight: 'M3 6h18M3 18h18M12 8v8M9 10l3-3 3 3M9 14l3 3 3-3', fill: 'M12 3v14M6 11l6 6 6-6M4 21h16',
  options2: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4', orgnizer: 'M4 4h7v16H4zM13 4h7v16h-7zM11 9h2M11 15h2',
  close: 'M18 6L6 18M6 6l12 12', save2: 'M5 3h11l4 4v14H5zM8 3v5h7M8 21v-7h8v7', mark: 'M6 3h12v18l-6-4-6 4z',
  outlinecode: 'M4 5h6M8 10h8M12 15h8M4 20h6M4 5v15', addcol: 'M3 4h12v16H3zM9 4v16M18 9v6M15 12h6',
  zoomsel: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6M9 10h6v4H9z', details2: 'M3 4h18v8H3zM3 15h18v5H3zM6 17h6',
  alignL: 'M4 6h16M4 10h10M4 14h16M4 18h10', alignC: 'M4 6h16M7 10h10M4 14h16M7 18h10', alignR: 'M4 6h16M10 10h10M4 14h16M10 18h10'
};

// Two-tone fills drawn under the outline of the larger ribbon icons.
const FILLS: Record<string, string> = {
  gantt: 'M7 6h7v3H7zM10 11h8v3h-8zM8 16h6v3H8z', task: 'M4 6h16v4H4z', summary: 'M7 12h10v3H7z', milestone: 'M12 3l8 9-8 9-8-9z',
  paste: 'M6 5h12v16H6z', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', manual: 'M5 7h14v10H5z', auto: 'M4 9h16v6H4z',
  calendar: 'M4 5h16v5H4z', calendarview: 'M4 5h16v5H4z', baseline: 'M4 8h12v4H4z', network: 'M3 9h5v6H3zM16 3h5v6h-5zM16 15h5v6h-5z',
  sheet: 'M3 4h18v5H3z', usage: 'M3 4h18v5H3z', graph: 'M7 12h4v5H7zM11 8h4v9h-4zM15 10h4v7h-4z', team: 'M9 5h6v3H9zM12 11h8v3h-8zM10 17h5v3h-5z',
  resources: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', assign: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', addres: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  level: 'M10 18h4V4h-4z', project: 'M4 4h16v16H4z', move: 'M5 10h14v4H5z', report: 'M4 3h16v18H4z', dashboard: 'M13 3h8v5h-8zM3 13h8v8H3z',
  textstyles: 'M15 10h6v8h-6z', columns: 'M9 4h6v16H9z', barstyles: 'M3 6h12v4H3z', timescale: 'M3 5h18v6H3z', layout: 'M3 4h18v5H3z',
  painter: 'M5 3h11v5H5z', entire: 'M7 9h10v6H7z', tracking: 'M4 6h12v3H4z', split: 'M3 10h6v4H3zM14 10h7v4h-7z', recur: 'M8 9h8v6H8z',
  hyperlink: 'M10 10h4v4h-4z', burndown: 'M4 4h16v16H4z', costs: 'M8 7h8v10H8z', update: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  status: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', inspect: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', find: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  groupby: 'M4 4h16v4H4z', filter: 'M3 4h18l-7 8v6l-4 2v-8z', details2: 'M3 15h18v5H3z', forms: 'M3 4h18v8H3z', timeline: 'M3 10h18v4H3z',
  picture: 'M4 5h16v14H4z', printer: 'M6 14h12v7H6z', updatetasks: 'M4 6h12v4H4z', interim: 'M4 14h14v3H4z', availability: 'M4 5h16v5H4z',
  wbs: 'M9 3h6v4H9z', custom: 'M4 10h16v4H4z', save: 'M8 14h8v7H8z', zoomin: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', zoomout: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'
};

export const iconPath = (name: string) => NEW[name] || MORE[name] || ICONS[name] || '';

export default function Icon({ name, size, duo }: { name: string; size?: number; duo?: boolean }) {
  const fill = duo ? FILLS[name] : undefined;
  return (
    <svg className={'i' + (fill ? ' duo' : '')} viewBox="0 0 24 24" aria-hidden="true" width={size} height={size}>
      {fill && <path className="i-fill" d={fill} />}
      <path d={iconPath(name)} />
    </svg>
  );
}

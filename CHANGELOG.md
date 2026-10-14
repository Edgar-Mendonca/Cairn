# Changelog

## 0.8.0: Cairn

The project gets its own name and its own way of working.

**A new identity**
- New name and logo: a stack of trail stones with an amber top stone, the marker that shows the way.
- Light stone and slate colours with fjord blue for things you can act on, and a matching dark theme.
- Plans are saved as `.cairn` files. Older plan files and plans kept in this browser carry over automatically.

**A simpler, faster way to work**
- A menu bar (File, Edit, Insert, Task, Progress, Plan, Format, View, Help) and one slim toolbar, instead of a tabbed ribbon.
- A details panel on the right shows everything about the selected task (dates, progress, links, people, limits, notes) and saves as you type. It also says how far the task can slip and what drives its dates.
- Quick add (Ctrl+J): type “Pour slab 5d after 4 @Crew by 20 Mar” to add a task with its duration, link, person and deadline in one line.
- Search everything with Ctrl+K: commands, views, reports, filters and tasks.
- New tasks are added below the selection. Double-click a task to open its details.
- Drop a file anywhere on the window to open it.
- Plain-language names throughout: phases, pinned tasks, float, workload, capacity, balancing, Team board, Flow diagram.
- Empty dates are blank instead of “NA”.

**Keyboard shortcuts you already know**
- Ctrl+K search, Ctrl+S save, Ctrl+O open, Ctrl+P print, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+F find, Ctrl+H replace, Ctrl+G go to, Ctrl+B / I / U text styles.
- Ctrl+] and Ctrl+[ indent and outdent, Ctrl+L link, Ctrl+Shift+L unlink, Ctrl+Enter new task, Alt+Enter task details, Ctrl+Shift+K web link, Alt+1 to Alt+9 switch views, Alt+C critical path.
- Press ? for the full shortcut sheet.

**Import and export**
- Open Primavera P6 `.xer` files (WBS, activities, relationships, resources, assignments) and save plans as `.xer`.
- Open MPX files.
- Open task lists from Excel (`.xlsx`) or CSV, with a step to match the columns (name, duration, start, finish, depends on, people, outline level, WBS, % done and more).
- Export milestones and deadlines to a calendar file (`.ics`).
- Project XML import and export as before. `.mpp` files show how to convert them.

**Help**
- A getting-started guide, the shortcut sheet, an import and export guide, and About Cairn, all under Help (F1).

**Speed**
- Selecting and editing in a 5,000-task plan is several times faster: the toolbar no longer re-measures itself on every change, and the timescale header is built only when the zoom or range changes.
- One fewer dependency: the app state store is now built in.

## Earlier versions

0.3 to 0.7 were released under a working title. They built the scheduling engine (working-time calendars, task types, critical path, resources, leveling, baselines, earned value), the views and reports, formatting, printing and project XML exchange.

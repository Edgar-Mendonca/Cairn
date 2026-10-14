# Scheduling rules

This is the reference the Cairn engine is built and tested against. Each row states a scheduling rule as project-management practice and project XML files define it, then what Cairn does. "Done" means Cairn does it today, with tests in `src/engine/*.test.ts`. "Planned" items are in the roadmap.

## 1. Time

| Rule | Cairn | Status |
| --- | --- | --- |
| Every date has a time of day. Tasks start at 8:00 AM and finish at 5:00 PM on the Standard calendar. | Times are whole minutes since 1970-01-01 (no time zone). Dates show with or without the time. | Done |
| Durations are stored as working minutes. 1 day = Hours per day (8 h), 1 week = Hours per week (40 h), 1 month = Days per month (20 d). | Same three settings, in Plan settings → Calendar options. | Done |
| Duration units: m, h, d, w, mo. Elapsed units (em, eh, ed, ew, emo) count clock time, 24 h a day, 7 days a week. A "?" marks an estimate. | Same units, abbreviations and spellings ("3 days", "2w", "4ed", "5d?"). | Done |
| A new auto-scheduled task gets "1 day?". | Same. | Done |

## 2. Calendars

| Rule | Cairn | Status |
| --- | --- | --- |
| Base calendars: Standard (Mon–Fri 8:00–12:00, 13:00–17:00), 24 Hours, Night Shift. | Same three. | Done |
| A calendar has a working week (working times per weekday) and exceptions (non-working days, or days with different hours). | Same. Working days and holidays edits the week and exceptions. | Done |
| Derived calendars inherit from a base calendar and override days. Each resource has its own calendar. | Same. | Done |
| Task calendars, with "Scheduling ignores resource calendars". | Task calendar used for scheduling the task. | Done |
| A task is scheduled on its resources' calendars when it has resources. | Planned (Phase 4). | Planned |

## 3. Tasks

| Rule | Cairn | Status |
| --- | --- | --- |
| Task Mode: Manually Scheduled or Auto Scheduled. New tasks follow the "New Tasks" setting in the status bar. | Same, with the same status bar switch. | Done |
| A manually scheduled task keeps the dates the user typed. Links do not move it; Project shows a warning when a link is not met. | Same, with the warning indicator. | Done |
| Task types: Fixed Units (default), Fixed Work, Fixed Duration. Work = Duration × Units. | Same. | Done |
| Editing one of Duration, Work or Units recalculates another according to the task type (table below). | Same rules in `src/engine/ops.ts`. | Done |
| Effort driven: adding or removing a resource keeps total work and changes duration (or units for Fixed Duration). Fixed Work is always effort driven. | Same. | Done |
| Milestones: zero duration, or the Milestone flag. | Same. | Done |
| Summary tasks roll up start, finish, work, cost and % complete from their subtasks. The Project Summary Task (ID 0) can be shown. | Same. | Done |
| Inactive tasks stay in the plan but do not affect the schedule. | Same. | Done |

Task-type table:

| Task type | Change units → | Change duration → | Change work → |
| --- | --- | --- | --- |
| Fixed Units | duration | work | duration |
| Fixed Work | duration | units | duration |
| Fixed Duration | work | work | units |

## 4. Links

| Rule | Cairn | Status |
| --- | --- | --- |
| Finish-to-Start, Start-to-Start, Finish-to-Finish, Start-to-Finish. | Same. | Done |
| Lag in any duration unit, negative lag = lead, or a percentage of the predecessor's duration ("3FS+50%"). | Same. | Done |
| Lag uses the successor's calendar. Elapsed lag uses clock time. | Uses the project (or task) calendar; elapsed lag uses clock time. | Done |
| An FS successor of a task that ends at 5:00 PM starts at the next working time, 8:00 AM. A milestone successor sits at 5:00 PM. | Same. | Done |
| Links to and from summary tasks apply to all their subtasks. | Same. | Done |
| Predecessors column syntax: `3`, `3SS`, `3FS+2d`, `3FF-1w`, `3SS+50%`. | Same. | Done |

## 5. Constraints and deadlines

| Rule | Cairn | Status |
| --- | --- | --- |
| ASAP (default), ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO. | Same eight. | Done |
| Typing a Start into an auto-scheduled task sets Start No Earlier Than; typing a Finish sets Finish No Earlier Than. Dragging a bar sets SNET. | Same. | Done |
| "Tasks will always honor their constraint dates" (on by default): a constraint wins over links, and the conflict shows as negative slack. | Same option, on by default. | Done |
| A deadline does not move the task. It shortens late finish (so total slack) and shows an indicator when missed. | Same. | Done |

## 6. Critical path and slack

| Rule | Cairn | Status |
| --- | --- | --- |
| Forward pass gives Early Start/Finish; backward pass from the project finish gives Late Start/Finish. | Same, in working minutes. | Done |
| Total Slack = Late Finish − Early Finish (working time). Free Slack = time before any successor moves. | Same. | Done |
| A task is critical when Total Slack ≤ "Tasks are critical if slack is less than or equal to" (0 days). | Same setting. | Done |

## 7. Tracking

| Rule | Cairn | Status |
| --- | --- | --- |
| % Complete sets Actual Duration = Duration × %, Remaining Duration = the rest, and sets Actual Start (and Actual Finish at 100%). | Same. | Done |
| Actual Start and Actual Finish fix the task's dates regardless of links. | Same. | Done |
| Status date, Mark on Track, Update Project, progress lines. | Same: Update Project can update work as complete through a date or reschedule uncompleted work after it; progress lines at the status date or the current date. | Done |
| Baseline and Baseline 1–10 save Start, Finish, Duration, Work and Cost. Tracking Gantt shows the baseline under each bar. | Same, 11 baselines. | Done |
| Interim plans, physical % complete, actual and remaining work fields. | Same: Set Interim Plan copies dates into Start1–10/Finish1–10; Physical % Complete with the earned value method; Actual/Remaining Duration and Work are editable. | Done |

## 8. Resources and costs

| Rule | Cairn | Status |
| --- | --- | --- |
| Work, Material and Cost resources. Max Units, Standard Rate, Overtime Rate, Cost/Use, Accrue At, Base Calendar. | Same fields, with accrual at start, prorated or at end for actual cost. Resource availability can change over time. | Done |
| Cost = Work × rate + Cost/Use for work resources; Units × rate for material; amount for cost resources; plus Fixed Cost. | Same. | Done |
| Cost rate tables A–E with effective dates. | Same; each assignment picks its table in Assignment Information. | Done |
| Resource leveling (balance all, balance selection, undo balancing) in standard order: start, priority, slack. Leveling options: ID only/standard/priority order, level within available slack, a date range, clear leveling values first. | Same; delays are stored as Leveling Delay and travel in project XML; pre-leveled dates are kept for the Leveling Gantt. | Done |
| Assignment contours, overtime work. | Same contours (flat, back loaded, front loaded, double peak, early peak, late peak, bell, turtle) spread work in the usage views; overtime work is charged at the overtime rate. | Done |

## 9. Editing conventions

| Rule | Cairn |
| --- | --- |
| The Entry table: ID, Indicators, Task Mode, Task Name, Duration, Start, Finish, Predecessors, Resource Names. | Same columns and order. |
| Type in an empty row to add a task. Insert adds a row above. Delete removes the selected tasks. | Same. |
| Alt+Shift+→ indents, Alt+Shift+← outdents. Ctrl+F2 links the selected tasks, Ctrl+Shift+F2 unlinks. | Same. |
| F2 edits a cell, Enter moves down, Tab moves right, Esc cancels. Ctrl+Z / Ctrl+Y undo and redo. | Same. |
| Double-click a task opens Task details (General, Predecessors, Resources, Advanced, Notes). | Same tabs. |
| Typing a date into Start on an auto-scheduled task sets a Start No Earlier Than constraint; typing Finish sets Finish No Earlier Than. On a task that has started, Start sets the actual start. On a summary task, Start sets Start No Earlier Than and moves its subtasks. | Same. Dates can be typed in many forms (13/10/26, Oct 13 '26, 13 Oct 2026, 2026-10-13), and every date cell and date box has a calendar (Alt+↓). The numeric day/month order follows File › Options. |
| A start date that a link or constraint does not allow is overridden by the schedule: an auto task linked Finish-to-Start cannot start before its predecessor finishes. | Same. Use Task › Respect Links to pull manual tasks back to the dates their links allow. |
| Column headings: right-click for Insert Column, Hide Column, Field Settings, Custom Fields, Wrap Text and sorting; drag a heading to move it; double-click to open Field Settings; "Add New Column" lists every field. | Same, plus AutoFilter on each heading. Tables are saved with the plan. |
| Custom fields Text1–30, Number1–20, Flag1–20, Cost/Date/Duration/Start/Finish1–10, with alias, value lists, formulas, summary-row rollups and graphical indicators. Formulas use VBA-style syntax with field names in brackets: durations are in minutes, dates subtract to days. | Same field set, rules and formula language (IIf, Switch, ProjDateDiff, ProjDurConv, DateAdd, string and maths functions). A formula that cannot be evaluated shows #ERROR. Custom fields round-trip in project XML. |
| Text Styles format a whole kind of task (summary, critical, milestone…); Task › Font formats the selected cells or rows; Format › Bar colour colours individual bars. | Same. |
| Gantt bars: blue for auto tasks, bracketed teal for manual tasks, black brackets for summaries, diamonds for milestones, red for critical tasks when Critical Tasks is on. | Same conventions in Cairn colours. |


// Calendar view: a month (or several weeks) with tasks as bars across the days they run.
import { useMemo, useState, type ReactElement } from 'react';
import { atDay, dayFromYmd, dayOf, DAYS, fmtDate, MONTHS_LONG, todayMinutes, weekday, ymd } from '../../engine/time';
import { S, useStore } from '../store';
import { matchesFilter } from '../actions';
import Icon from '../Icon';

export function CalendarView() {
  const st = useStore();
  const { p, s, ui } = st;
  const [weeks, setWeeks] = useState(6);
  const today = dayOf(todayMinutes());
  const month = ui.calMonth ?? (() => { const [y, m] = ymd(dayOf(s.start)); return dayFromYmd(y, m, 1); })();
  const [y, m] = ymd(month);
  let first = month;
  while (weekday(first) !== p.gantt.timescale.weekStart) first--;
  const days = weeks * 7;
  const tasks = useMemo(() => s.rows.filter(r => !r.summary && r.task.active && (ui.filter === 'all' || matchesFilter(r, ui.filter, st))), [s, ui.filter, ui.filterArgs]);
  const sel = new Set(st.sel);
  const go = (d: number) => S().setUI({ calMonth: d });
  const lanesMax = 4;
  const rowsEls: ReactElement[] = [];
  for (let w = 0; w < weeks; w++) {
    const a = first + w * 7, b = a + 7;
    const inWeek = tasks.filter(r => dayOf(r.start) < b && dayOf(r.finish - (r.duration > 0 ? 1 : 0)) >= a).sort((r1, r2) => r1.start - r2.start || r2.finish - r1.finish);
    const lanes: number[] = [];
    const placed: { r: (typeof tasks)[number]; lane: number; c0: number; c1: number }[] = [];
    const more = new Array(7).fill(0);
    inWeek.forEach(r => {
      const c0 = Math.max(0, dayOf(r.start) - a), c1 = Math.min(6, dayOf(r.finish - (r.duration > 0 ? 1 : 0)) - a);
      let lane = lanes.findIndex(end => end < c0);
      if (lane < 0) { lane = lanes.length; lanes.push(-1); }
      lanes[lane] = c1;
      if (lane >= lanesMax) { for (let c = c0; c <= c1; c++) more[c]++; return; }
      placed.push({ r, lane, c0, c1 });
    });
    rowsEls.push(
      <div key={w} className="cal-week">
        {Array.from({ length: 7 }, (_, k) => {
          const d = a + k, [, mm, dd] = ymd(d);
          return (
            <div key={k} className={'cal-day' + (mm !== m ? ' out' : '') + (s.calendar.isWorkingDay(d) ? '' : ' off') + (d === today ? ' today' : '')} onDoubleClick={() => S().open('goto', { date: d })}>
              <span className="cal-num">{dd === 1 ? MONTHS_LONG[mm - 1].slice(0, 3) + ' ' : ''}{dd}</span>
              {more[k] > 0 && <span className="cal-more">+{more[k]} more</span>}
            </div>
          );
        })}
        {placed.map(({ r, lane, c0, c1 }) => {
          const ms = r.duration === 0;
          const startsHere = dayOf(r.start) >= a, endsHere = dayOf(r.finish - (r.duration > 0 ? 1 : 0)) < b;
          return (
            <div key={r.task.uid} className={'cal-task' + (ms ? ' ms' : '') + (r.critical ? ' crit' : '') + (sel.has(r.task.uid) ? ' sel' : '') + (r.percent >= 100 ? ' done' : '') + (startsHere ? ' s' : '') + (endsHere ? ' e' : '')}
              style={{ left: `calc(${c0 / 7 * 100}% + 3px)`, width: `calc(${(c1 - c0 + 1) / 7 * 100}% - 6px)`, top: 24 + lane * 21 }}
              title={r.task.name + '\n' + fmtDate(r.start, { time: true, format: p.settings.dateFormat }) + ' – ' + fmtDate(r.finish, { time: true, format: p.settings.dateFormat })}
              onMouseDown={() => S().set({ sel: [r.task.uid] })} onDoubleClick={e => { e.stopPropagation(); (S().set({ sel: [r.task.uid] }), S().setUI({ inspector: true })); }}>
              {ms && <Icon name="milestone" />}
              {r.percent > 0 && !ms && <i style={{ width: Math.min(100, r.percent) + '%' }} />}
              <span>{r.task.name}{!ms && r.percent > 0 ? ' · ' + r.percent + '%' : ''}</span>
            </div>
          );
        })}
      </div>
    );
  }
  const nextMonth = (n: number) => { const [yy, mm] = ymd(month); return Math.round(Date.UTC(yy, mm - 1 + n, 1) / 864e5); };
  void days;
  return (
    <div className="calview">
      <div className="cal-bar">
        <button className="icon-btn big" onClick={() => go(nextMonth(-1))} aria-label="Previous month">‹</button>
        <h2>{MONTHS_LONG[m - 1]} {y}</h2>
        <button className="icon-btn big" onClick={() => go(nextMonth(1))} aria-label="Next month">›</button>
        <button className="chip" onClick={() => { const [yy, mm] = ymd(today); go(dayFromYmd(yy, mm, 1)); }}>Today</button>
        <button className="chip" onClick={() => { const [yy, mm] = ymd(dayOf(s.start)); go(dayFromYmd(yy, mm, 1)); }}>Project start</button>
        <span className="sp" />
        {[[1, '1 week'], [2, '2 weeks'], [4, '4 weeks'], [6, 'Month']].map(([n, l]) => <button key={n} className={'chip' + (weeks === n ? ' on' : '')} onClick={() => setWeeks(n as number)}>{l}</button>)}
      </div>
      <div className="cal-dow">{Array.from({ length: 7 }, (_, k) => <span key={k}>{DAYS[(k + p.gantt.timescale.weekStart) % 7]}</span>)}</div>
      <div className="cal-weeks" style={{ gridTemplateRows: `repeat(${weeks}, minmax(${weeks <= 2 ? 200 : 110}px, 1fr))` }}>{rowsEls}</div>
      <div className="cal-foot muted">{tasks.filter(r => r.start < atDay(first + days) && r.finish > atDay(first)).length} tasks in view. Double-click a task for its information.</div>
    </div>
  );
}

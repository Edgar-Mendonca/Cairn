// Calendar drop-down for date cells and date fields.
import { useEffect, useRef, useState } from 'react';
import { atDay, dayOf, DAYS, dayFromYmd, fmtDate, minuteOfDay, MONTHS_LONG, parseDateText, todayMinutes, weekday, ymd, type DateFormat, type Minutes } from '../engine/time';
import Icon from './Icon';

const firstOfMonth = (day: number) => { const [y, m] = ymd(day); return dayFromYmd(y, m, 1); };
const addMonths = (day: number, n: number) => { const [y, m] = ymd(day); return Math.round(Date.UTC(y, m - 1 + n, 1) / 864e5); };

// The popup itself. It keeps focus in the field that opened it (mouse down is cancelled), so typing still works.
export function CalendarPopup({ value, anchor, onPick, onClose, workingDay }: {
  value: number | null; anchor: { left: number; top: number; bottom: number }; onPick: (day: number | null) => void; onClose: () => void; workingDay?: (day: number) => boolean;
}) {
  const today = dayOf(todayMinutes());
  const [month, setMonth] = useState(() => firstOfMonth(value ?? today));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  const [y, m] = ymd(month);
  const cells: (number | null)[] = Array(weekday(month)).fill(null);
  for (let d = month; ymd(d)[1] === m; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const h = 262, below = anchor.bottom + h < window.innerHeight;
  const style = { left: Math.max(4, Math.min(anchor.left, window.innerWidth - 236)), top: below ? anchor.bottom + 2 : Math.max(4, anchor.top - h - 2) };
  return (
    <div className="dp" ref={ref} style={style} onMouseDown={e => e.preventDefault()} role="dialog" aria-label="Choose a date">
      <div className="dp-head">
        <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <b>{MONTHS_LONG[m - 1]} {y}</b>
        <button type="button" className="dp-nav" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</button>
      </div>
      <div className="dp-grid">
        {DAYS.map(d => <span key={d} className="dp-dow">{d.slice(0, 2)}</span>)}
        {cells.map((d, i) => d == null ? <span key={i} /> : (
          <button type="button" key={i} onClick={() => onPick(d)}
            className={'dp-day' + (d === value ? ' sel' : '') + (d === today ? ' today' : '') + (workingDay && !workingDay(d) ? ' off' : '')}>{ymd(d)[2]}</button>
        ))}
      </div>
      <div className="dp-foot">
        <button type="button" className="linkbtn" onClick={() => onPick(today)}>Today</button>
        <button type="button" className="linkbtn" onClick={() => onPick(null)}>NA</button>
      </div>
    </div>
  );
}

// A text box for a date with a calendar button. Text stays editable; picking a day keeps the time of day.
export function DateInput({ value, onChange, format, defaultMinute, disabled, workingDay, autoFocus }: {
  value: string; onChange: (text: string) => void; format: DateFormat; defaultMinute: number; disabled?: boolean; workingDay?: (day: number) => boolean; autoFocus?: boolean;
}) {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const parsed = parseDateText(value, format);
  return (
    <span className="date-input" ref={box}>
      <input className="inp" value={value} disabled={disabled} autoFocus={autoFocus} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); setOpen(box.current!.getBoundingClientRect()); } }} />
      <button type="button" className="date-btn" disabled={disabled} aria-label="Open calendar" onClick={() => setOpen(open ? null : box.current!.getBoundingClientRect())}><Icon name="calendar" /></button>
      {open && <CalendarPopup value={parsed?.day ?? null} anchor={open} workingDay={workingDay} onClose={() => setOpen(null)}
        onPick={d => { setOpen(null); onChange(d == null ? '' : fmtDate(atDay(d, parsed?.minute ?? defaultMinute), { time: true, format })); }} />}
    </span>
  );
}

export const minuteOrDefault = (t: Minutes | null | undefined, def: number) => (t == null ? def : minuteOfDay(t));

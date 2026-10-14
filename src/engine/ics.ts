// Milestones and deadlines as an iCalendar file (.ics) for Outlook, Google Calendar or Apple Calendar.
import { dayOf, ymd } from './time';
import { schedule, type Schedule } from './schedule';
import type { Project } from './model';

const d8 = (day: number) => { const [y, m, d] = ymd(day); return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`; };
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
// Lines longer than 75 octets are folded, as the format requires.
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join('\r\n ');

export function toIcs(p: Project, s: Schedule = schedule(p), all = false): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cairn//Project planner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc(p.name)];
  const event = (uid: string, title: string, a: number, b: number, desc: string) => out.push('BEGIN:VEVENT', 'UID:' + uid + '@cairn', 'DTSTAMP:' + stamp,
    'DTSTART;VALUE=DATE:' + d8(a), 'DTEND;VALUE=DATE:' + d8(b + 1), fold('SUMMARY:' + esc(title)), fold('DESCRIPTION:' + esc(desc)), 'END:VEVENT');
  s.rows.forEach(r => {
    const t = r.task;
    if (t.uid <= 0) return;
    const ms = !r.summary && r.duration === 0;
    if (ms || (all && !r.summary)) event('t' + t.uid + '-' + p.nextTaskUid, (ms ? '◆ ' : '') + t.name, dayOf(r.start), dayOf(Math.max(r.start, r.finish - 1)), p.name + ' · task ' + r.id + (t.notes ? '\n' + t.notes : ''));
    if (t.deadline != null) event('d' + t.uid, 'Deadline: ' + t.name, dayOf(t.deadline), dayOf(t.deadline), p.name + ' · task ' + r.id);
  });
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

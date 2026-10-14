// Quick add: one line of text becomes a task. "Pour slab 5d after 4 @Crew by 20 Mar" gives the name
// "Pour slab", 5 days, a link after task 4 (a row number or the start of a task name), Crew assigned,
// and a deadline. "from 3 Mar" sets the start; "!" or the word milestone makes a milestone.
export interface QuickTask { name: string; duration?: string; milestone: boolean; after: string[]; people: string[]; from?: string; by?: string }

const DUR = /(?:^|\s)(\d+(?:\.\d+)?\s*(?:mins?|minutes?|m|hrs?|hours?|h|days?|d|wks?|weeks?|w|mons?|months?|mo)\??)(?=\s|$)/i;
const DATE_WORD = '(?:\\d{1,4}[/.-]\\d{1,2}(?:[/.-]\\d{1,4})?|\\d{1,2}\\s+[a-z]{3,9}(?:\\s+\\d{2,4})?|[a-z]{3,9}\\s+\\d{1,2}(?:\\s+\\d{2,4})?|today|tomorrow|next\\s+[a-z]+|mon|tue|wed|thu|fri|sat|sun)';

export function parseQuickAdd(line: string): QuickTask {
  let s = ' ' + line.trim() + ' ';
  const out: QuickTask = { name: '', milestone: false, after: [], people: [] };
  // People: @Name or @"Two words", with optional [50%].
  s = s.replace(/\s@(?:"([^"]+)"|([^\s,@]+))(\[[^\]]*\])?/g, (_m, q: string, w: string, u: string) => { out.people.push((q || w).replace(/_/g, ' ') + (u || '')); return ' '; });
  // Links: after 3, 5 / after "Design review" / after Design
  s = s.replace(/\safter\s+((?:"[^"]+"|[^\s,]+)(?:\s*,\s*(?:"[^"]+"|[^\s,]+))*)/i, (_m, list: string) => { out.after = list.split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean); return ' '; });
  s = s.replace(new RegExp('\\s(?:from|starting|on)\\s+(' + DATE_WORD + ')(?=\\s)', 'i'), (_m, d: string) => { out.from = d; return ' '; });
  s = s.replace(new RegExp('\\s(?:by|due|deadline)\\s+(' + DATE_WORD + ')(?=\\s)', 'i'), (_m, d: string) => { out.by = d; return ' '; });
  if (/(^|\s)(!|milestone)(?=\s|$)/i.test(s)) { out.milestone = true; s = s.replace(/(^|\s)(!|milestone)(?=\s|$)/gi, ' '); }
  const d = DUR.exec(s);
  if (d) { out.duration = d[1].replace(/\s+/g, ''); s = s.slice(0, d.index) + ' ' + s.slice(d.index + d[0].length); }
  out.name = s.replace(/\s+/g, ' ').trim();
  return out;
}

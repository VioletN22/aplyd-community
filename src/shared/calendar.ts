/** Calendar arithmetic uses civil dates in the user's configured IANA timezone. */
export const SYSTEM_CALENDAR_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export let CALENDAR_ZONE = SYSTEM_CALENDAR_ZONE;
export interface RecurringCommitment { weekday: number; title: string; startHour: number; endHour: number; slug: string; until?: string; skip?: string[] }
export interface CalendarPreferences { timeZone: string; recurring: RecurringCommitment[] }
export let RECURRING: RecurringCommitment[] = [];
export function validateCalendarPreferences(value: unknown): CalendarPreferences {
  const input = value as CalendarPreferences;
  if (!input || typeof input.timeZone !== 'string') throw new Error('Choose an IANA timezone, such as Europe/London.');
  try { new Intl.DateTimeFormat('en', {timeZone: input.timeZone}).format(); } catch { throw new Error('Choose a valid IANA timezone.'); }
  if (!Array.isArray(input.recurring) || input.recurring.length > 100) throw new Error('Choose up to 100 recurring commitments.');
  const slugs = new Set<string>();
  const validDay = (day: unknown) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
  for (const row of input.recurring) {
    if (!row || !Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 ||
      typeof row.title !== 'string' || !row.title.trim() || row.title.length > 200 ||
      typeof row.slug !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.slug) || slugs.has(row.slug) ||
      !Number.isFinite(row.startHour) || !Number.isFinite(row.endHour) || row.startHour < 0 || row.endHour > 24 || row.endHour <= row.startHour ||
      (row.until !== undefined && !validDay(row.until)) ||
      (row.skip !== undefined && (!Array.isArray(row.skip) || row.skip.length > 366 || !row.skip.every(validDay)))) throw new Error('Check each recurring commitment: title, weekday, start and end times must be valid.');
    slugs.add(row.slug);
  }
  return {timeZone: input.timeZone, recurring: input.recurring.map(row => ({...row, title: row.title.trim(), ...(row.skip ? {skip:[...row.skip]} : {})}))};
}
export function configureCalendar(value: CalendarPreferences): void {
  const validated = validateCalendarPreferences(value);
  CALENDAR_ZONE = validated.timeZone; RECURRING = validated.recurring;
}
export interface CalendarEvent {
  id: string; title: string; start: string; end: string; allDay: boolean;
  category: 'interview' | 'deadline' | 'shift' | 'outreach' | 'google' | 'class';
  applicationId?: string; actionItemId?: string; leadId?: string; url?: string; readOnly?: boolean;
  /** A missed to-do carried onto today: the civil day it was due. */
  overdueFrom?: string;
}
export interface CalendarApplication { id: string; company: string; job_title?: string; current_stage: string; interview_at?: string | null; interview_minutes?: number | null }
export interface CalendarTask { id: string; title: string; kind: string; due_at?: string | null; ends_at?: string | null; status: string; application_id?: string | null; url?: string | null }
export interface CalendarLead { id: string; org: string; stage: string; next_due_at?: string | null; next_step?: string | null }
export function dateKey(date: Date = new Date(), timeZone = CALENDAR_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit' }).format(date);
}
export function addDays(day: string, amount: number): string {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+amount); return d.toISOString().slice(0,10);
}
export function weekDates(day: string, count: number = 5): string[] {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = addDays(day, -((weekday+6)%7));
  return Array.from({length:count},(_,i)=>addDays(monday,i));
}
function timing(value: string | null | undefined, minutes=30): Pick<CalendarEvent,'start'|'end'|'allDay'> | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==value) return null;
    return {start:value,end:addDays(value,1),allDay:true};
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const duration = Number.isFinite(minutes) && minutes>0 ? minutes : 30;
  return {start:d.toISOString(),end:new Date(d.getTime()+duration*60000).toISOString(),allDay:false};
}
// Action items that are a meeting at a set time, not something to get done that day.
const MEETING_KINDS = new Set(['interview', 'phone_screen', 'meeting', 'call']);
/** A to-do: something to get done that day (or by a time). It sits in the day's
 *  to-do list, never on the time grid, so it can't look like it clashes with a
 *  shift or meeting that actually happens then. */
export function isTodo(e: Pick<CalendarEvent, 'category'>): boolean { return e.category === 'deadline' || e.category === 'outreach'; }
/** How long a missed to-do rolls forward before it asks whether it is still wanted. */
export const STALE_DAYS = 14;
/**
 * Missed to-dos move to today instead of sitting on a day that has gone: each
 * becomes an all-day to-do on `today` that remembers the day it was due. The
 * stored due date is unchanged. Events stay where they happened.
 */
export function rollOverdue<T extends CalendarEvent>(events: T[], today: string): T[] {
  return events.map((e) => {
    if (!isTodo(e)) return e;
    const day = e.allDay ? e.start : dateKey(new Date(e.start));
    return day < today ? { ...e, start: today, end: addDays(today, 1), allDay: true, overdueFrom: day } : e;
  });
}
/** Has this carried-over to-do been missed long enough to ask about? */
export function isStale(e: Pick<CalendarEvent, 'overdueFrom'>, today: string, days = STALE_DAYS): boolean {
  return !!e.overdueFrom && e.overdueFrom <= addDays(today, -days);
}
/** Order within a day's to-dos: missed ones first (oldest first), then timed by time, then the rest. */
export function todoOrder(a: CalendarEvent, b: CalendarEvent): number {
  if (!!a.overdueFrom !== !!b.overdueFrom) return a.overdueFrom ? -1 : 1;
  if (a.overdueFrom && b.overdueFrom) return a.overdueFrom.localeCompare(b.overdueFrom);
  if (a.allDay !== b.allDay) return a.allDay ? 1 : -1;
  return a.start.localeCompare(b.start);
}
export function buildCalendarEvents(input: { applications?: CalendarApplication[]; actionItems?: CalendarTask[]; leads?: CalendarLead[]; googleEvents?: CalendarEvent[] }): CalendarEvent[] {
  const events: CalendarEvent[]=[];
  const terminal = new Set((input.applications||[]).filter(a=>['rejected','withdrawn','offer'].includes(a.current_stage)).map(a=>a.id));
  for(const a of input.applications||[]) {
    if (!['phone_screen','interview'].includes(a.current_stage)) continue;
    const time=timing(a.interview_at,a.interview_minutes??30); if(!time)continue;
    events.push({id:`interview:${a.id}`,title:`${a.company} · ${a.current_stage==='phone_screen'?'Phone screen':'Interview'}`,category:'interview',applicationId:a.id,...time});
  }
  // An agent often records the same interview twice: on the application and as a
  // task due at that time. The application's interview wins; a task for the same
  // application due within three hours of it is the same meeting, so it is skipped.
  const interviewAt=new Map<string,number[]>();
  for(const e of events) if(e.applicationId) interviewAt.set(e.applicationId,[...(interviewAt.get(e.applicationId)||[]),Date.parse(e.start)]);
  const sameMeeting=(t:CalendarTask,start:string)=>!!t.application_id&&(interviewAt.get(t.application_id)||[]).some(at=>Math.abs(Date.parse(start)-at)<=3*3600000);
  for(const t of input.actionItems||[]) {
    // A rostered shift belongs to an accepted offer, so it stays on the grid after the application closes.
    if(t.status!=='open'||(t.kind!=='shift'&&t.application_id&&terminal.has(t.application_id)))continue;
    const time=timing(t.due_at); if(!time)continue;
    if(!time.allDay&&sameMeeting(t,time.start))continue;
    // A task with its own end (a rostered shift) is drawn as the block it is, not a 30-minute deadline.
    const end=t.ends_at&&!time.allDay?Date.parse(t.ends_at):NaN;
    if(Number.isFinite(end)&&end>Date.parse(time.start)) time.end=new Date(end).toISOString();
    events.push({id:`task:${t.id}`,title:t.title,category:t.kind==='shift'?'shift':MEETING_KINDS.has(t.kind)&&!time.allDay?'interview':'deadline',actionItemId:t.id,applicationId:t.application_id||undefined,url:t.url||undefined,...time});
  }
  for(const l of input.leads||[]) {
    if(['lost','won'].includes(l.stage))continue;
    const time=timing(l.next_due_at); if(!time)continue;
    events.push({id:`lead:${l.id}`,title:`${l.org}${l.next_step?` · ${l.next_step}`:''}`,category:'outreach',leadId:l.id,...time});
  }
  return [...events,...(input.googleEvents||[])].sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}

/** Interval groups share a column count; non-overlapping events reuse a lane. */
export function layoutTimedEvents<T extends CalendarEvent>(events:T[]):{event:T;column:number;columns:number}[] {
  const result:{event:T;column:number;columns:number}[]=[];
  let group:typeof result=[]; let ends:number[]=[]; let groupEnd=-Infinity;
  const finish=()=>{for(const item of group)item.columns=ends.length;group=[];ends=[];};
  for(const event of [...events].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||Date.parse(b.end)-Date.parse(a.end))) {
    const start=Date.parse(event.start); const end=Date.parse(event.end);
    if(start>=groupEnd){finish();groupEnd=-Infinity;}
    let column=ends.findIndex(value=>value<=start);
    if(column<0)column=ends.length;
    ends[column]=end;groupEnd=Math.max(groupEnd,end);
    const item={event,column,columns:1}; group.push(item);result.push(item);
  }
  finish();return result;
}

/** Convert a configured civil midnight through Intl, including a DST transition day. */
export function zoneMidnight(day: string, timeZone = CALENDAR_ZONE): string { return zoneTime(day, 0, timeZone); }
/** Convert a configured civil hour on a day to an instant, including a DST transition day. */
export function zoneTime(day: string, hour: number, timeZone = CALENDAR_ZONE): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Choose a valid calendar week.');
  const target = Date.parse(`${day}T00:00:00Z`) + hour * 3600000;
  if (!Number.isFinite(target) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day || !Number.isFinite(hour) || hour < 0 || hour > 24) throw new Error('Choose a valid calendar week.');
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const represented = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  // Consider both offsets around a DST change. For a repeated hour use its first
  // occurrence; for a skipped hour move forward by the gap (compatible behavior).
  const offsets = new Set([-36,0,36].map(h => { const at = target+h*3600000; return represented(at)-at; }));
  const candidates = [...offsets].map(offset => target-offset).sort((a,b)=>a-b);
  const exact = candidates.find(at => represented(at) === target);
  const instant = exact ?? candidates.filter(at => represented(at) > target).sort((a,b)=>represented(a)-represented(b))[0];
  if (instant === undefined) throw new Error('Could not resolve this calendar time.');
  return new Date(instant).toISOString();
}


export interface CalendarDaySegment extends CalendarEvent {
  startMinute: number;
  endMinute: number;
  /** True when this segment is the tail of an event that began on an earlier day. */
  continues: boolean;
}
/** Clip each overlapping event to one configured civil day, including 23/25-hour days. */
export function dailyTimedSegments(events: CalendarEvent[], day: string, timeZone = CALENDAR_ZONE): CalendarDaySegment[] {
  const dayStart = Date.parse(zoneMidnight(day, timeZone));
  const dayEnd = Date.parse(zoneMidnight(addDays(day, 1), timeZone));
  const civilMinutes = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(instant)).split(':').map(Number);
    return parts[0] * 60 + parts[1];
  };
  return events.flatMap(event => {
    if (event.allDay) return [];
    const start = Math.max(Date.parse(event.start), dayStart);
    const end = Math.min(Date.parse(event.end), dayEnd);
    if (!(end > start)) return [];
    return [{
      ...event, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      startMinute: start === dayStart ? 0 : civilMinutes(start),
      endMinute: end === dayEnd ? 1440 : civilMinutes(end),
      continues: Date.parse(event.start) < dayStart,
    }];
  });
}

/** Expand the standing commitments onto the given civil days. */
export function recurringEvents(days: string[], commitments: RecurringCommitment[] = RECURRING, timeZone = CALENDAR_ZONE): CalendarEvent[] {
  return days.flatMap(day => {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    return commitments.filter(r => r.weekday === weekday && (!r.until || day <= r.until) && !r.skip?.includes(day)).flatMap(r => {
      const start = zoneTime(day, r.startHour, timeZone);
      const end = zoneTime(day, r.endHour, timeZone);
      // A DST gap can consume the whole commitment; never emit a backwards interval.
      if (Date.parse(end) <= Date.parse(start)) return [];
      return [{id: `${r.slug}:${day}`, title: r.title, category: 'class' as const, allDay: false, readOnly: true,
        start, end}];
    });
  });
}
/** A chip-sized label: the subject before an agent's instructions. */
export function compactTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 40) return trimmed;
  const subject = trimmed.split(/\s·\s|[.;:](?=\s|$)/)[0].trim();
  return subject.length >= 3 ? subject : trimmed;
}

/**
 * Many outreach leads share a follow-up day (a batch of first emails all wants a
 * nudge on the same date). Three or more all-day outreach items on one day become
 * one "N lead follow-ups" event that opens the Outreach list; fewer stay as they are.
 */
export function groupOutreachFollowUps(events: CalendarEvent[], min = 3): CalendarEvent[] {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) if (e.category === 'outreach' && e.allDay) byDay.set(e.start, [...(byDay.get(e.start) || []), e]);
  const grouped = new Set<string>();
  const extra: CalendarEvent[] = [];
  for (const [day, list] of byDay) {
    if (list.length < min) continue;
    list.forEach(e => grouped.add(e.id));
    extra.push({id: `outreach-group:${day}`, title: `${list.length} lead follow-ups`, category: 'outreach', allDay: true, start: day, end: addDays(day, 1), readOnly: true});
  }
  if (!extra.length) return events;
  return [...events.filter(e => !grouped.has(e.id)), ...extra].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

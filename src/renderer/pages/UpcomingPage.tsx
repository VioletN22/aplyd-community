import React, { useMemo } from 'react';
import type { CockpitData } from '../../shared/cockpit';
import { addDays, CALENDAR_ZONE, compactTitle, dateKey, groupOutreachFollowUps, isStale, isTodo, todoOrder, type CalendarEvent } from '../../shared/calendar';
import { useCalendarEvents, onDay } from '../hooks/useCalendarEvents';
import { useMarkTodoDone } from '../hooks/useMarkTodoDone';
import { displayLocale } from '../../shared/locale';

interface Props {
  cockpit: CockpitData | null;
  reloadCockpit: () => unknown;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenCalendar: () => void;
}

const COLOR: Record<CalendarEvent['category'], string> = {
  interview: 'var(--red)', deadline: 'var(--orange)', shift: '#4f9a6c', outreach: 'var(--purple)', google: 'var(--faint)', class: 'var(--faint)',
};
const NOTE: Record<CalendarEvent['category'], string> = {
  interview: 'Interview', deadline: 'To do', shift: 'Shift', outreach: 'Outreach', google: 'Google', class: 'Commitment',
};
const DAYS_AHEAD = 14;

const clock = (iso: string) => new Date(iso).toLocaleTimeString(displayLocale(), { timeZone: CALENDAR_ZONE, hour: 'numeric', minute: '2-digit' }).toLowerCase();
const civil = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(displayLocale(), { timeZone: 'UTC', ...opts });

/** The next two weeks day by day, then the rest of what is dated, by month. */
export const UpcomingPage: React.FC<Props> = ({ cockpit, reloadCockpit, onOpenEvent, onOpenCalendar }) => {
  const { ticked, markDone, dismiss, error } = useMarkTodoDone(reloadCockpit);
  const today = dateKey();
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const { events, statusLine } = useCalendarEvents(cockpit?.events ?? [], days);
  const keyOf = (iso: string) => dateKey(new Date(iso));
  // What happens at a set time comes first, then the day's to-dos.
  const sort = (a: CalendarEvent, b: CalendarEvent) => (isTodo(a) !== isTodo(b) ? (isTodo(a) ? 1 : -1) : isTodo(a) ? todoOrder(a, b) : a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1);

  const horizon = addDays(today, DAYS_AHEAD);
  const later = groupOutreachFollowUps(cockpit?.events ?? [])
    .filter((e) => { const d = e.allDay ? e.start : keyOf(e.start); return d >= horizon; })
    .sort(sort);
  const months = new Map<string, CalendarEvent[]>();
  for (const e of later) {
    const d = e.allDay ? e.start : keyOf(e.start);
    const m = d.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), e]);
  }

  const row = (e: CalendarEvent, showDate?: string) => {
    const done = !!e.actionItemId && ticked.has(e.actionItemId);
    return (
    <div key={e.id} className={`up-item ${isTodo(e) ? 'todo' : ''} ${done ? 'ticked' : ''} ${e.overdueFrom ? 'late' : ''}`}>
      {showDate && <time className="up-date">{showDate}</time>}
      {isTodo(e) && e.actionItemId
        ? <button className="up-box" style={{ borderColor: COLOR[e.category], background: done ? COLOR[e.category] : undefined }} aria-label={`Mark done: ${e.title}`} disabled={done} onClick={() => void markDone(e.actionItemId!)} />
        : isTodo(e) ? <span className="up-box" style={{ borderColor: COLOR[e.category] }} /> : <span className="up-bar" style={{ background: COLOR[e.category] }} />}
      <button className="up-open" onClick={() => onOpenEvent(e)} title={e.title}>
      <time>{e.overdueFrom ? `was due ${civil(e.overdueFrom, { day: 'numeric', month: 'short' })}` : isTodo(e) ? (e.allDay ? 'To do' : `by ${clock(e.start)}`) : e.allDay ? 'All day' : clock(e.start)}</time>
      <span className="up-title">{compactTitle(e.title)}</span>
      {!(e.actionItemId && isStale(e, today) && !done) && <span className="up-note">{e.overdueFrom ? 'Overdue' : NOTE[e.category]}</span>}
      </button>
      {e.actionItemId && isStale(e, today) && !done && <button className="todo-dismiss" onClick={() => void dismiss(e.actionItemId!)} title="Over two weeks late. Still want this?">Dismiss</button>}
    </div>
    );
  };

  return (
    <div className="page">
      <div className="page-title">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="3" fill="var(--red)" /><rect x="5" y="9" width="14" height="10" rx="1.5" fill="#fff" /><path d="M8 2.5v4 M16 2.5v4" stroke="var(--red)" strokeWidth={2} strokeLinecap="round" /></svg>
        <h1>Upcoming</h1>
      </div>
      <p className="page-lede">Interviews, to-dos and outreach follow-ups for the next two weeks. {statusLine}. <button className="inline-link" onClick={onOpenCalendar}>Open the calendar</button></p>
      {error && <p role="alert" className="page-error">{error}</p>}

      {days.map((d, i) => {
        const list = events.filter((e) => onDay(e, d, keyOf)).sort(sort);
        if (!list.length && i > 6) return null;
        return (
          <section key={d} className={`up-day ${list.length ? '' : 'empty'}`}>
            <div className="up-num">{Number(d.slice(8))}</div>
            <div className="up-head">{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : civil(d, { weekday: 'long' })}<span>{i < 2 ? civil(d, { weekday: 'long' }) : civil(d, { day: 'numeric', month: 'long' })}</span></div>
            <div className="up-items">
              {list.length ? list.map((e) => row(e)) : <p className="up-free">Nothing booked.</p>}
            </div>
          </section>
        );
      })}

      {[...months.entries()].map(([m, list]) => (
        <section key={m}>
          <div className="up-month">{civil(`${m}-15`, { month: 'long', year: 'numeric' })}</div>
          <div className="up-items indent">{list.map((e) => row(e, civil(e.allDay ? e.start : keyOf(e.start), { weekday: 'short', day: 'numeric' })))}</div>
        </section>
      ))}
    </div>
  );
};

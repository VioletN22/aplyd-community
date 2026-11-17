import React, { useCallback, useMemo, useState } from 'react';
import type { CockpitData } from '../../shared/cockpit';
import {
  addDays, CALENDAR_ZONE, compactTitle, dailyTimedSegments, dateKey, isStale, isTodo, layoutTimedEvents, todoOrder, weekDates,
  type CalendarEvent, type CalendarDaySegment,
} from '../../shared/calendar';
import { EventPopover } from '../components/EventPopover';
import { useCalendarEvents, onDay } from '../hooks/useCalendarEvents';
import { useMarkTodoDone } from '../hooks/useMarkTodoDone';
import { displayLocale, shortClock } from '../../shared/locale';

interface Props {
  cockpit: CockpitData | null;
  reloadCockpit: () => unknown;
  onOpenEvent: (event: CalendarEvent) => void;
}

type Mode = 'week' | 'month';
const MODE_KEY = 'aplyd.calendarMode';
const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'week'; } catch { return 'week'; } };

const START = 7 * 60;   // 7 am
const END = 24 * 60;    // midnight, so 10 pm and 11 pm calls sit in the grid
const HOUR = 52;        // px per hour
const PX = HOUR / 60;

const clock = (iso: string) => shortClock(iso, { timeZone: CALENDAR_ZONE });
const civil = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(displayLocale(), { timeZone: 'UTC', ...opts });
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const keyOf = (iso: string) => dateKey(new Date(iso));

/** Monday-first weeks covering the whole month that `day` is in. */
function monthDays(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`;
  let cursor = weekDates(first, 1)[0];
  const out: string[] = [];
  while (out.length < 35 || cursor.slice(0, 7) === day.slice(0, 7)) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    if (out.length >= 42) break;
  }
  return out.length % 7 ? out.slice(0, out.length - (out.length % 7)) : out;
}

/** A to-do as a checklist line; a timed one says when it is due by. The box ticks it off. */
const TodoLine: React.FC<{ e: CalendarEvent; today: string; ticked: boolean; onTick?: () => void; onDismiss?: () => void; onClick: (ev: React.MouseEvent<HTMLElement>) => void }> = ({ e, today, ticked, onTick, onDismiss, onClick }) => (
  <div className={`todo-ev k-${e.category} ${ticked ? 'ticked' : ''} ${e.overdueFrom ? 'late' : ''}`}>
    {onTick
      ? <button className="todo-tick" aria-label={`Mark done: ${e.title}`} disabled={ticked} onClick={onTick} />
      : <i aria-hidden="true" />}
    <button className="todo-open" onClick={onClick} title={e.title}>
      <span>{compactTitle(e.title)}</span>
      {e.overdueFrom ? <em>was due {civil(e.overdueFrom, { day: 'numeric', month: 'short' })}</em> : !e.allDay && <em>by {clock(e.start)}</em>}
    </button>
    {onDismiss && isStale(e, today) && !ticked && <button className="todo-dismiss" onClick={onDismiss} title="Over two weeks late. Still want this?">Dismiss</button>}
  </div>
);

const LEGEND: [CalendarEvent['category'], string][] = [['interview', 'Interviews'], ['deadline', 'To do'], ['shift', 'Shifts'], ['outreach', 'Outreach'], ['class', 'Commitment'], ['google', 'Google Calendar']];

/** The full calendar: a timed week, or the whole month at a glance. */
export const CalendarPage: React.FC<Props> = ({ cockpit, reloadCockpit, onOpenEvent }) => {
  const { ticked, markDone, dismiss, error } = useMarkTodoDone(reloadCockpit);
  const today = dateKey();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [anchor, setAnchor] = useState(today);
  const [todosExpanded, setTodosExpanded] = useState(false);
  const [picked, setPicked] = useState<{ event: CalendarEvent; anchor: DOMRect } | null>(null);
  const close = useCallback(() => setPicked(null), []);
  const pick = (event: CalendarEvent) => (e: React.MouseEvent<HTMLElement>) => setPicked({ event, anchor: e.currentTarget.getBoundingClientRect() });
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* fine */ } };

  const days = useMemo(() => (mode === 'week' ? weekDates(anchor, 7) : monthDays(anchor)), [mode, anchor]);
  const { events, statusLine } = useCalendarEvents(cockpit?.events ?? [], days);

  const step = (dir: number) => setAnchor((a) => {
    if (mode === 'week') return addDays(a, 7 * dir);
    const d = new Date(`${a.slice(0, 7)}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + dir);
    return d.toISOString().slice(0, 10);
  });

  const title = mode === 'week'
    ? `${civil(days[0], { day: 'numeric', month: days[0].slice(5, 7) === days[6].slice(5, 7) ? undefined : 'long' })} to ${civil(days[6], { day: 'numeric', month: 'long' })}`
    : civil(`${anchor.slice(0, 7)}-15`, { month: 'long', year: 'numeric' });
  const inRange = events.filter((e) => days.some((d) => onDay(e, d, keyOf)));
  const count = (c: CalendarEvent['category']) => inRange.filter((e) => e.category === c).length;
  const lede = [
    count('interview') ? `${count('interview')} interview${count('interview') > 1 ? 's' : ''}` : '',
    count('deadline') ? `${count('deadline')} to-do${count('deadline') > 1 ? 's' : ''}` : '',
    count('outreach') ? `${count('outreach')} outreach` : '',
  ].filter(Boolean).join(', ');

  return (
    <div className="page wide">
      <div className="page-title">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="3" fill="var(--red)" /><rect x="5" y="9" width="14" height="10" rx="1.5" fill="#fff" /><path d="M8 2.5v4 M16 2.5v4" stroke="var(--red)" strokeWidth={2} strokeLinecap="round" /></svg>
        <h1>{title}</h1>
      </div>
      <p className="page-lede">{lede ? `${lede} ${mode === 'week' ? 'this week' : 'this month'}.` : 'Nothing booked.'} {statusLine}, so it is on your phone too.</p>
      {error && <p role="alert" className="page-error">{error}</p>}

      <div className="cal-head">
        <div className="seg" role="group" aria-label="Range">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Week</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
        </div>
        <button className="cal-nav" aria-label={mode === 'week' ? 'Previous week' : 'Previous month'} onClick={() => step(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6l6 6" /></svg>
        </button>
        <button className="btn" onClick={() => setAnchor(today)}>Today</button>
        <button className="cal-nav" aria-label={mode === 'week' ? 'Next week' : 'Next month'} onClick={() => step(1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
        </button>
        <span className="spacer" />
        <div className="cal-legend">{LEGEND.filter(([c]) => c === 'interview' || c === 'deadline' || c === 'outreach' || c === 'google' || events.some((e) => e.category === c)).map(([c, l]) => <span key={c}><i className={`k-${c}`} />{l}</span>)}</div>
      </div>

      <div className="cal-scroll">
        {mode === 'week' ? (
          <div className="wk-grid">
            <div className="wk-corner" />
            {days.map((d) => (
              <div key={d} className={`wk-hd ${d === today ? 'is-today' : ''} ${[0, 6].includes(weekday(d)) ? 'wkend' : ''}`}>
                <span>{civil(d, { weekday: 'short' })}</span><b>{Number(d.slice(8))}</b>
              </div>
            ))}
            <div className="wk-alllabel">
              <button className="wk-todo-toggle" aria-expanded={todosExpanded} aria-controls={days.map((d) => `week-todos-${d}`).join(' ')}
                aria-label={todosExpanded ? 'Collapse to do row' : 'Expand to do row'} onClick={() => setTodosExpanded((expanded) => !expanded)}>
                <span>to do</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={todosExpanded ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
                </svg>
              </button>
            </div>
            {days.map((d) => (
              <div key={d} className="wk-all">
                <div className="wk-allitems" id={`week-todos-${d}`} hidden={!todosExpanded}>
                  {events.filter((e) => e.allDay && !isTodo(e) && e.start <= d && e.end > d).map((e) => (
                    <button key={e.id} className={`chip-ev k-${e.category}`} onClick={pick(e)} title={e.title}>{compactTitle(e.title)}</button>
                  ))}
                  {events.filter((e) => isTodo(e) && onDay(e, d, keyOf))
                    .sort(todoOrder)
                    .map((e) => <TodoLine key={e.id} e={e} today={today} onClick={pick(e)} ticked={!!e.actionItemId && ticked.has(e.actionItemId)}
                      onTick={e.actionItemId ? () => void markDone(e.actionItemId!) : undefined} onDismiss={e.actionItemId ? () => void dismiss(e.actionItemId!) : undefined} />)}
                </div>
              </div>
            ))}
            <div className="wk-times">
              {Array.from({ length: (END - START) / 60 }, (_, i) => {
                const h = START / 60 + i;
                return <span key={h} style={{ top: i * HOUR }}>{h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`}</span>;
              })}
            </div>
            {days.map((d) => {
              const own = dailyTimedSegments(events.filter((e) => !isTodo(e)), d).filter((e) => !e.continues || e.endMinute > 60);
              const inside = own.filter((e) => e.endMinute > START && e.startMinute < END);
              const outside = own.filter((e) => e.startMinute < START || e.startMinute >= END);
              const isToday = d === today;
              const nowMin = isToday ? (() => { const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: CALENDAR_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number); return h * 60 + m; })() : -1;
              return (
                <div key={d} className={`wk-day ${isToday ? 'is-today' : ''} ${[0, 6].includes(weekday(d)) ? 'wkend' : ''}`} style={{ height: (END - START) * PX }}>
                  {layoutTimedEvents(inside).map(({ event: e, column, columns }) => {
                    const top = (Math.max(START, e.startMinute) - START) * PX;
                    const height = Math.max(24, (Math.min(END, e.endMinute) - Math.max(START, e.startMinute)) * PX - 2);
                    const width = 100 / columns;
                    return (
                      <button key={e.id} className={`wk-ev k-${e.category} ${height < 40 ? 'short' : ''}`} onClick={pick(e)} title={`${clock(e.start)} ${e.title}`}
                        style={{ top, height, left: `calc(${column * width}% + 3px)`, width: `calc(${width}% - 6px)` }}>
                        <b>{compactTitle(e.title)}</b>{height >= 40 && <span>{e.continues ? 'continues' : `${clock(e.start)} to ${clock(e.end)}`}</span>}
                      </button>
                    );
                  })}
                  {outside.length > 0 && (
                    <div className="wk-outside">
                      {outside.map((e: CalendarDaySegment) => <button key={e.id} className={`chip-ev k-${e.category}`} onClick={pick(e)} title={e.title}>{clock(e.start)} {compactTitle(e.title)}</button>)}
                    </div>
                  )}
                  {nowMin >= START && nowMin <= END && <div className="wk-now" style={{ top: (nowMin - START) * PX }} aria-label="Now" />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mo-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="mo-dow">{d}</div>)}
            {days.map((d) => {
              const list = events.filter((e) => onDay(e, d, keyOf))
                .sort((a, b) => (isTodo(a) !== isTodo(b) ? (isTodo(a) ? 1 : -1) : a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
              const out = d.slice(0, 7) !== anchor.slice(0, 7);
              const shown = list.slice(0, 4);
              return (
                <div key={d} className={`mo-cell ${out ? 'out' : ''} ${d === today ? 'is-today' : ''} ${d < today ? 'past' : ''} ${[0, 6].includes(weekday(d)) ? 'wkend' : ''}`}>
                  <button className="mo-num" onClick={() => { setAnchor(d); setMode('week'); }} aria-label={`Show the week of ${civil(d, { day: 'numeric', month: 'long' })}`}>{Number(d.slice(8))}</button>
                  {shown.map((e) => (
                    <button key={e.id} className={`mo-ev k-${e.category} ${e.category === 'interview' ? 'fill' : ''} ${isTodo(e) ? 'todo' : ''}`} onClick={pick(e)} title={e.title}>
                      <i />{compactTitle(e.title)}{!e.allDay && <span>{isTodo(e) ? `by ${clock(e.start)}` : clock(e.start)}</span>}
                    </button>
                  ))}
                  {list.length > shown.length && <button className="mo-more" onClick={() => { setAnchor(d); setMode('week'); }}>{list.length - shown.length} more</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {picked && <EventPopover event={picked.event} anchor={picked.anchor} onOpen={onOpenEvent} onClose={close} />}
    </div>
  );
};

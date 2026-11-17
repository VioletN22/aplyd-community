import { useEffect, useMemo, useState } from 'react';
import { CALENDAR_ZONE, RECURRING, dateKey, groupOutreachFollowUps, recurringEvents, rollOverdue, weekDates, type CalendarEvent } from '../../shared/calendar';
import type { CalendarStatus } from '../../shared/google-calendar';

/**
 * Every event touching the given civil days: Aplyd's own (interviews,
 * deadlines, outreach), the standing weekly commitments, and your Google Calendar,
 * which is read one week at a time.
 */
export function useCalendarEvents(own: CalendarEvent[], days: string[]) {
  const [google, setGoogle] = useState<CalendarEvent[]>([]);
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [error, setError] = useState('');

  // The Mondays of every week the range touches, as one stable key.
  const weeks = useMemo(() => Array.from(new Set(days.map((d) => weekDates(d, 1)[0]))), [days.join(',')]);
  const weeksKey = weeks.join(',');

  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const state = await window.electronAPI.calendar.status();
      if (!active || request !== sequence) return;
      if (state.ok && state.data) setStatus(state.data);
      if (!state.ok || !state.data?.connected) { setGoogle([]); return; }
      const results = await Promise.all(weeks.map((w) => window.electronAPI.calendar.week(w)));
      if (!active || request !== sequence) return;
      const failed = results.find((r) => !r.ok);
      setGoogle(results.flatMap((r) => (r.ok ? r.data || [] : [])));
      setError(failed ? failed.error || 'Could not read Google Calendar.' : '');
    };
    void load();
    const off = window.electronAPI.calendar.onChanged(() => void load());
    return () => { active = false; off(); };
  }, [weeksKey]);

  const events = useMemo(() => {
    const seen = new Set<string>();
    // Missed to-dos are carried onto today (see rollOverdue), so no view leaves them on a day that has gone.
    return groupOutreachFollowUps(rollOverdue([...own, ...google, ...recurringEvents(days)].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))), dateKey()));
  }, [own, google, days.join(','), CALENDAR_ZONE, RECURRING]);

  const statusLine = error || status?.error || (status?.syncing ? 'Syncing Google Calendar…'
    : status?.connected ? 'Synced with Google Calendar' : 'Google Calendar not connected');

  return { events, statusLine, connected: !!status?.connected };
}

/** Does this event fall on (or run through) the civil day? */
export function onDay(event: CalendarEvent, day: string, dayKeyOf: (iso: string) => string): boolean {
  if (event.allDay) return event.start <= day && event.end > day;
  return dayKeyOf(event.start) === day || (dayKeyOf(event.start) < day && dayKeyOf(event.end) > day);
}

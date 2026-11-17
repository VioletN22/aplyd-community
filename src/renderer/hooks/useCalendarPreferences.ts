import { useEffect, useState } from 'react';
import { CALENDAR_ZONE, RECURRING, configureCalendar, type CalendarPreferences } from '../../shared/calendar';
/** A single app-level subscription keeps all calendar consumers on the saved timezone. */
export function useCalendarPreferences() {
  const [preferences, setPreferences] = useState<CalendarPreferences>(() => ({timeZone:CALENDAR_ZONE, recurring:RECURRING}));
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const result = await window.electronAPI.calendar.preferences();
      if (active && request === sequence && result.ok && result.data) { setPreferences(previous => {
        if (JSON.stringify(previous) === JSON.stringify(result.data)) return previous;
        configureCalendar(result.data!); return result.data!;
      }); }
    };
    void load();
    const off = window.electronAPI.calendar.onChanged(() => void load());
    return () => { active = false; off(); };
  }, []);
  return preferences;
}

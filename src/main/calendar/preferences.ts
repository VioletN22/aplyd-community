import { getSetting, setSetting } from '../database';
import { configureCalendar, SYSTEM_CALENDAR_ZONE, validateCalendarPreferences, type CalendarPreferences } from '../../shared/calendar';
export function readCalendarPreferences(): CalendarPreferences {
  const raw = getSetting('calendar.preferences');
  return raw ? validateCalendarPreferences(JSON.parse(raw)) : {timeZone:SYSTEM_CALENDAR_ZONE, recurring:[]};
}
export function initializeCalendarPreferences(): void {
  // Invalid optional settings must not stop offline tracking from starting.
  try { configureCalendar(readCalendarPreferences()); }
  catch { configureCalendar({timeZone:SYSTEM_CALENDAR_ZONE,recurring:[]}); }
}
export function saveCalendarPreferences(input: unknown): CalendarPreferences {
  const preferences = validateCalendarPreferences(input);
  setSetting('calendar.preferences', JSON.stringify(preferences));
  configureCalendar(preferences);
  return preferences;
}

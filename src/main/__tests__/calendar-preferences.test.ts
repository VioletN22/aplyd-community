import { beforeEach, expect, it, vi } from 'vitest';
const settings = vi.hoisted(() => new Map<string,string>());
vi.mock('../database', () => ({getSetting:(key:string)=>settings.get(key)??null,setSetting:(key:string,value:string)=>settings.set(key,value)}));
import { initializeCalendarPreferences, readCalendarPreferences, saveCalendarPreferences } from '../calendar/preferences';
import { CALENDAR_ZONE, RECURRING, SYSTEM_CALENDAR_ZONE } from '../../shared/calendar';
beforeEach(() => {settings.clear();initializeCalendarPreferences();});
it('starts with system timezone and no personal commitments', () => {
  expect(readCalendarPreferences()).toEqual({timeZone:SYSTEM_CALENDAR_ZONE,recurring:[]});
  expect(RECURRING).toEqual([]);
});
it('round-trips user commitments and applies them in the main process', () => {
  const preferences = {timeZone:'Europe/Berlin',recurring:[{slug:'lesson',title:'Language lesson',weekday:3,startHour:17,endHour:18}]};
  expect(saveCalendarPreferences(preferences)).toEqual(preferences);
  expect(readCalendarPreferences()).toEqual(preferences);
  expect(CALENDAR_ZONE).toBe('Europe/Berlin');
  expect(RECURRING).toEqual(preferences.recurring);
});
it('does not persist invalid updates or prevent startup when existing settings are malformed', () => {
  expect(()=>saveCalendarPreferences({timeZone:'not a zone',recurring:[]})).toThrow();
  expect(settings.size).toBe(0);
  settings.set('calendar.preferences','invalid JSON');
  expect(()=>initializeCalendarPreferences()).not.toThrow();
  expect(CALENDAR_ZONE).toBe(SYSTEM_CALENDAR_ZONE);
  expect(RECURRING).toEqual([]);
  expect(()=>readCalendarPreferences()).toThrow();
});

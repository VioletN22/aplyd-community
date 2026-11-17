import { createHash } from 'crypto';
import { CALENDAR_ZONE, type CalendarEvent } from '../../shared/calendar';
export interface GoogleEvent {
  id?: string; summary?: string; status?: string;
  start?: {date?: string; dateTime?: string; timeZone?: string};
  end?: {date?: string; dateTime?: string; timeZone?: string};
  extendedProperties?: {private?: Record<string,string>};
}
export const OWNERSHIP = 'aplyd-community';
export function toGoogleEvent(event: CalendarEvent): GoogleEvent {
  return {
    id: createHash('sha256').update(`aplyd-community:${event.id}`).digest('hex'),
    summary: event.title, status: 'confirmed',
    start: event.allDay ? {date:event.start} : {dateTime:event.start,timeZone:CALENDAR_ZONE},
    end: event.allDay ? {date:event.end} : {dateTime:event.end,timeZone:CALENDAR_ZONE},
    extendedProperties: {private:{aplydId:event.id,aplydOwner:OWNERSHIP}},
  };
}
export function fromGoogleEvent(event: GoogleEvent): CalendarEvent | null {
  const start = event.start?.date || event.start?.dateTime;
  const end = event.end?.date || event.end?.dateTime;
  if (event.status === 'cancelled' || !event.id || !start || !end) return null;
  return {id:`google:${event.id}`,title:event.summary || 'Busy',start,end,allDay:!!event.start?.date,category:'google',readOnly:true};
}

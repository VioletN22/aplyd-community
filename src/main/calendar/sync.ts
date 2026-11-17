import type { CalendarEvent } from '../../shared/calendar';
import { OWNERSHIP, toGoogleEvent, type GoogleEvent } from './mapping';
export interface CalendarSyncClient {
  listEvents(calendarId: string): Promise<GoogleEvent[]>;
  insertEvent(calendarId: string, event: GoogleEvent): Promise<void>;
  updateEvent(calendarId: string, id: string, event: GoogleEvent): Promise<void>;
  deleteEvent(calendarId: string, id: string): Promise<void>;
}
export async function syncOwnedEvents(client: CalendarSyncClient, calendarId: string, local: CalendarEvent[]): Promise<void> {
  const remote = (await client.listEvents(calendarId)).filter(event =>
    event.extendedProperties?.private?.aplydOwner === OWNERSHIP && event.extendedProperties.private.aplydId && event.id,
  );
  const wanted = new Map(local.filter(event => event.category !== 'google').map(event => [event.id,toGoogleEvent(event)]));
  const retained = new Set<string>();
  for (const [id,event] of wanted) {
    const existing = remote.find(row => row.extendedProperties!.private!.aplydId === id);
    if (existing) {
      retained.add(existing.id!);
      await client.updateEvent(calendarId,existing.id!,event);
    } else await client.insertEvent(calendarId,event);
  }
  // Only after every upsert succeeds: a partial run never sweeps unrelated data.
  for (const event of remote) {
    if (!wanted.has(event.extendedProperties!.private!.aplydId) || !retained.has(event.id!)) {
      await client.deleteEvent(calendarId,event.id!);
    }
  }
}

import { CALENDAR_ZONE } from '../../shared/calendar';
import type { GoogleEvent } from './mapping';
export interface CalendarListEntry { id: string; summary: string; accessRole?: string; primary?: boolean }
export class GoogleApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export class GoogleCalendarClient {
  constructor(private token: (forceRefresh: boolean) => Promise<string>, private fetcher: typeof fetch = fetch, private signal?: AbortSignal) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      this.signal?.throwIfAborted();
      const token = await this.token(attempt === 1);
      this.signal?.throwIfAborted();
      let response: Response;
      try {
        response = await this.fetcher(`https://www.googleapis.com/calendar/v3/${path}`, {
          ...init, headers: {Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
          signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        });
      } catch { throw new Error('Google Calendar could not be reached. Check your connection and retry.'); }
      this.signal?.throwIfAborted();
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) {
        const message = response.status === 401 ? 'Google access expired. Connect Calendar again.' :
          response.status === 403 ? 'Google Calendar permission was refused. Check the enabled API and consent scopes.' :
          response.status === 429 ? 'Google Calendar is busy. Sync will retry later.' : `Google Calendar request failed (${response.status}).`;
        throw new GoogleApiError(response.status,message);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    }
    throw new Error('Google access expired. Connect Calendar again.');
  }
  private async pages<T>(path: string, parameters: Record<string,string> = {}): Promise<T[]> {
    const items: T[] = [];
    let pageToken = '';
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({...parameters,...(pageToken ? {pageToken} : {})});
      const page = await this.request<{items?:T[];nextPageToken?:string}>(`${path}?${query}`);
      items.push(...(page.items || []));
      pageToken = page.nextPageToken || '';
      if (pageToken && seen.has(pageToken)) throw new Error('Google returned a repeated calendar page. Retry sync.');
      seen.add(pageToken);
    } while (pageToken);
    return items;
  }
  listCalendars(): Promise<CalendarListEntry[]> { return this.pages('users/me/calendarList'); }
  async createCalendar(): Promise<string> {
    const calendar = await this.request<{id:string}>('calendars',{method:'POST',body:JSON.stringify({summary:'Aplyd Community',timeZone:CALENDAR_ZONE})});
    return calendar.id;
  }
  listEvents(calendarId: string, range?: {timeMin:string;timeMax:string}): Promise<GoogleEvent[]> {
    return this.pages(`calendars/${encodeURIComponent(calendarId)}/events`,{
      maxResults:'2500',showDeleted:'false',...(range ? {...range,singleEvents:'true'} : {}),
    });
  }
  async insertEvent(calendarId: string, event: GoogleEvent): Promise<void> {
    const path = `calendars/${encodeURIComponent(calendarId)}/events`;
    try { await this.request(path,{method:'POST',body:JSON.stringify(event)}); }
    catch (error) {
      if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
      const existing = await this.request<GoogleEvent>(`${path}/${event.id}`);
      if (existing.extendedProperties?.private?.aplydId !== event.extendedProperties?.private?.aplydId ||
          existing.extendedProperties?.private?.aplydOwner !== 'aplyd-community') throw new Error('A calendar event ID is already in use. No event was replaced.');
      await this.updateEvent(calendarId,event.id!,event);
    }
  }
  async updateEvent(calendarId: string, id: string, event: GoogleEvent): Promise<void> {
    const {id: _id,...body} = event;
    await this.request(`calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});
  }
  async deleteEvent(calendarId: string, id: string): Promise<void> {
    try { await this.request(`calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,{method:'DELETE'}); }
    catch (error) { if (!(error instanceof GoogleApiError) || ![404,410].includes(error.status)) throw error; }
  }
}

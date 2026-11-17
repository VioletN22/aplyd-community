import { describe, expect, it } from 'vitest';
import { toGoogleEvent, fromGoogleEvent } from '../calendar/mapping';
import { syncOwnedEvents } from '../calendar/sync';
import type { CalendarEvent } from '../../shared/calendar';
const local: CalendarEvent = { id: 'task:a', title: 'Quiz', start: '2026-10-14', end: '2026-10-15', allDay: true, category: 'deadline' };

describe('Google event mapping and owned sync', () => {
  it('keeps a deterministic Google ID and exclusive all-day end date', () => {
    const mapped = toGoogleEvent(local);
    expect(mapped.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(toGoogleEvent({ ...local, title: 'Edited' }).id).toBe(mapped.id);
    expect(mapped).toMatchObject({ start: { date: '2026-10-14' }, end: { date: '2026-10-15' }, extendedProperties: { private: { aplydId: 'task:a' } } });
  });
  it('maps primary events as grey read-only, excluding cancelled events', () => {
    expect(fromGoogleEvent({ id: 'g', summary: 'Gym', start: { dateTime: '2026-10-14T10:00:00Z' }, end: { dateTime: '2026-10-14T11:00:00Z' } }))
      .toMatchObject({ id: 'google:g', category: 'google', readOnly: true });
    expect(fromGoogleEvent({ id: 'g', status: 'cancelled' })).toBe(null);
  });
  it('updates stable owned IDs and deletes gone sources without touching unowned events', async () => {
    const remote = [toGoogleEvent({ ...local, title: 'Old' }), { ...toGoogleEvent({ ...local, id: 'task:gone' }), id: 'gone' }, { id: 'personal', summary: 'Unowned' }];
    const updated: string[] = []; const deleted: string[] = []; const inserted: string[] = [];
    await syncOwnedEvents({
      listEvents: async () => remote,
      insertEvent: async (_calendar, event) => { inserted.push(event.id!); },
      updateEvent: async (_calendar, id) => { updated.push(id); },
      deleteEvent: async (_calendar, id) => { deleted.push(id); },
    }, 'aplyd', [local]);
    expect(updated).toEqual([toGoogleEvent(local).id]);
    expect(deleted).toEqual(['gone']); expect(inserted).toEqual([]);
  });
  it('does not delete old sources after an upsert failure', async () => {
    const deleted: string[] = [];
    await expect(syncOwnedEvents({
      listEvents: async () => [{ ...toGoogleEvent({ ...local, id: 'task:gone' }), id: 'gone' }],
      insertEvent: async () => { throw Error('Offline'); }, updateEvent: async () => {},
      deleteEvent: async (_calendar, id) => { deleted.push(id); },
    }, 'aplyd', [local])).rejects.toThrow('Offline');
    expect(deleted).toEqual([]);
  });
});
it('never mutates events belonging to the original private app', async () => {
  const mutations: string[] = [];
  const privateEvent = {...toGoogleEvent(local),id:'private-event',extendedProperties:{private:{aplydOwner:'aplyd',aplydId:local.id}}};
  await syncOwnedEvents({listEvents:async()=>[privateEvent],insertEvent:async()=>{mutations.push('insert');},updateEvent:async()=>{mutations.push('update');},deleteEvent:async()=>{mutations.push('delete');}},'community',[]);
  expect(mutations).toEqual([]);
});

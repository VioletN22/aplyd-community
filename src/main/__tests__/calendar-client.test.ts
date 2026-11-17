import { expect, it } from 'vitest';
import { GoogleCalendarClient } from '../calendar/client';
it('walks every remote page and retries a 401 once with refreshed token', async () => {
  const requests: {url:string;auth:string}[] = [];
  let refreshes = 0;
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const auth = (init?.headers as Record<string,string>).Authorization;
    requests.push({url:String(url),auth});
    if (auth === 'Bearer old') return new Response('{}', {status:401});
    return new Response(JSON.stringify(String(url).includes('pageToken=second') ? {items:[{id:'two'}]} : {items:[{id:'one'}],nextPageToken:'second'}), {status:200});
  };
  const client = new GoogleCalendarClient(async refresh => { if (refresh) refreshes++; return refreshes ? 'new' : 'old'; }, fakeFetch);
  expect(await client.listEvents('primary', {timeMin:'2026-10-12T00:00:00Z',timeMax:'2026-10-19T00:00:00Z'})).toHaveLength(2);
  expect(refreshes).toBe(1);
  expect(requests).toHaveLength(3);
  expect(requests[2].url).toContain('pageToken=second');
});
it('does not loop after a second unauthorized response', async () => {
  let attempts=0;
  const client=new GoogleCalendarClient(async()=> 'invalid',async()=>{attempts++;return new Response('{}',{status:401});});
  await expect(client.listCalendars()).rejects.toThrow(/expired/);
  expect(attempts).toBe(2);
});

import { syncOwnedEvents } from '../calendar/sync';
import { toGoogleEvent, type GoogleEvent } from '../calendar/mapping';
import type { CalendarEvent } from '../../shared/calendar';
it('restores a reopened task with its original owned ID after Google retains a cancelled event', async () => {
  const task: CalendarEvent={id:'task:reopen',title:'Task',start:'2026-10-12',end:'2026-10-13',allDay:true,category:'deadline'};
  let remote: GoogleEvent | null=null;
  const methods: string[]=[];
  const client=new GoogleCalendarClient(async()=> 'token',async(_url,init)=>{
    const method=init?.method || 'GET';
    methods.push(method);
    if(method==='DELETE') { remote={...remote!,status:'cancelled'}; return new Response(null,{status:204}); }
    if(method==='POST') {
      if(remote)return new Response('{}',{status:409});
      remote=JSON.parse(String(init?.body));
    }
    if(method==='PATCH')remote={...remote!,...JSON.parse(String(init?.body))};
    return new Response(JSON.stringify(String(_url).includes('?') ? {items:remote?.status==='confirmed'?[remote]:[]} : remote));
  });
  await syncOwnedEvents(client,'aplyd',[task]);
  await syncOwnedEvents(client,'aplyd',[]);
  expect(remote).toMatchObject({status:'cancelled'});
  await syncOwnedEvents(client,'aplyd',[task]);
  expect(remote).toMatchObject({id:toGoogleEvent(task).id,status:'confirmed'});
  expect(methods.slice(-3)).toEqual(['POST','GET','PATCH']);
});
it('refuses a deterministic ID collision without ownership evidence', async () => {
  let writes=0;
  const client=new GoogleCalendarClient(async()=> 'token',async(_url,init)=>{
    if(init?.method==='POST'){writes++;return new Response('{}',{status:409});}
    if(init?.method==='PATCH')writes++;
    return new Response(JSON.stringify({id:'collision',status:'cancelled'}));
  });
  await expect(client.insertEvent('aplyd',{id:'collision',extendedProperties:{private:{aplydId:'task:one',aplydOwner:'aplyd'}}})).rejects.toThrow(/No event was replaced/);
  expect(writes).toBe(1);
});

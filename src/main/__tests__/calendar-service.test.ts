import { beforeEach } from 'vitest';
import { configureCalendar } from '../../shared/calendar';
beforeEach(()=>configureCalendar({timeZone:'Australia/Sydney',recurring:[]}));
import { expect, it } from 'vitest';
import { CalendarService, zoneMidnight } from '../calendar/service';
it('uses Sydney midnight on both sides of daylight saving', () => {
  expect(zoneMidnight('2026-10-04')).toBe('2026-10-03T14:00:00.000Z');
  expect(zoneMidnight('2026-10-05')).toBe('2026-10-04T13:00:00.000Z');
});
it('reuses only its stored calendar and reads the requested primary week', async () => {
  const requests: string[]=[];
  const saved=new Map<string,string>([['calendar.id','already']]);
  const fetcher=async(url:string|URL|Request,init?:RequestInit)=>{
    requests.push(String(url));
    if(String(url).endsWith('/token'))return new Response(JSON.stringify({access_token:'access',expires_in:3600}));
    if(String(url).includes('calendarList'))return new Response(JSON.stringify({items:[{id:'already',summary:'Aplyd',accessRole:'owner'}]}));
    if(String(url).includes('/events'))return new Response(JSON.stringify({items:[]}));
    throw Error(`Unexpected request ${url} ${init?.method}`);
  };
  const service=new CalendarService(()=>[],{get:key=>saved.get(key)||null,set:(key,value)=>{saved.set(key,value);}},()=>{},async()=>{},
    {read:async()=>({clientId:'id',clientSecret:'secret',refreshToken:'refresh'}),write:async()=>{},clear:async()=>{}},fetcher);
  await service.sync();
  expect(saved.get('calendar.id')).toBe('already');
  await service.week('2026-10-12');
  const primary=requests.find(url=>url.includes('/primary/events'))!;
  expect(new URL(primary).searchParams.get('timeMin')).toBe('2026-10-11T13:00:00.000Z');
  expect(new URL(primary).searchParams.get('timeMax')).toBe('2026-10-18T13:00:00.000Z');
  expect((await service.getStatus()).lastSync).toBeTruthy();
});
it('does not restore credentials after disconnect during token refresh', async () => {
  let complete!: (value:Response)=>void;
  const writes: unknown[]=[];
  const service=new CalendarService(()=>[],{get:()=>null,set:()=>{}},()=>{},async()=>{},
    {read:async()=>({clientId:'id',clientSecret:'secret',refreshToken:'refresh'}),write:async value=>{writes.push(value);},clear:async()=>{}},
    async()=>new Promise(resolve=>{complete=resolve;}));
  const sync=service.sync();
  while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
  await service.disconnect();
  complete(new Response(JSON.stringify({access_token:'late',refresh_token:'late-refresh',expires_in:3600})));
  await sync;
  expect(writes).toHaveLength(0);
  expect((await service.getStatus()).connected).toBe(false);
});
it('discards primary events that arrive after disconnect', async () => {
  let complete!: (response:Response)=>void;
  const service=new CalendarService(()=>[],{get:()=>null,set:()=>{}},()=>{},async()=>{},
    {read:async()=>({clientId:'id',clientSecret:'secret',refreshToken:'refresh'}),write:async()=>{},clear:async()=>{}},
    async url=>String(url).endsWith('/token') ? new Response(JSON.stringify({access_token:'access',expires_in:3600})) : new Promise(resolve=>{complete=resolve;}));
  const week=service.week('2026-10-12');
  while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
  await service.disconnect();
  complete(new Response(JSON.stringify({items:[{id:'g',start:{date:'2026-10-12'},end:{date:'2026-10-13'}}]})));
  expect(await week).toEqual([]);
});

import { toGoogleEvent } from '../calendar/mapping';
import type { CalendarEvent } from '../../shared/calendar';
it.each([['list',true],['upsert',true],['delete',true],['list',false],['upsert',false],['delete',false]] as const)('cancels old sync during %s (disconnect first: %s)', async (phase, disconnectFirst) => {
  const event: CalendarEvent = {id:'task:a',title:'Task',start:'2026-10-12',end:'2026-10-13',allDay:true,category:'deadline'};
  const remote = [toGoogleEvent({...event,id:'gone:1'}),toGoogleEvent({...event,id:'gone:2'})];
  let release!: (response:Response)=>void;
  let pendingSignal: AbortSignal | null | undefined;
  let paused = false;
  let connected = false;
  const mutations: string[] = [];
  const fetcher: typeof fetch = async (url,init) => {
    const path=String(url);
    if(path.endsWith('/token'))return new Response(JSON.stringify({access_token: String(init?.body).includes('authorization_code')?'new-access':'old-access',refresh_token:'refresh',expires_in:3600}));
    if(path.endsWith('/calendars') && init?.method==='POST') return new Response(JSON.stringify({id:'community'}));
    if(path.includes('calendarList'))return new Response(JSON.stringify({items:[{id:'aplyd',summary:'Aplyd',accessRole:'owner'}]}));
    const method=init?.method || 'GET';
    if(method!=='GET')mutations.push(`${method}:${(init?.headers as Record<string,string>).Authorization}`);
    if(!paused && ((phase==='list' && method==='GET') || (phase==='upsert' && method==='POST') || (phase==='delete' && method==='DELETE'))) {
      paused=true;
      pendingSignal=init?.signal;
      return new Promise(resolve=>{release=resolve;});
    }
    return method==='DELETE' ? new Response(null,{status:204}) : new Response(JSON.stringify({items:remote}));
  };
  const service=new CalendarService(()=>[event,{...event,id:'task:b'}],{get:()=>null,set:()=>{}},()=>{},async authorization=>{
    const url=new URL(authorization);
    const callback=new URL(url.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state',url.searchParams.get('state')!);
    callback.searchParams.set('code','code');
    await fetch(callback);
  },{read:async()=>({clientId:'old',clientSecret:'secret',refreshToken:'refresh'}),write:async value=>{if(value.clientId==='new')connected=true;},clear:async()=>{}},fetcher);
  const oldSync=service.sync();
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  if (disconnectFirst) await service.disconnect();
  const count=mutations.length;
  const reconnect=service.connect({clientId:'new',clientSecret:'secret'});
  while(!connected)await new Promise(resolve=>setTimeout(resolve,0));
  expect(pendingSignal?.aborted).toBe(true);
  release(phase==='delete' ? new Response(null,{status:204}) : new Response(JSON.stringify({items:remote})));
  await oldSync;
  // The reconnect starts its own complete sync after the cancelled run settles.
  expect(mutations.slice(count).every(value=>value.endsWith('Bearer new-access'))).toBe(true);
  await reconnect;
  expect(mutations.filter(value=>value.endsWith('Bearer old-access'))).toHaveLength(count);
});

it('does not start calendar work when Keychain initialization finishes after stop', async () => {
  let finish!: (value:{clientId:string;clientSecret:string;refreshToken:string})=>void;
  let reads=0;
  let requests=0;
  const service=new CalendarService(()=>{reads++;return [];},{get:()=>null,set:()=>{}},()=>{},async()=>{},
    {read:()=>new Promise(resolve=>{finish=resolve;}),write:async()=>{},clear:async()=>{}},
    async()=>{requests++;return new Response('{}');});
  service.start();
  service.stop();
  finish({clientId:'id',clientSecret:'secret',refreshToken:'refresh'});
  await service.getStatus();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(reads).toBe(0);
  expect(requests).toBe(0);
});
it('creates a separate community calendar without adopting an unrelated same-name calendar', async () => {
  const saved = new Map<string,string>(); const paths: string[] = [];
  const service = new CalendarService(()=>[],{get:key=>saved.get(key)??null,set:(key,value)=>{saved.set(key,value);}},()=>{},async()=>{},
    {read:async()=>({clientId:'client',clientSecret:'secret',refreshToken:'refresh'}),write:async()=>{},clear:async()=>{}},
    async(url,init) => {
      const path = String(url); paths.push(path);
      if(path.endsWith('/token'))return new Response(JSON.stringify({access_token:'token',expires_in:3600}));
      if(path.includes('calendarList'))return new Response(JSON.stringify({items:[{id:'private',summary:'Aplyd',accessRole:'owner'},{id:'unrelated',summary:'Aplyd Community',accessRole:'owner'}]}));
      if(path.endsWith('/calendars') && init?.method==='POST') {
        expect(JSON.parse(String(init.body))).toEqual({summary:'Aplyd Community',timeZone:'Australia/Sydney'});
        return new Response(JSON.stringify({id:'new-community'}));
      }
      return new Response(JSON.stringify({items:[]}));
    });
  await service.sync();
  expect(saved.get('calendar.id')).toBe('new-community');
  expect(paths.some(path=>path.includes('/private/') || path.includes('/unrelated/'))).toBe(false);
});

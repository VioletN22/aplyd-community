import { beforeEach } from 'vitest';
import { configureCalendar, SYSTEM_CALENDAR_ZONE, zoneMidnight, zoneTime, validateCalendarPreferences } from '../calendar';
beforeEach(() => configureCalendar({timeZone:'Australia/Sydney',recurring:[]}));
import { describe, it, expect } from 'vitest';
import { buildCalendarEvents, dateKey, isStale, isTodo, rollOverdue, todoOrder, weekDates, type CalendarEvent } from '../calendar';

describe('calendar event mapping', () => {
  it('keeps only active interviews, stable source ids and explicit duration', () => {
    const applications = [
      {id:'a', company:'Acme', current_stage:'phone_screen', interview_at:'2026-10-15T03:00:00Z'},
      {id:'b', company:'B', current_stage:'interview', interview_at:'2026-10-15T04:00:00Z', interview_minutes:60},
      {id:'c', company:'C', current_stage:'rejected', interview_at:'2026-10-15T05:00:00Z'},
    ];
    const events = buildCalendarEvents({applications});
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({id:'interview:a', category:'interview', start:'2026-10-15T03:00:00.000Z', end:'2026-10-15T03:30:00.000Z', applicationId:'a'});
    expect(events[1].end).toBe('2026-10-15T05:00:00.000Z');
  });
  it('keeps date-only deadlines all-day and filters done, invalid and terminal-linked tasks', () => {
    const actionItems = [
      {id:'a', title:'Quiz', kind:'quiz', due_at:'2026-10-14', status:'open'},
      {id:'b', title:'Done', kind:'assessment', due_at:'2026-10-14', status:'done'},
      {id:'c', title:'Bad', kind:'reply', due_at:'oops', status:'open'},
      {id:'d', title:'Timed', kind:'take-home', due_at:'2026-10-14T09:09:00+11:00', status:'open'},
      {id:'e', title:'Rejected', kind:'quiz', due_at:'2026-10-14', status:'open', application_id:'rejected'},
    ];
    const events=buildCalendarEvents({actionItems, applications:[{id:'rejected',company:'R',current_stage:'rejected'}]});
    expect(events).toHaveLength(2);
    expect(events.find(e=>e.id==='task:a')).toMatchObject({allDay:true,start:'2026-10-14',end:'2026-10-15'});
    expect(events.find(e=>e.id==='task:d')).toMatchObject({allDay:false,start:'2026-10-13T22:09:00.000Z'});
  });
  it('draws a shift as a block from due_at to ends_at, and ignores an end before the start', () => {
    const actionItems = [
      {id:'s', title:'Example Retail shift', kind:'shift', due_at:'2026-11-01T21:00:00Z', ends_at:'2026-11-02T05:00:00Z', status:'open'},
      {id:'t', title:'Backwards', kind:'reply', due_at:'2026-11-01T21:00:00Z', ends_at:'2026-11-01T20:00:00Z', status:'open'},
    ];
    const events=buildCalendarEvents({actionItems});
    expect(events.find(e=>e.id==='task:s')).toMatchObject({category:'shift',start:'2026-11-01T21:00:00.000Z',end:'2026-11-02T05:00:00.000Z'});
    expect(events.find(e=>e.id==='task:t')).toMatchObject({category:'deadline',end:'2026-11-01T21:30:00.000Z'});
  });
  it('maps active lead followups and read-only Google events', () => {
    const own={id:'google:g',title:'Gym',start:'2026-10-14T06:00:00Z',end:'2026-10-14T07:00:00Z',allDay:false,category:'google' as const,readOnly:true};
    expect(buildCalendarEvents({leads:[{id:'l',org:'Club',stage:'call',next_due_at:'2026-10-14T03:00:00Z'},{id:'x',org:'X',stage:'lost',next_due_at:'2026-10-14'}],googleEvents:[own]})).toEqual([
      expect.objectContaining({id:'lead:l',category:'outreach',leadId:'l'}),own,
    ]);
  });
  it('uses Sydney day and calendar arithmetic over the daylight saving boundary', () => {
    expect(dateKey(new Date('2026-10-03T15:30:00Z'))).toBe('2026-10-04');
    expect(weekDates('2026-10-04',7)).toEqual(['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
    expect(weekDates('2026-10-05',5)).toEqual(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09']);
  });
});

import { layoutTimedEvents } from '../calendar';
it('separates overlapping long and short events into stable columns', () => {
  const event=(id:string,start:string,end:string)=>({id,title:id,start,end,allDay:false,category:'interview' as const});
  const result=layoutTimedEvents([
    event('a','2026-10-15T03:00:00Z','2026-10-15T05:00:00Z'),
    event('b','2026-10-15T03:30:00Z','2026-10-15T04:00:00Z'),
    event('c','2026-10-15T04:00:00Z','2026-10-15T04:30:00Z'),
  ]);
  expect(result.map(r=>[r.event.id,r.column,r.columns])).toEqual([['a',0,2],['b',1,2],['c',1,2]]);
});

import { dailyTimedSegments } from '../calendar';
it('clips a Sunday event into Monday and retains its source/read-only attributes', () => {
  const event={id:'google:overnight',title:'Travel',start:'2026-10-11T23:00:00+11:00',end:'2026-10-12T09:00:00+11:00',allDay:false,category:'google' as const,readOnly:true};
  const [segment]=dailyTimedSegments([event],'2026-10-12');
  expect(segment).toMatchObject({id:event.id,readOnly:true,start:'2026-10-11T13:00:00.000Z',end:'2026-10-11T22:00:00.000Z',startMinute:0,endMinute:540});
  expect(dailyTimedSegments([event],'2026-10-13')).toEqual([]);
});
it('clips an overnight source on both days and uses Sydney civil minutes across DST', () => {
  const event={id:'task:overnight',title:'Work',start:'2026-10-03T23:00:00+10:00',end:'2026-10-04T09:00:00+11:00',allDay:false,category:'deadline' as const,actionItemId:'task'};
  expect(dailyTimedSegments([event],'2026-10-03')[0]).toMatchObject({startMinute:1380,endMinute:1440,actionItemId:'task'});
  const segment=dailyTimedSegments([event],'2026-10-04')[0];
  expect(segment).toMatchObject({startMinute:0,endMinute:540,start:'2026-10-03T14:00:00.000Z',end:'2026-10-03T22:00:00.000Z'});
  expect(dailyTimedSegments([{...event,end:'2026-10-04T00:00:00+10:00'}],'2026-10-04')).toEqual([]);
});

import { recurringEvents, compactTitle } from '../calendar';
describe('recurring classes and compact labels', () => {



  it('shows an interview once when a task records the same meeting', () => {
    const events = buildCalendarEvents({
      applications: [{id: 'g', company: 'Example Shop', current_stage: 'interview', interview_at: '2026-10-22T01:00:00Z'}],
      actionItems: [
        {id: 't1', title: 'Example Shop · onsite interview', kind: 'interview', due_at: '2026-10-22T01:00:00Z', status: 'open', application_id: 'g'},
        {id: 't2', title: 'Example Shop · send thank-you', kind: 'reply', due_at: '2026-10-23T01:00:00Z', status: 'open', application_id: 'g'},
      ],
    });
    expect(events.map(e => e.id)).toEqual(['interview:g', 'task:t2']);
  });
  it('shortens agent sentences to their subject but keeps short titles whole', () => {
    expect(compactTitle('Example meeting · Review one follow-up on 19 October only if no reply or suppression; Alex must approve sending.')).toBe('Example meeting');
    expect(compactTitle('Acme · Interview')).toBe('Acme · Interview');
    expect(compactTitle('Vandelay quiz 1 due. Complete before the 09:09 cutoff or the attempt is void')).toBe('Vandelay quiz 1 due');
  });
  it('flags the carried-over half of a midnight-crossing segment', () => {
    const event={id:'task:x',title:'Example meeting',start:'2026-10-19T23:40:00+11:00',end:'2026-10-20T00:10:00+11:00',allDay:false,category:'deadline' as const};
    expect(dailyTimedSegments([event],'2026-10-19')[0]).toMatchObject({startMinute:1420,endMinute:1440,continues:false});
    expect(dailyTimedSegments([event],'2026-10-20')[0]).toMatchObject({startMinute:0,endMinute:10,continues:true});
  });
});

import { groupOutreachFollowUps } from '../calendar';
describe('groupOutreachFollowUps', () => {
  const lead = (id: string, day: string) => ({id: `lead:${id}`, title: id, category: 'outreach' as const, allDay: true, start: day, end: '2026-10-26', leadId: id});
  it('folds three or more outreach follow-ups on one day into one event, and leaves a pair alone', () => {
    const out = groupOutreachFollowUps([lead('a', '2026-10-25'), lead('b', '2026-10-25'), lead('c', '2026-10-25'), lead('d', '2026-10-27'), lead('e', '2026-10-27')]);
    expect(out.map(e => [e.id, e.title])).toEqual([
      ['outreach-group:2026-10-25', '3 lead follow-ups'],
      ['lead:d', 'd'],
      ['lead:e', 'e'],
    ]);
  });
  it('keeps to-dos apart from things that happen at a set time', () => {
    const events = buildCalendarEvents({ actionItems: [
      {id: 'a', title: 'Example Company cover letter', kind: 'apply', due_at: '2026-11-02', status: 'open'},
      {id: 'b', title: 'Call recruiter', kind: 'follow_up', due_at: '2026-11-02T01:00:00Z', status: 'open'},
      {id: 'c', title: 'Example Retail', kind: 'shift', due_at: '2026-11-01T21:00:00Z', ends_at: '2026-11-02T05:00:00Z', status: 'open'},
      {id: 'd', title: 'Example Company call', kind: 'phone_screen', due_at: '2026-11-02T03:00:00Z', status: 'open'},
    ]});
    expect(Object.fromEntries(events.map(e => [e.id, isTodo(e)]))).toEqual({'task:a': true, 'task:b': true, 'task:c': false, 'task:d': false});
    expect(events.find(e => e.id === 'task:d')?.category).toBe('interview');
  });
  it('carries missed to-dos onto today and leaves events where they happened', () => {
    const ev = (id: string, category: 'deadline' | 'shift', start: string, allDay = false): CalendarEvent => ({ id, title: id, category, start, end: start, allDay });
    const rolled = rollOverdue([
      ev('missed', 'deadline', '2026-10-30T05:00:00Z'),
      ev('ancient', 'deadline', '2026-10-07', true),
      ev('tomorrow', 'deadline', '2026-11-02', true),
      ev('pastShift', 'shift', '2026-10-31T21:00:00Z'),
    ], '2026-11-01');
    const by = Object.fromEntries(rolled.map(e => [e.id, e]));
    expect(by.missed).toMatchObject({ start: '2026-11-01', end: '2026-11-02', allDay: true, overdueFrom: '2026-10-30' });
    expect(by.ancient.overdueFrom).toBe('2026-10-07');
    expect(by.tomorrow.overdueFrom).toBeUndefined();
    expect(by.pastShift.start).toBe('2026-10-31T21:00:00Z');
    expect(isStale(by.ancient, '2026-11-01')).toBe(true);
    expect(isStale(by.missed, '2026-11-01')).toBe(false);
    expect([by.tomorrow, by.missed, by.ancient].sort(todoOrder).map(e => e.id)).toEqual(['ancient', 'missed', 'tomorrow']);
  });
});

import { recurringEvents as recurringEventsUntil, buildCalendarEvents as buildEventsForShifts } from '../calendar';
describe('5 Nov 2026 fixes', () => {
  it('a shift stays on the grid once its application is an accepted offer', () => {
    const events = buildEventsForShifts({
      applications: [{ id: 'employer', company: 'Example Employer', current_stage: 'offer' }],
      actionItems: [{ id: 's1', title: 'Example Employer 9-5', kind: 'shift', status: 'open', due_at: '2026-11-15T22:00:00Z', ends_at: '2026-11-16T06:00:00Z', application_id: 'employer' },
        { id: 't1', title: 'Call recruiter', kind: 'reply', status: 'open', due_at: '2026-11-15T22:00:00Z', application_id: 'employer' }],
    });
    expect(events.map((e) => e.id)).toEqual(['task:s1']);
  });

});

describe('user-configured recurring commitments', () => {
  const commitment = {weekday:1,title:'Weekly study',slug:'study',startHour:15,endHour:16,until:'2026-11-30',skip:['2026-11-09']};
  it('starts without any schedule', () => {
    configureCalendar({timeZone:SYSTEM_CALENDAR_ZONE,recurring:[]});
    expect(recurringEvents(weekDates('2026-11-02',7))).toEqual([]);
  });
  it('expands only the supplied commitments, honoring last day and skipped days', () => {
    const events = recurringEvents(['2026-11-02','2026-11-09','2026-12-07'],[commitment],'America/New_York');
    expect(events).toEqual([{id:'study:2026-11-02',title:'Weekly study',category:'class',allDay:false,readOnly:true,start:'2026-11-02T20:00:00.000Z',end:'2026-11-02T21:00:00.000Z'}]);
  });
  it('follows explicit IANA zones over northern and southern DST transitions', () => {
    expect(zoneMidnight('2026-03-08','America/New_York')).toBe('2026-03-08T05:00:00.000Z');
    expect(zoneMidnight('2026-03-09','America/New_York')).toBe('2026-03-09T04:00:00.000Z');
    expect(zoneTime('2026-10-04',9,'Australia/Sydney')).toBe('2026-10-03T22:00:00.000Z');
    expect(dateKey(new Date('2026-11-02T02:00:00Z'),'America/Los_Angeles')).toBe('2026-11-01');
    expect(dateKey(new Date('2026-11-02T02:00:00Z'),'Asia/Tokyo')).toBe('2026-11-02');
  });
  it('validates timezone, dates, unique IDs and bounded recurring hours', () => {
    const valid = {timeZone:'Europe/London',recurring:[commitment]};
    expect(validateCalendarPreferences(valid)).toEqual(valid);
    expect(()=>validateCalendarPreferences({...valid,timeZone:'Mars/City'})).toThrow();
    for (const update of [{endHour:14},{weekday:7},{until:'2026-02-31'},{skip:['bad']}]) {
      expect(()=>validateCalendarPreferences({...valid,recurring:[{...commitment,...update}]})).toThrow();
    }
    expect(()=>validateCalendarPreferences({...valid,recurring:[commitment,commitment]})).toThrow();
    expect(()=>zoneMidnight('2026-02-31')).toThrow();
  });
});

it('resolves repeated and nonexistent wall-clock hours deterministically', () => {
  expect(zoneTime('2026-03-08',2.5,'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
  expect(zoneTime('2026-11-01',1.5,'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
});

it('does not emit a backwards recurring interval when a DST gap consumes it', () => {
  expect(recurringEvents(['2026-03-08'],[{weekday:0,title:'Study',slug:'study',startHour:2.5,endHour:3}],'America/New_York')).toEqual([]);
});

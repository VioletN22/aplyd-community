import type {CalendarStatus} from '../../shared/google-calendar';
import React,{useState,useEffect,useCallback} from 'react';
import {addDays,compactTitle,dailyTimedSegments,layoutTimedEvents,recurringEvents,CALENDAR_ZONE,dateKey,weekDates,type CalendarEvent,type CalendarDaySegment} from '../../shared/calendar';
import {EventPopover} from './EventPopover';
import { displayLocale } from '../../shared/locale';
interface Props {events:CalendarEvent[];onOpen:(event:CalendarEvent)=>void}
export function WeekCalendar({events,onOpen}:Props) {
  const [day,setDay]=useState(()=>dateKey());
  const [days,setDays]=useState(7);
  const [picked,setPicked]=useState<{event:CalendarEvent;anchor:DOMRect}|null>(null);
  const pick=(event:CalendarEvent)=>(e:React.MouseEvent<HTMLElement>)=>setPicked({event,anchor:e.currentTarget.getBoundingClientRect()});
  const close=useCallback(()=>setPicked(null),[]);
  const dates=weekDates(day,days);
  const [googleEvents,setGoogleEvents]=useState<CalendarEvent[]>([]);
  const [status,setStatus]=useState<CalendarStatus|null>(null);
  const [error,setError]=useState('');
  const weekStart=dates[0];
  useEffect(()=>{
    let active=true;
    let sequence=0;
    const load=async()=>{
      const request=++sequence;
      const state=await window.electronAPI.calendar.status();
      if(!active||request!==sequence)return;
      if(state.ok&&state.data)setStatus(state.data);
      const result=await window.electronAPI.calendar.week(weekStart);
      if(!active||request!==sequence)return;
      if(result.ok){setGoogleEvents(result.data||[]);setError('');}
      else{setGoogleEvents([]);setError(result.error||'Could not read Google Calendar.');}
    };
    setGoogleEvents([]);
    void load();
    const off=window.electronAPI.calendar.onChanged(()=>void load());
    return()=>{active=false;off();};
  },[weekStart]);
  const allEvents=[...events,...googleEvents,...recurringEvents(dates)];
  const clock=(value:string)=>new Date(value).toLocaleTimeString(displayLocale(),{timeZone:CALENDAR_ZONE,hour:'numeric',minute:'2-digit'});
  return <section className="week-calendar" aria-label="Weekly calendar">
    <div className="cockpit-heading"><h2>This week</h2><div className="calendar-controls">
      <button aria-label="Previous week" onClick={()=>setDay(addDays(day,-7))}>‹</button>
      <button onClick={()=>setDay(dateKey())}>Today</button>
      <button aria-label="Next week" onClick={()=>setDay(addDays(day,7))}>›</button>
      <button onClick={()=>setDays(days===5?7:5)}>{days===5?'Show weekend':'Weekdays only'}</button>
    </div></div>
    <p className="calendar-status">{dates[0]} to {dates[dates.length-1]} · {CALENDAR_ZONE} · {error||status?.error||(status?.syncing?'Syncing Google Calendar…':status?.connected?(status.lastSync?'Synced to Google Calendar':'Google Calendar connected'):'Google Calendar not connected')}</p>
    <div className="week-scroll"><div className="week-grid" style={{gridTemplateColumns:`42px repeat(${days},minmax(64px,1fr))`}}>
      <div className="calendar-day-label" />
      {dates.map(d=><div className={`calendar-day-label ${d===dateKey()?'is-today':''} ${new Date(`${d}T12:00:00Z`).getUTCDay()%6===0?'is-weekend':''}`} key={d}>{new Date(`${d}T12:00:00Z`).toLocaleDateString(displayLocale(),{timeZone:'UTC',weekday:'short'})}<strong>{Number(d.slice(-2))}</strong></div>)}
      <span className="calendar-all-label">all day</span>
      {dates.map(d=><div className="calendar-all" key={d}>{allEvents.filter(e=>e.allDay&&e.start<=d&&e.end>d).map(e=><button className={`calendar-event ${e.category}`} key={e.id} onClick={pick(e)} title={e.title}>{compactTitle(e.title)}</button>)}</div>)}
      <div className="calendar-hours">{Array.from({length:17},(_,h)=><span style={{top:h*44}} key={h}>{h+7>12?`${h-5}pm`:`${h+7}${h+7===12?'pm':'am'}`}</span>)}</div>
      {dates.map(d=>{
        const timed=dailyTimedSegments(allEvents,d);
        // Each day's agenda remains readable even when several events share a time.
        // A segment carried over midnight from the day before is not a second event; it is skipped.
        const own=timed.filter(e=>!e.continues||e.endMinute>60);
        // The grid runs 7am to midnight; anything earlier lands in the strip at the top.
        const outside=own.filter(e=>e.startMinute<420||e.startMinute>=1440);
        const inside=own.filter(e=>e.endMinute>420&&e.startMinute<1440);
        const weekend=new Date(`${d}T12:00:00Z`).getUTCDay()%6===0;
        return <div className={`calendar-day ${weekend?'is-weekend':''}`} key={d}>{layoutTimedEvents(inside).map(({event:e,column,columns})=>{
          const width=100/columns;
          const height=Math.max(22,(Math.min(1440,e.endMinute)-Math.max(420,e.startMinute))*44/60);
          const label=compactTitle(e.title);
          return <button key={e.id} title={`${clock(e.start)} · ${e.title}`} className={`calendar-event timed ${e.category} ${height<40?'is-short':''}`}
            style={{top:(Math.max(420,e.startMinute)-420)*44/60,left:`${column*width}%`,width:`calc(${width}% - 3px)`,height}} onClick={pick(e)}>
            {height>=40&&<strong>{e.continues?'↑':clock(e.start)}</strong>}<span>{label}</span>
          </button>;
        })}{outside.length>0&&<div className="calendar-outside">{outside.map((e:CalendarDaySegment)=><button key={e.id} className={`calendar-event ${e.category}`} title={`${clock(e.start)} · ${e.title}`} onClick={pick(e)}><strong>{clock(e.start)}</strong><span>{compactTitle(e.title)}</span></button>)}</div>}</div>;
      })}
    </div></div>
    <div className="calendar-legend"><span className="interview">● Interview / call</span><span className="deadline">● Deadline</span><span className="outreach">● Outreach</span><span className="class">● Commitment</span><span>● Google</span></div>
    {picked&&<EventPopover event={picked.event} anchor={picked.anchor} onOpen={onOpen} onClose={close}/>}
  </section>;
}

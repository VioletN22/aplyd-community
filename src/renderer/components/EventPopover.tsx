import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {CALENDAR_ZONE,type CalendarEvent} from '../../shared/calendar';
import { displayLocale } from '../../shared/locale';
interface Props {event:CalendarEvent;anchor:DOMRect;onOpen:(event:CalendarEvent)=>void;onClose:()=>void}
const LABEL:Record<CalendarEvent['category'],string>={interview:'Interview / call',deadline:'Deadline',shift:'Shift',outreach:'Outreach',google:'Google Calendar',class:'Commitment'};
/** One event, in full, next to the chip that was clicked. Escape or a click elsewhere closes it. */
export function EventPopover({event,anchor,onOpen,onClose}:Props) {
  const ref=useRef<HTMLDivElement>(null);
  const [pos,setPos]=useState({top:anchor.bottom+6,left:anchor.left});
  useLayoutEffect(()=>{
    const box=ref.current?.getBoundingClientRect(); if(!box)return;
    const left=Math.max(8,Math.min(anchor.left,window.innerWidth-box.width-8));
    const below=anchor.bottom+6; const top=below+box.height>window.innerHeight-8?Math.max(8,anchor.top-box.height-6):below;
    setPos({top,left});
  },[anchor]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    const down=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))onClose();};
    document.addEventListener('keydown',key);document.addEventListener('mousedown',down);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('mousedown',down);};
  },[onClose]);
  useEffect(()=>{ref.current?.focus();},[]);
  const when=()=>{
    if(event.allDay){const d=new Date(`${event.start}T12:00:00Z`);return d.toLocaleDateString(displayLocale(),{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'})+' · all day';}
    const s=new Date(event.start),e=new Date(event.end);
    const day=s.toLocaleDateString(displayLocale(),{timeZone:CALENDAR_ZONE,weekday:'long',day:'numeric',month:'long'});
    const t=(d:Date)=>d.toLocaleTimeString(displayLocale(),{timeZone:CALENDAR_ZONE,hour:'numeric',minute:'2-digit'});
    return `${day} · ${t(s)} to ${t(e)}`;
  };
  const action=event.applicationId?'Open application':event.leadId?'Open lead':event.id.startsWith('outreach-group:')?'Open outreach':event.actionItemId?'Show task':null;
  return <div ref={ref} tabIndex={-1} role="dialog" aria-label={event.title} className={`event-popover ${event.category}`} style={{top:pos.top,left:pos.left}}>
    <div className="event-popover-head"><span className={`cockpit-chip ${event.category}`}>{LABEL[event.category]}</span><button aria-label="Close" onClick={onClose}><X size={12}/></button></div>
    <h3>{event.title}</h3>
    <p className="event-popover-when">{when()}</p>
    {(action||event.url)&&<div className="event-popover-actions">
      {action&&<button className="btn" onClick={()=>{onOpen(event);onClose();}}>{action}</button>}
      {event.url&&<a className="btn" href={event.url} target="_blank" rel="noreferrer">Open link</a>}
    </div>}
  </div>;
}

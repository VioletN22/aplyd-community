import type {LeadSegmentNumbers} from './leads';
import type {Approval} from './approvals';
import type { CalendarEvent } from './calendar';
import {addDays,dateKey} from './calendar';
import type {TodayActionItem,JobApplication} from './types';
export interface AgentRun {id:string;agent:string;started_at:string;ended_at:string|null;summary:string|null;details_json:string|null}
export interface CockpitData {
  events:CalendarEvent[]; actions:TodayActionItem[]; doneToday:number;
  applications:Pick<JobApplication,'id'|'company'|'job_title'|'current_stage'|'application_deadline'|'interview_at'>[];
  yesterday:{applied:number;jobReplies:number;outreachSent:number;outreachReplies:number};
  lastRun:AgentRun|null;
  approvals: Approval[];
  leadSegments: LeadSegmentNumbers[];
}
export function yesterdayNumbers(apps:{created_at:string}[],emails:{application_id:string|null;kind:string;status:string;sent_at:string}[],now=new Date()) {
  const day=addDays(dateKey(now),-1);
  const onDay=(value:string)=>Number.isFinite(Date.parse(value))&&dateKey(new Date(value))===day;
  return {applied:apps.filter(a=>onDay(a.created_at)).length,
    jobReplies:new Set(emails.filter(e=>e.application_id&&e.status==='applied'&&['rejection','assessment','interview','offer'].includes(e.kind)&&onDay(e.sent_at)).map(e=>e.application_id)).size,
    outreachSent:0,outreachReplies:0};
}

import {listLeads} from './leads';
import {leadSegmentNumbers} from '../shared/leads';
import {addDays} from '../shared/calendar';
import {listApprovals} from './approvals';
import type { MigrationDb } from './database';
import type {CockpitData,AgentRun} from '../shared/cockpit';
import {yesterdayNumbers} from '../shared/cockpit';
import {buildCalendarEvents,dateKey} from '../shared/calendar';
import {listOpenActionItems,toTodayActionItems} from './action-items';
export function getCockpit(db:MigrationDb,now=new Date()):CockpitData {
  const applications=db.prepare('SELECT id,company,job_title,current_stage,application_deadline,interview_at,interview_minutes,created_at FROM applications').all();
  const actions=toTodayActionItems(listOpenActionItems(db));
  const day=dateKey(now);
  const leads = listLeads(db);
  const leadEvents = db.prepare('SELECT * FROM lead_events').all();
  const yesterday = yesterdayNumbers(applications,db.prepare('SELECT application_id,kind,status,sent_at FROM email_events').all(),now);
  const yesterdayEvents = leadEvents.filter(event => Number.isFinite(Date.parse(event.at)) && dateKey(new Date(event.at)) === addDays(day,-1));
  yesterday.outreachSent = yesterdayEvents.filter(event => event.kind === 'email_sent').length;
  yesterday.outreachReplies = new Set(yesterdayEvents.filter(event => event.kind === 'reply').map(event => event.lead_id)).size;
  const doneToday=db.prepare("SELECT done_at FROM action_items WHERE status='done' AND done_at IS NOT NULL").all().filter(r=>Number.isFinite(Date.parse(r.done_at))&&dateKey(new Date(r.done_at))===day).length;
  return {applications,actions,doneToday, leadSegments: leadSegmentNumbers(leads,leadEvents),
    approvals: listApprovals(db).filter(a => a.status === 'pending'),
    events:buildCalendarEvents({applications,leads,actionItems:actions.map(t=>({id:t.id,title:t.title,kind:t.kind,status:'open',due_at:t.dueAt,ends_at:t.endsAt,application_id:t.applicationId,url:t.url}))}),
    yesterday,
    lastRun:(db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 1').get() as AgentRun|undefined)??null};
}

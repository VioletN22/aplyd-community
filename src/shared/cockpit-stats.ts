import { addDays, CALENDAR_ZONE, dateKey, zoneMidnight } from './calendar';
import { LEAD_SEGMENTS, SEGMENT_LABELS } from './leads';
import { ROLE_FAMILIES, roleFamily } from './role-family';

export interface ReviewPeriod { start: string; end: string; timeZone?: string }
export function defaultReviewPeriod(asOf = new Date().toISOString(), timeZone = CALENDAR_ZONE): ReviewPeriod {
  const end = dateKey(new Date(asOf), timeZone);
  return {start:addDays(end,-13),end,timeZone};
}
export const REVIEW_ROLES = [
  { key: 'support', label: 'Support / service desk' },
  { key: 'qa', label: 'QA / test' },
  { key: 'data_ba', label: 'Data / business analyst' },
  { key: 'ecommerce', label: 'Ecommerce' },
  ...ROLE_FAMILIES,
];
const PROGRESS_KINDS = new Set(['assessment', 'take_home', 'assessed', 'phone_screen', 'interview', 'offer']);
const RESPONSE_KINDS = new Set(['rejection', 'rejected', ...PROGRESS_KINDS]);
const LEAD_REPLY_STAGES = new Set(['replied', 'call', 'proposal', 'won']);
export interface StatsApplication { id: string; job_title: string; created_at: string; applied_at?: string | null }
export interface JobSignal { application_id: string; at: string; kind: string }
export interface StatsLead { id: string; segment: string }
export interface StatsLeadEvent { lead_id: string; kind: string; at: string; detail?: string | null }
export interface StatsApproval { id: string; lead_id: string | null; created_at: string; status: string; sent_at?: string | null; send_evidence?: string | null }
export interface StatsInput {
  applications: StatsApplication[];
  jobSignals: JobSignal[];
  leads: StatsLead[];
  leadEvents: StatsLeadEvent[];
  approvals: StatsApproval[];
}
export interface ResponseCount {
  total: number; replies: number; rate: number | null;
  /** Jobs only: reached an assessment, screen, interview or offer. */
  progressed?: number; progressRate?: number | null;
  /** Jobs only: answered with a rejection and never progressed. */
  rejected?: number; rejectRate?: number | null;
}
export interface ReviewRow { key: string; label: string; before: ResponseCount; current: ResponseCount }
export interface OutreachStatsRow {
  key: string; label: string; drafted: number; sent: number; replies: number; calls: number; won: number; rate: number | null;
}
export interface CockpitStats {
  asOf: string;
  period: ReviewPeriod;
  inProgress: boolean;
  fallbackApplications: number;
  outreach: OutreachStatsRow[];
  review: { jobs: ReviewRow[]; outreach: ReviewRow[] };
}
export function reviewRole(title: string): string {
  if (/\b(e[ -]?commerce|shopify|online merchandis\w*)\b/i.test(title)) return 'ecommerce';
  if (/\b(qa|quality assurance|quality engineer|test(er|ing)?|test automation)\b/i.test(title)) return 'qa';
  if (/\b((data|business|bi|reporting) analyst|business analysis|analytics|business intelligence)\b/i.test(title)) return 'data_ba';
  if (/\b(application support|product support|it support|technical support|desktop support|help ?desk|service desk|support (engineer|analyst|specialist|technician))\b/i.test(title)) return 'support';
  return roleFamily(title);
}
function time(value: string | null | undefined, timeZone = CALENDAR_ZONE): number {
  if (!value) return NaN;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(zoneMidnight(value, timeZone)) : Date.parse(value);
}
function responseCount(ids: Set<string>, replies: Set<string>, progress?: Set<string>): ResponseCount {
  const count = [...ids].filter(id => replies.has(id)).length;
  const result: ResponseCount = { total: ids.size, replies: count, rate: ids.size ? count / ids.size : null };
  if (!progress) return result;
  const progressed = [...ids].filter(id => progress.has(id)).length;
  const rejected = count - [...ids].filter(id => replies.has(id) && progress.has(id)).length;
  return {
    ...result, progressed, rejected,
    progressRate: ids.size ? progressed / ids.size : null,
    rejectRate: ids.size ? rejected / ids.size : null,
  };
}
function targetStage(event: StatsLeadEvent): string {
  if (event.kind !== 'stage') return '';
  return event.detail?.split('→').pop()?.trim() || '';
}
/** Cohorts and outcomes use recorded timestamps; repeats never inflate response rates. */
export function computeCockpitStats(input: StatsInput, asOf = new Date().toISOString(), period: ReviewPeriod = defaultReviewPeriod(asOf)): CockpitStats {
  if (!period || typeof period.start !== 'string' || typeof period.end !== 'string' || period.start > period.end) throw new Error('Choose a valid review date range.');
  const zone = period.timeZone || CALENDAR_ZONE;
  // Validate both civil dates and the zone before any statistics are computed.
  zoneMidnight(period.start, zone); zoneMidnight(period.end, zone);
  const toTime = (value: string | null | undefined) => time(value, zone);
  const now = toTime(asOf);
  const start = toTime(period.start);
  const until = toTime(addDays(period.end, 1));
  const cutoff = Math.min(now + 1, until);
  const applied = new Map(input.applications.map(app => [app.id, toTime(app.applied_at || app.created_at)]));
  const jobReplies = (end: number, kinds = RESPONSE_KINDS) => new Set(input.jobSignals.filter(signal =>
    kinds.has(signal.kind) && toTime(signal.at) >= (applied.get(signal.application_id) ?? Infinity) && toTime(signal.at) < end,
  ).map(signal => signal.application_id));
  const beforeJobReplies = jobReplies(Math.min(start, cutoff));
  const currentJobReplies = jobReplies(cutoff);
  const beforeJobProgress = jobReplies(Math.min(start, cutoff), PROGRESS_KINDS);
  const currentJobProgress = jobReplies(cutoff, PROGRESS_KINDS);
  const jobRows = REVIEW_ROLES.map(role => {
    const group = input.applications.filter(app => reviewRole(app.job_title) === role.key);
    const before = new Set(group.filter(app => applied.get(app.id)! < Math.min(start, cutoff)).map(app => app.id));
    const current = new Set(group.filter(app => applied.get(app.id)! >= start && applied.get(app.id)! < cutoff).map(app => app.id));
    return { ...role, before: responseCount(before, beforeJobReplies, beforeJobProgress), current: responseCount(current, currentJobReplies, currentJobProgress) };
  });
  const events = [...input.leadEvents, ...input.approvals.filter(draft =>
    draft.lead_id && draft.status === 'sent' && draft.sent_at && draft.send_evidence?.trim(),
  ).map(draft => ({ lead_id: draft.lead_id!, kind: 'email_sent', at: draft.sent_at! }))];
  const firstSend = new Map<string, number>();
  for (const event of events) {
    const at = toTime(event.at);
    if (event.kind === 'email_sent' && Number.isFinite(at)) firstSend.set(event.lead_id, Math.min(firstSend.get(event.lead_id) ?? Infinity, at));
  }
  const leadSignals = (kind: 'reply' | 'call' | 'won', end: number, afterSend = false) => new Set(events.filter(event => {
    const stage = targetStage(event);
    const matches = event.kind === kind || (kind === 'reply' ? LEAD_REPLY_STAGES.has(stage) : stage === kind);
    return matches && toTime(event.at) < end && (!afterSend || toTime(event.at) >= (firstSend.get(event.lead_id) ?? Infinity));
  }).map(event => event.lead_id));
  const beforeLeadReplies = leadSignals('reply', Math.min(start, cutoff), true);
  const currentLeadReplies = leadSignals('reply', cutoff, true);
  const allReplies = leadSignals('reply', now + 1);
  const contactedReplies = leadSignals('reply', now + 1, true);
  const allCalls = leadSignals('call', now + 1);
  const allWon = leadSignals('won', now + 1);
  const outreach: OutreachStatsRow[] = [];
  const outreachReview = LEAD_SEGMENTS.map(key => {
    const ids = new Set(input.leads.filter(lead => lead.segment === key).map(lead => lead.id));
    const sent = new Set([...ids].filter(id => (firstSend.get(id) ?? Infinity) <= now));
    const before = new Set([...ids].filter(id => (firstSend.get(id) ?? Infinity) < Math.min(start, cutoff)));
    const current = new Set([...ids].filter(id => (firstSend.get(id) ?? Infinity) >= start && (firstSend.get(id) ?? Infinity) < cutoff));
    const total = responseCount(sent, contactedReplies);
    outreach.push({
      key, label: SEGMENT_LABELS[key],
      drafted: new Set(input.approvals.filter(draft => draft.lead_id && ids.has(draft.lead_id) && toTime(draft.created_at) <= now).map(draft => draft.id)).size,
      sent: total.total, replies: [...ids].filter(id => allReplies.has(id)).length, rate: total.rate,
      calls: [...ids].filter(id => allCalls.has(id)).length,
      won: [...ids].filter(id => allWon.has(id)).length,
    });
    return { key, label: SEGMENT_LABELS[key], before: responseCount(before, beforeLeadReplies), current: responseCount(current, currentLeadReplies) };
  });
  return {
    asOf: dateKey(new Date(now), zone), period: {...period,timeZone:zone}, inProgress: now < until,
    fallbackApplications: input.applications.filter(app => !app.applied_at && toTime(app.created_at) < cutoff).length,
    outreach, review: { jobs: jobRows, outreach: outreachReview },
  };
}

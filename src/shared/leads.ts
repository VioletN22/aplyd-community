import { addDays, zoneMidnight } from './calendar';

export const LEAD_STAGES = ['prospect', 'contacted', 'replied', 'call', 'proposal', 'won', 'lost'] as const;
/** What each stage means, for the leads legend and the stage tag's tooltip. */
export const LEAD_STAGE_HELP: Record<(typeof LEAD_STAGES)[number], string> = {
  prospect: 'Researched, never emailed',
  contacted: 'Emailed, waiting on a reply',
  replied: 'They wrote back',
  call: 'Call booked or held',
  proposal: 'Proposal sent',
  won: 'Signed',
  lost: 'Said no or went cold',
};
export const LEAD_SEGMENTS = ['group_a', 'group_b', 'group_c', 'group_d'] as const;
export type LeadSegment = (typeof LEAD_SEGMENTS)[number];
export const SEGMENT_LABELS: Record<string, string> = { group_a: 'Group A', group_b: 'Group B', group_c: 'Group C', group_d: 'Group D' };
/**
 * Older stored names for the same four groups, in the same order. Databases are
 * converted on start; imports and saves still accept them.
 */
export const LEGACY_SEGMENTS: Record<string, LeadSegment> = { clubs: 'group_a', local: 'group_b', ai: 'group_c', '3d': 'group_d' };

/** The segment values an import accepts, in words, for error messages and docs. */
export const ACCEPTED_SEGMENT_VALUES = 'Group A, Group B, Group C, Group D, or the letters A to D';

/**
 * The segment key for what a person typed in a CSV, or null. Accepts the label
 * the app shows ("Group A"), the bare letter ("A"), the stored key ("group_a")
 * and the older stored names ("clubs"), in any case.
 */
export function segmentFromInput(raw: string | null | undefined): LeadSegment | null {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!text) return null;
  if (LEGACY_SEGMENTS[text]) return LEGACY_SEGMENTS[text];
  for (const key of LEAD_SEGMENTS) {
    const label = SEGMENT_LABELS[key].toLowerCase();
    const letter = label.replace(/^group /, '');
    if (text === key || text === label || text === letter) return key;
  }
  return null;
}
export interface Lead {
  id: string;
  org: string;
  segment: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_channel: string | null;
  website: string | null;
  demo_url: string | null;
  stage: string;
  next_step: string | null;
  next_due_at: string | null;
  value_estimate: number | null;
  notes: string | null;
  do_not_contact: number;
  conflict_flag: number;
  source: string | null;
  created_at: string;
  updated_at: string;
}
export interface LeadEvent { id: string; lead_id: string; kind: string; detail: string | null; at: string }
export interface LeadDetail { lead: Lead; events: LeadEvent[] }

export function validateLead(lead: Pick<Lead, 'org' | 'stage' | 'segment'>): void {
  if (!lead.org.trim()) throw new Error('Organisation is required.');
  if (!(LEAD_STAGES as readonly string[]).includes(lead.stage)) throw new Error('Choose a valid lead stage.');
  if (!(LEAD_SEGMENTS as readonly string[]).includes(lead.segment)) throw new Error('Choose a valid segment.');
}

export function hasIndustryConflict(text: string, terms: readonly string[] = []): boolean {
  const normalized = text.toLocaleLowerCase();
  return terms.some(term => term.trim() && normalized.includes(term.trim().toLocaleLowerCase()));
}

/** null means approval may proceed; the caller displays a concrete refusal otherwise. */
export function canApproveForLead(lead: Pick<Lead, 'do_not_contact' | 'conflict_flag' | 'segment'>): string | null {
  if (lead.do_not_contact) return 'This lead is marked do not contact.';
  if (lead.conflict_flag) return 'Outreach is blocked because you marked this lead as a conflict.';
  return null;
}

export interface LeadSegmentNumbers { segment: string; sent: number; replies: number; calls: number }
export function leadSegmentNumbers(leads: Lead[], events: LeadEvent[]): LeadSegmentNumbers[] {
  return LEAD_SEGMENTS.map(segment => {
    const ids = new Set(leads.filter(lead => lead.segment === segment).map(lead => lead.id));
    const count = (kind: string) => new Set(events.filter(event => event.kind === kind && ids.has(event.lead_id)).map(event => event.lead_id)).size;
    return { segment, sent: count('email_sent'), replies: count('reply'), calls: count('call') };
  });
}

/** The Due cell: contacted leads show their follow-up date, and an overdue one says so. */
export function leadDueState(lead: Pick<Lead, 'stage' | 'next_due_at'>, now: Date = new Date()): 'overdue' | 'due' | null {
  if (lead.stage !== 'contacted' || !lead.next_due_at) return null;
  // A date-only due means "by the end of that day" in the configured calendar
  // zone: overdue once the next day begins there. A timestamp is absolute.
  const due = /^\d{4}-\d{2}-\d{2}$/.test(lead.next_due_at)
    ? new Date(Date.parse(zoneMidnight(addDays(lead.next_due_at, 1))) - 1)
    : new Date(lead.next_due_at);
  if (!Number.isFinite(due.getTime())) return 'due';
  return due.getTime() < now.getTime() ? 'overdue' : 'due';
}

export type ApprovalStatus = 'pending' | 'approved' | 'skipped' | 'sent' | 'failed';
export const APPROVAL_KINDS = ['outreach_email', 'outreach_followup', 'platform_bid', 'reply'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
/** Older names for the outreach kinds. Databases are converted on start; these still read correctly. */
export const LEGACY_APPROVAL_KINDS: Record<string, ApprovalKind> = { purpl_email: 'outreach_email', purpl_followup: 'outreach_followup' };
/** The current kind for a stored or supplied value, or the value unchanged when it is not a known older name. */
export function approvalKind(raw: string): string {
  return LEGACY_APPROVAL_KINDS[raw] ?? raw;
}
export interface Approval {
  id: string;
  kind: ApprovalKind;
  application_id: string | null;
  lead_id: string | null;
  channel: string;
  from_account: string | null;
  to_address: string | null;
  subject: string | null;
  body: string;
  thread_hint: string | null;
  status: ApprovalStatus;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  sent_at: string | null;
  send_evidence: string | null;
  error: string | null;
}
export interface ApprovalDecision {
  status: 'approved' | 'skipped';
  to_address?: string;
  subject?: string;
  body?: string;
  expectedBody?: string;
  expected?: ApprovalSnapshot;
}

/** Decisions stop at approval. Only an agent may record a send and its evidence. */
export function decideApproval(current: Approval, decision: ApprovalDecision, at: string): Approval {
  if (current.status !== 'pending') throw new Error('This draft is no longer pending. Refresh to see its latest status.');
  if (decision.expectedBody !== undefined && decision.expectedBody !== current.body) {
    throw new Error('This draft changed since you reviewed it. Refresh before deciding.');
  }
  if (decision.expected && APPROVAL_SEND_FIELDS.some(field => decision.expected![field] !== current[field])) {
    throw new Error('This draft changed since you reviewed it. Refresh before deciding.');
  }
  if (!['approved', 'skipped'].includes(decision.status)) throw new Error('Choose Approve or Skip.');
  const next = {
    ...current,
    to_address: decision.to_address ?? current.to_address,
    subject: decision.subject ?? current.subject,
    body: decision.body ?? current.body,
    status: decision.status,
    decided_at: at,
  };
  if (next.status === 'approved' && !next.body.trim()) throw new Error('The draft body cannot be empty.');
  return next;
}

export const APPROVAL_SEND_FIELDS = [
  'kind', 'application_id', 'lead_id', 'channel', 'from_account',
  'to_address', 'subject', 'body', 'thread_hint',
] as const;
export type ApprovalSnapshot = Pick<Approval, typeof APPROVAL_SEND_FIELDS[number]>;
export interface ReviewedApproval { id: string; expected: ApprovalSnapshot }

export function approvalSnapshot(approval: Approval): ApprovalSnapshot {
  return Object.fromEntries(APPROVAL_SEND_FIELDS.map(field => [field, approval[field]])) as unknown as ApprovalSnapshot;
}

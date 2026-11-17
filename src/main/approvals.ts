import {canApproveForLead, type Lead} from '../shared/leads';
import type { MigrationDb } from './database';
import { approvalKind, decideApproval, APPROVAL_SEND_FIELDS, type Approval, type ApprovalDecision, type ReviewedApproval } from '../shared/approvals';

export function listApprovals(db: MigrationDb, filter?: { applicationId?: string; leadId?: string }): Approval[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter?.applicationId) { where.push('application_id = ?'); params.push(filter.applicationId); }
  if (filter?.leadId) { where.push('lead_id = ?'); params.push(filter.leadId); }
  const rows = db.prepare(`SELECT * FROM approvals ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id`).all(...params) as Approval[];
  // A draft written later under an older kind name still reads as its current kind.
  return rows.map(row => ({ ...row, kind: approvalKind(row.kind) as Approval['kind'] }));
}

export function decideStoredApproval(db: MigrationDb, id: string, decision: ApprovalDecision, now = new Date()): Approval {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = decideStoredApprovalLocked(db, id, decision, now);
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function decideStoredApprovalLocked(db: MigrationDb, id: string, decision: ApprovalDecision, now = new Date()): Approval {
  const stored = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Approval | undefined;
  if (!stored) throw new Error('Draft not found.');
  const current: Approval = { ...stored, kind: approvalKind(stored.kind) as Approval['kind'] };
  const expected = decision.expected && { ...decision.expected, kind: approvalKind(decision.expected.kind) as Approval['kind'] };
  const next = decideApproval(current, { ...decision, expected }, now.toISOString());
  if (next.status === 'approved' && current.lead_id) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(current.lead_id) as Lead | undefined;
    if (!lead) throw new Error('The linked lead no longer exists.');
    const refusal = canApproveForLead(lead);
    if (refusal) throw new Error(refusal);
  }
  if (!decision.expected) throw new Error('Refresh and review this draft before deciding.');
  const unchanged = APPROVAL_SEND_FIELDS.map(field => `${field} IS ?`).join(' AND ');
  const result = db.prepare(`UPDATE approvals SET kind = ?, to_address = ?, subject = ?, body = ?, status = ?, decided_at = ?
    WHERE id = ? AND status = 'pending' AND ${unchanged}`).run(
      next.kind, next.to_address, next.subject, next.body, next.status, next.decided_at, id,
      ...APPROVAL_SEND_FIELDS.map(field => stored[field]),
    );
  if (Number(result.changes) !== 1) throw new Error('This draft is no longer pending. Refresh to see its latest status.');
  return next;
}

export function approveAll(db: MigrationDb, reviewed: ReviewedApproval[]): number {
  if (!Array.isArray(reviewed)) throw new Error('Refresh and review the drafts before approving.');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of reviewed) decideStoredApprovalLocked(db, row.id, { status: 'approved', expected: row.expected });
    db.exec('COMMIT');
    return reviewed.length;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

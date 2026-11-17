import { describe, expect, it } from 'vitest';
import { decideApproval, approvalSnapshot, type Approval } from '../approvals';

const draft: Approval = {
  id: 'draft', kind: 'reply', channel: 'email', application_id: 'app', lead_id: null,
  from_account: 'me@example.com', to_address: 'you@example.com', subject: 'Thanks',
  body: 'Thank you for your time.', thread_hint: 'thread', status: 'pending',
  created_by: 'codex', created_at: '2026-10-13T00:00:00Z', decided_at: null,
  sent_at: null, send_evidence: null, error: null,
};
const now = '2026-10-13T01:00:00Z';

describe('approval decisions', () => {
  it('approves an edited pending draft and records its decision time', () => {
    expect(decideApproval(draft, { status: 'approved', body: 'Updated reply', subject: 'Updated', to_address: 'new@example.com' }, now))
      .toMatchObject({ status: 'approved', body: 'Updated reply', subject: 'Updated', to_address: 'new@example.com', decided_at: now, send_evidence: null });
    expect(draft.body).toBe('Thank you for your time.');
  });

  it('skips a pending draft without sending it', () => {
    expect(decideApproval(draft, { status: 'skipped' }, now))
      .toMatchObject({ status: 'skipped', sent_at: null, send_evidence: null });
  });

  it.each(['approved', 'skipped', 'sent', 'failed'] as const)('refuses a second decision on %s', status => {
    expect(() => decideApproval({ ...draft, status }, { status: 'approved' }, now)).toThrow(/no longer pending/);
  });

  it('refuses to approve content changed since it was reviewed', () => {
    expect(() => decideApproval(draft, { status: 'approved', expectedBody: 'Old body' }, now)).toThrow(/changed/);
  });

  it.each(['to_address', 'subject', 'channel', 'from_account', 'thread_hint'] as const)('rejects an unseen change to %s', field => {
    const reviewed = approvalSnapshot(draft);
    expect(() => decideApproval({ ...draft, [field]: 'changed' }, { status: 'approved', expected: reviewed }, now))
      .toThrow(/changed/);
  });

  it('refuses an empty approved body and preserves the original', () => {
    expect(() => decideApproval(draft, { status: 'approved', body: '  ' }, now)).toThrow(/body/);
    expect(draft.status).toBe('pending');
  });
});

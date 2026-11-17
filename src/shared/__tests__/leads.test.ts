import { describe, expect, it } from 'vitest';
import { canApproveForLead, hasIndustryConflict, validateLead, type Lead } from '../leads';

const lead = { org: 'Club', segment: 'group_a', stage: 'prospect', do_not_contact: 0, conflict_flag: 0 } as Lead;
describe('lead rules', () => {
  it('accepts only known stages and segments', () => {
    expect(() => validateLead(lead)).not.toThrow();
    expect(() => validateLead({ ...lead, stage: 'invented' })).toThrow(/stage/);
    expect(() => validateLead({ ...lead, segment: 'other' })).toThrow(/segment/);
  });
  it('blocks suppressed contacts and explicitly flagged conflicts in every segment', () => {
    expect(canApproveForLead({ ...lead, do_not_contact: 1 })).toMatch(/contact/);
    expect(canApproveForLead({ ...lead, segment: 'group_d', conflict_flag: 1 })).toMatch(/conflict/);
    expect(canApproveForLead({ ...lead, segment: 'group_b', conflict_flag: 1 })).toMatch(/conflict/);
  });
  it('does not inherit an employer conflict policy; configured terms are literal', () => {
    expect(hasIndustryConflict('Garage storage and racking')).toBe(false);
    expect(hasIndustryConflict('Acme Labs', ['acme'])).toBe(true);
    expect(hasIndustryConflict('Anything', ['.*', ''])).toBe(false);
  });
});

import { leadSegmentNumbers } from '../leads';
it('counts each contacted lead once per segment even after multiple sends', () => {
  const leads = [{ ...lead, id: 'a' }, { ...lead, id: 'b', segment: 'group_d' }];
  const events = [
    { id: '1', lead_id: 'a', kind: 'email_sent', detail: null, at: '2026-10-01' },
    { id: '2', lead_id: 'a', kind: 'email_sent', detail: null, at: '2026-10-02' },
    { id: '3', lead_id: 'b', kind: 'reply', detail: null, at: '2026-10-02' },
  ];
  expect(leadSegmentNumbers(leads, events).find(row => row.segment === 'group_a')).toMatchObject({ sent: 1, replies: 0, calls: 0 });
});

import { LEAD_STAGES, LEAD_STAGE_HELP, leadDueState } from '../leads';
describe('leads page clarity', () => {
  it('explains every stage', () => {
    for (const stage of LEAD_STAGES) expect(LEAD_STAGE_HELP[stage]).toBeTruthy();
    expect(LEAD_STAGE_HELP.prospect).toMatch(/never emailed/);
    expect(LEAD_STAGE_HELP.contacted).toMatch(/waiting on a reply/);
  });
  it('shows a due state only for contacted leads with a date', () => {
    const now = new Date('2026-10-20T12:00:00+11:00');
    expect(leadDueState({ stage: 'contacted', next_due_at: '2026-10-25T09:00:00+11:00' }, now)).toBe('due');
    expect(leadDueState({ stage: 'contacted', next_due_at: '2026-10-06' }, now)).toBe('overdue');
    expect(leadDueState({ stage: 'contacted', next_due_at: '2026-10-20' }, now)).toBe('due');
    expect(leadDueState({ stage: 'contacted', next_due_at: null }, now)).toBe(null);
    expect(leadDueState({ stage: 'prospect', next_due_at: '2026-10-06' }, now)).toBe(null);
  });
});

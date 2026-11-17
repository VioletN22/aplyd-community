import { describe, it, expect } from 'vitest';
import { computeNeedsYou, shortWhen, type NeedsYouApp } from '../needsYou';
import type { TodayActionItem } from '../../../shared/types';
import { setDisplayLocale } from '../../../shared/locale';

// Pin a day-first locale so the formatted dates below do not depend on the
// machine running the tests.
setDisplayLocale('en-AU');

const NOW = Date.parse('2026-10-06T11:00:00Z'); // Tue 6 Oct, 10 pm Sydney
const H = 60 * 60 * 1000;
const iso = (h: number) => new Date(NOW + h * H).toISOString();

const app = (o: Partial<NeedsYouApp> & { id: string }): NeedsYouApp => ({
  company: o.id.toUpperCase(), job_title: 'Role', current_stage: 'applied', interview_at: null, application_deadline: null, ...o,
});
const item = (o: Partial<TodayActionItem> & { id: string }): TodayActionItem => ({
  applicationId: null, kind: 'reply', title: `Item ${o.id}`, detail: null, company: null, role: null, groupLabel: null,
  dueAt: null, priority: 'normal', url: null, emailUrl: null, ...o,
});

describe('computeNeedsYou: assessments', () => {
  it('counts assessment-stage applications plus open assessment items, once per application', () => {
    const n = computeNeedsYou(
      [
        app({ id: 'a', current_stage: 'assessment' }),
        app({ id: 'b', current_stage: 'take_home', application_deadline: iso(48) }),
        app({ id: 'c', current_stage: 'assessed' }), // done: not to do
        app({ id: 'pra', company: 'PRA' }),           // applied, but has an assessment item
      ],
      [
        item({ id: 'i1', kind: 'assessment', applicationId: 'pra', company: 'PRA', dueAt: iso(20) }),
        item({ id: 'i2', kind: 'assessment', applicationId: 'b', dueAt: iso(30) }), // same app as b: merged, earlier due wins
        item({ id: 'i3', kind: 'assessment', title: 'Unlinked test' }),             // no application: its own entry
        item({ id: 'i4', kind: 'verify', applicationId: 'a' }),                     // not an assessment
      ],
      NOW,
    );
    expect(n.assessments.map((e) => e.key)).toEqual(['pra', 'b', 'a', 'item:i3']);
    expect(n.assessments[0]).toEqual({ key: 'pra', applicationId: 'pra', label: 'PRA', due: NOW + 20 * H });
    expect(n.assessments[1].due).toBe(NOW + 30 * H);
    expect(n.assessments[3]).toMatchObject({ applicationId: null, label: 'Unlinked test' });
  });

  it('keeps an overdue assessment: it is still to do', () => {
    const n = computeNeedsYou([], [item({ id: 'x', kind: 'assessment', dueAt: iso(-5) })], NOW);
    expect(n.assessments).toHaveLength(1);
  });
});

describe('computeNeedsYou: deadlines in the next 7 days', () => {
  it('merges application deadlines and dated items of any kind, deduped by application', () => {
    const n = computeNeedsYou(
      [
        app({ id: 'a', application_deadline: iso(24) }),
        app({ id: 'b', application_deadline: '2026-10-09' }),           // bare date: end of that day
        app({ id: 'old', application_deadline: iso(-2) }),              // passed
        app({ id: 'far', application_deadline: iso(8 * 24) }),          // outside the week
        app({ id: 'junk', application_deadline: '4 weeks after posting date' }),
      ],
      [
        item({ id: 'i1', kind: 'assessment', applicationId: 'a', dueAt: iso(10) }), // same app: one entry, sooner due
        item({ id: 'i2', kind: 'apply', title: 'Portals', dueAt: iso(5) }),
        item({ id: 'i3', kind: 'reply', applicationId: 'c' }),                       // undated: not a deadline
      ],
      NOW,
    );
    expect(n.deadlines.map((e) => e.key)).toEqual(['item:i2', 'a', 'b']);
    expect(n.deadlines[1].due).toBe(NOW + 10 * H);
  });
});

describe('computeNeedsYou: interviews', () => {
  it('counts interview-stage rows and lists future interviews soonest first', () => {
    const n = computeNeedsYou(
      [
        app({ id: 'office', company: 'Stark Labs', current_stage: 'interview', interview_at: '2026-10-12T04:10:00Z' }),
        app({ id: 'retail', company: 'Zenith Retail', current_stage: 'interview', interview_at: '2026-10-06T22:00:00Z' }),
        app({ id: 't212', company: 'Pied Piper', current_stage: 'interview', interview_at: '2026-10-07T14:00:00Z' }),
        app({ id: 'past', current_stage: 'rejected', interview_at: '2026-09-30T09:30' }),
      ],
      [],
      NOW,
    );
    expect(n.interviews).toBe(3);
    expect(n.upcoming.map((u) => u.company)).toEqual(['Zenith Retail', 'Pied Piper', 'Stark Labs']);
  });
});

describe('shortWhen', () => {
  it('reads in Sydney time, weekday only within the week', () => {
    expect(shortWhen(Date.parse('2026-10-06T22:00:00Z'), NOW, 'Australia/Sydney')).toBe('Wed 9:00 am');
    expect(shortWhen(Date.parse('2026-10-07T14:00:00Z'), NOW, 'Australia/Sydney')).toBe('Thu 1:00 am');
    expect(shortWhen(Date.parse('2026-10-12T04:10:00Z'), NOW, 'Australia/Sydney')).toBe('Mon 3:10 pm');
    expect(shortWhen(Date.parse('2026-10-20T04:10:00Z'), NOW, 'Australia/Sydney')).toBe('Tue 20 Oct 3:10 pm');
    expect(shortWhen(NaN, NOW, 'Australia/Sydney')).toBe('');
  });
});

it('displays a time in the explicitly selected zone', () => {
  expect(shortWhen(Date.parse('2026-10-06T22:00:00Z'), NOW, 'UTC')).toBe('Tue 10:00 pm');
});

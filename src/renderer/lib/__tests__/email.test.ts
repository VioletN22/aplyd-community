import { describe, expect, it } from 'vitest';
import type { EmailEvent } from '../../../shared/types';
import {
  cleanAppPassword, looksLikeAppPassword, looksLikeEmail, timeAgo, stageChange, plural, syncSummary, waitingLine,
} from '../email';
import { setDisplayLocale } from '../../../shared/locale';

// Counts are grouped the display locale's way; pin it so the machine's locale does not matter.
setDisplayLocale('en-AU');

const ev = (over: Partial<EmailEvent> = {}): EmailEvent => ({
  id: 'e1', email: 'a@gmail.com', messageId: 'm1', fromAddress: 'no-reply@greenhouse.io',
  subject: 'Your application', sentAt: '2026-09-01T00:00:00Z', applicationId: 'app1',
  company: 'Acme', role: 'Engineer', kind: 'rejection', confidence: 0.7, evidence: 'not progressing',
  fromStage: 'applied', proposedStage: 'rejected', status: 'applied', candidates: [], ...over,
});

describe('app password', () => {
  it('strips the spaces Google shows', () => {
    expect(cleanAppPassword('abcd efgh ijkl mnop')).toBe('abcdefghijklmnop');
    expect(cleanAppPassword(' abcd efgh\tijkl mnop\n')).toBe('abcdefghijklmnop');
  });
  it('accepts 16 letters with or without spaces', () => {
    expect(looksLikeAppPassword('abcd efgh ijkl mnop')).toBe(true);
    expect(looksLikeAppPassword('abcdefghijklmnop')).toBe(true);
    expect(looksLikeAppPassword('abcd efgh')).toBe(false);
  });
  it('checks the address shape', () => {
    expect(looksLikeEmail('jobs@example.com')).toBe(true);
    expect(looksLikeEmail('exampleuser')).toBe(false);
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-09-24T12:00:00Z').getTime();
  it('reads naturally', () => {
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-09-24T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-09-24T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-09-24T11:00:00Z', now)).toBe('1 hour ago');
    expect(timeAgo('2026-09-22T12:00:00Z', now)).toBe('2 days ago');
  });
});

describe('stageChange (the "changed stage to X" note)', () => {
  it('is the move an applied event made', () => {
    expect(stageChange(ev())).toEqual({ from: 'applied', to: 'rejected' });
  });
  it('is null for a log or note, the same stage, or an event that did not apply', () => {
    expect(stageChange(ev({ proposedStage: null }))).toBeNull();
    expect(stageChange(ev({ fromStage: 'interview', proposedStage: 'interview' }))).toBeNull();
    expect(stageChange(ev({ status: 'ignored' }))).toBeNull();
    expect(stageChange(ev({ status: 'pending' }))).toBeNull();
  });
});

describe('plural', () => {
  it('formats counts', () => {
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(1240, 'email')).toBe('1,240 emails');
  });
});

describe('sync summary and waiting emails', () => {
  it('says what a finished sync did, including emails still waiting to be read', () => {
    expect(syncSummary({ seen: 11, autoApplied: 0, pendingCount: 0 })).toBe('Done. 11 emails checked.');
    expect(syncSummary({ seen: 1240, autoApplied: 3, pendingCount: 0 })).toBe('Done. 1,240 emails checked, 3 updated.');
    expect(syncSummary({ seen: 11, autoApplied: 0, pendingCount: 4 })).toBe('Done. 11 emails checked, 4 waiting to be read.');
  });
  it('names a waiting email by its likely application when there is one', () => {
    expect(waitingLine(ev({ status: 'pending', applicationId: null, company: null, candidates: [{ applicationId: 'a', company: 'Laravel', role: 'Enterprise Success Engineer' }] })))
      .toBe('Probably Laravel, Enterprise Success Engineer');
    expect(waitingLine(ev({ status: 'pending', applicationId: null, company: null, candidates: [] }))).toBe('');
  });
});

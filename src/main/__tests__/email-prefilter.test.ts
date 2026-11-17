import { describe, it, expect } from 'vitest';
import { prefilter, isAtsSender, domainOf, isOwnAddress, normaliseAddresses } from '../email/prefilter';

describe('email prefilter', () => {
  it('passes known ATS and job board senders', () => {
    for (const from of [
      'noreply@myworkdayjobs.com', 'atlassian@wd3.myworkday.com', 'no-reply@us.greenhouse-mail.io',
      'no-reply@hire.lever.co', 'jobs@smartrecruiters.com', 'no-reply@ashbyhq.com',
      'noreply@candidates.workablemail.com', 'x@successfactors.eu', 'donotreply@pageuppeople.com',
      'hello@livehire.com', 'apply@jobadder.com', 'noreply@seek.com.au', 'donotreply@indeed.com',
      'jobs-noreply@linkedin.com',
    ]) {
      expect(prefilter({ fromAddress: from, subject: 'Hello' }), from).toEqual({ candidate: true, reason: 'ats' });
    }
  });

  it('matches domain tokens, not substrings of unrelated words', () => {
    expect(isAtsSender('team@clever.com')).toBe(false);
    expect(isAtsSender('me@example.com')).toBe(false);
    expect(isAtsSender('')).toBe(false);
  });

  it('only counts LinkedIn job mailboxes as a sender match', () => {
    expect(isAtsSender('messages-noreply@linkedin.com')).toBe(false);
    expect(isAtsSender('jobs-noreply@linkedin.com')).toBe(true);
  });

  it('passes subject keywords from any sender', () => {
    for (const subject of [
      'Your application to Canva', 'Thanks for applying', 'We received your application',
      'Interview invitation', 'Unfortunately...', 'Update: not progressing', 'You will not be progressing',
      'Next steps', 'Online assessment', 'Offer of employment', 'Your candidacy', 'Your submission',
      'You applied for Data Analyst',
    ]) {
      expect(prefilter({ fromAddress: 'talent@acme.com', subject }).candidate, subject).toBe(true);
    }
  });

  it('drops job alerts and newsletters, even from job boards', () => {
    for (const subject of [
      'Jobs you may be interested in', 'Your job alert for analyst', '5 recommended jobs', '12 new jobs for you',
      'Weekly digest', 'Your weekly summary', 'Acme is hiring',
    ]) {
      expect(prefilter({ fromAddress: 'noreply@seek.com.au', subject }), subject).toEqual({ candidate: false, reason: 'noise' });
    }
  });

  it('ignores everything else', () => {
    expect(prefilter({ fromAddress: 'mum@gmail.com', subject: 'Dinner Sunday?' })).toEqual({ candidate: false, reason: 'none' });
  });

  it('returns a reason code, never message content', () => {
    const v = prefilter({ fromAddress: 'x@acme.com', subject: 'Interview with Acme on Tuesday' });
    expect(Object.keys(v).sort()).toEqual(['candidate', 'reason']);
    expect(['ats', 'keyword', 'noise', 'none']).toContain(v.reason);
  });

  it('domainOf lowercases the part after the last @', () => {
    expect(domainOf('A@B@Example.COM')).toBe('example.com');
    expect(domainOf('nobody')).toBe('');
  });
});

describe('the user own sent mail', () => {
  const own = ['you@gmail.com', 'you.work@outlook.com'];
  it('is never a candidate, however job-like the subject', () => {
    expect(prefilter({ fromAddress: 'you@gmail.com', subject: 'Re: Team Fit Interview' }, own)).toEqual({ candidate: false, reason: 'own' });
    expect(prefilter({ fromAddress: ' You.Work@Outlook.com ', subject: 'Re: your application' }, own)).toEqual({ candidate: false, reason: 'own' });
  });
  it('only matches the exact address', () => {
    expect(isOwnAddress('tyou@gmail.com', own)).toBe(false);
    expect(isOwnAddress('', own)).toBe(false);
    expect(prefilter({ fromAddress: 'careers@canva.com', subject: 'Interview invitation' }, own).candidate).toBe(true);
  });
  it('without a list, nothing is own mail', () => {
    expect(prefilter({ fromAddress: 'you@gmail.com', subject: 'Interview' }).candidate).toBe(true);
  });
  it('normaliseAddresses lowercases, trims, dedupes and drops non-addresses', () => {
    expect(normaliseAddresses(['A@x.com', ' a@x.com', '', null, 'nope', 'b@y.io'])).toEqual(['a@x.com', 'b@y.io']);
  });

  it('keeps a job board application update even when the role holds a newsletter word', () => {
    expect(prefilter({ fromAddress: 'noreply@s.seek.com.au', fromName: 'SEEK Applications', subject: 'Application update for Weekly Payroll Officer at Acme' }))
      .toEqual({ candidate: true, reason: 'ats' });
    expect(prefilter({ fromAddress: 'noreply@s.seek.com.au', fromName: 'SEEK Applications', subject: 'Digest Media has responded to your application for Editor' }).candidate)
      .toBe(true);
    // Still noise when it is not an application update.
    expect(prefilter({ fromAddress: 'noreply@s.seek.com.au', subject: 'Your weekly digest of new jobs' }).candidate).toBe(false);
  });
});

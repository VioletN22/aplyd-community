import { describe, it, expect } from 'vitest';
import { normaliseCompany, rankCandidates, plausibleApps, companyFromSender, findCompanyMatch, type AppLite } from '../email/match';
import { parseJobBoardSubject } from '../email/prefilter';

const app = (id: string, company: string, job_title = 'Software Engineer', created_at = '2026-07-01T00:00:00Z', current_stage = 'applied'): AppLite =>
  ({ id, company, job_title, created_at, current_stage });

describe('normaliseCompany', () => {
  it('strips legal suffixes, filler words, punctuation and case', () => {
    expect(normaliseCompany('Acme Pty Ltd')).toBe('acme');
    expect(normaliseCompany('ACME Group Pty. Ltd.')).toBe('acme');
    expect(normaliseCompany('Acme Australia Limited')).toBe('acme');
    expect(normaliseCompany('Commonwealth Bank of Australia')).toBe('commonwealth bank of');
    expect(normaliseCompany('Ernst & Young')).toBe('ernst and young');
  });
});

describe('rankCandidates', () => {
  const apps = [
    app('a1', 'Canva Pty Ltd', 'Frontend Engineer'),
    app('a2', 'Atlassian', 'Graduate Developer'),
    app('a3', 'Atlassian', 'Data Analyst'),
    app('a4', 'Ing', 'Analyst'),
  ];

  it('matches the sender domain', () => {
    const r = rankCandidates({ fromAddress: 'careers@canva.com', fromName: '', subject: 'Thanks', body: '' }, apps);
    expect(r[0].app.id).toBe('a1');
  });

  it('matches the company inside an ATS subdomain', () => {
    const r = rankCandidates({ fromAddress: 'noreply@canva.wd3.myworkdayjobs.com', fromName: 'Workday', subject: 'Update', body: '' }, apps);
    expect(r.map((x) => x.app.id)).toEqual(['a1']);
  });

  it('matches the display name and subject, and uses the role to break ties', () => {
    const r = rankCandidates({
      fromAddress: 'no-reply@us.greenhouse-mail.io', fromName: 'Atlassian Recruiting',
      subject: 'Your application for Data Analyst at Atlassian', body: '',
    }, apps);
    expect(r[0].app.id).toBe('a3');
    expect(r[1].app.id).toBe('a2');
  });

  it('matches the body (first 2000 chars only)', () => {
    const r = rankCandidates({ fromAddress: 'x@smartrecruiters.com', fromName: '', subject: 'Update', body: 'Thank you for applying to Canva.' }, apps);
    expect(r[0].app.id).toBe('a1');
    const late = rankCandidates({ fromAddress: 'x@smartrecruiters.com', fromName: '', subject: 'Update', body: 'x'.repeat(2100) + ' Canva' }, apps);
    expect(late).toEqual([]);
  });

  it('matches whole words, so a short name does not match inside another word', () => {
    const r = rankCandidates({ fromAddress: 'x@billing.com', fromName: '', subject: 'Your billing update', body: 'billing' }, apps);
    expect(r.find((x) => x.app.id === 'a4')).toBeUndefined();
  });

  it('returns nothing when no company is mentioned', () => {
    expect(rankCandidates({ fromAddress: 'x@seek.com.au', fromName: 'SEEK', subject: 'Application update', body: 'Hi' }, apps)).toEqual([]);
  });
});

describe('job board subjects', () => {
  it("reads the role and company out of SEEK's two formats and SmartRecruiters'", () => {
    expect(parseJobBoardSubject('Application update for Customer Service Executive at Cyberdyne Australia'))
      .toEqual({ role: 'Customer Service Executive', company: 'Cyberdyne Australia' });
    expect(parseJobBoardSubject('Initech Information Professionals has responded to your application for Graduate Support / Testing Consultant'))
      .toEqual({ company: 'Initech Information Professionals', role: 'Graduate Support / Testing Consultant' });
    expect(parseJobBoardSubject('An update on your application with Contoso Connect for Customer Service Executive'))
      .toEqual({ company: 'Contoso Connect', role: 'Customer Service Executive' });
    // Gmail hands back folded subjects with the CRLF still in them.
    expect(parseJobBoardSubject('Application update for Software Engineer - Onsite- Melbourne at\r\n  Massive Dynamic'))
      .toEqual({ role: 'Software Engineer - Onsite- Melbourne', company: 'Massive Dynamic' });
    // The last " at " splits, so a role may contain one.
    expect(parseJobBoardSubject('Application update for Sales Assistant at Night at Acme')).toEqual({ role: 'Sales Assistant at Night', company: 'Acme' });
    expect(parseJobBoardSubject('Re: Application update for Barista at Acme')).toEqual({ role: 'Barista', company: 'Acme' });
    expect(parseJobBoardSubject('Your weekly job alert')).toBeNull();
    expect(parseJobBoardSubject('Application update')).toBeNull();
  });

  const seekApps = [
    app('ures', 'Umbrella Rescue and Education Service Ltd (URES)', 'Software Engineer'),
    app('ahri', 'AHRI (Australian HR Institute)', 'IT and Applications Support Officer'),
    app('canva', 'Canva Pty Ltd', 'Frontend Engineer'),
    app('acme-r', 'Acme Pty Ltd', 'Receptionist', '2026-08-01T00:00:00Z'),
    app('acme-oa', 'Acme', 'Office Assistant', '2026-07-01T00:00:00Z'),
  ];
  const seek = (subject: string, body = '') => rankCandidates({ fromAddress: 'noreply@s.seek.com.au', fromName: 'SEEK Applications', subject, body }, seekApps).map((r) => r.app.id);

  it('matches the company a SEEK subject names, even when the application row spells it out in full', () => {
    expect(seek('Application update for Software Engineer at URES')).toEqual(['ures']);
    expect(seek('AHRI has responded to your application for IT and Applications Support Officer')).toEqual(['ahri']);
  });

  it("trusts the subject over other employers' names in the body (SEEK lists similar jobs underneath)", () => {
    expect(seek('Application update for Software Engineer at URES', 'Jobs you might like: Frontend Engineer, Canva Pty Ltd')).toEqual(['ures']);
  });

  it('uses the role to pick between several applications at one company, and keeps them all when the role fits none', () => {
    expect(seek('Application update for Office Assistant at Acme Pty Ltd')).toEqual(['acme-oa']);
    expect(seek('Application update for Barista at Acme')).toEqual(['acme-r', 'acme-oa']);
  });
});

describe('plausibleApps', () => {
  it('keeps applications from the 120 days before the email, nearest first, capped', () => {
    const apps = [
      app('old', 'A', 'r', '2026-01-01T00:00:00Z'),
      app('near', 'B', 'r', '2026-08-30T00:00:00Z'),
      app('mid', 'C', 'r', '2026-06-15T00:00:00Z'),
      app('future', 'D', 'r', '2026-10-01T00:00:00Z'),
    ];
    expect(plausibleApps(apps, '2026-09-01T00:00:00Z').map((a) => a.id)).toEqual(['near', 'mid']);
    const many = Array.from({ length: 60 }, (_, i) => app('x' + i, 'X', 'r', `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`));
    expect(plausibleApps(many, '2026-09-01T00:00:00Z')).toHaveLength(40);
  });
});

describe('companyFromSender', () => {
  it('takes the display name without mailbox words', () => {
    expect(companyFromSender('Canva Careers', 'no-reply@us.greenhouse-mail.io')).toBe('Canva');
    expect(companyFromSender('Atlassian Talent Acquisition', 'x@atlassian.com')).toBe('Atlassian');
  });
  it('uses the domain when there is no name, or the name is a person at the company domain', () => {
    expect(companyFromSender('', 'hr@globex.com.au')).toBe('Globex');
    expect(companyFromSender('Sam Rivers', 'sam@northwind.com.au')).toBe('Northwind');
  });
  it('gives nothing for an ATS with no name', () => {
    expect(companyFromSender('', 'no-reply@us.greenhouse-mail.io')).toBe('');
  });
  it("never takes a job board's own mailbox name for the employer", () => {
    expect(companyFromSender('SEEK Applications', 'noreply@s.seek.com.au')).toBe('');
    expect(companyFromSender('LinkedIn', 'jobs-noreply@linkedin.com')).toBe('');
    // An ATS that sends in the employer's name still gives the employer.
    expect(companyFromSender('Laravel', 'noreply@candidates.workablemail.com')).toBe('Laravel');
  });
});

describe('findCompanyMatch', () => {
  const apps = [app('a', 'Canva Pty Ltd', 'r', '2026-06-01'), app('b', 'Canva', 'r', '2026-07-01'), app('c', 'Globex Media')];
  it('matches on the normalised name, newest first', () => {
    expect(findCompanyMatch('CANVA Australia', apps)!.id).toBe('b');
  });
  it('matches whole-phrase containment either way', () => {
    expect(findCompanyMatch('Globex', apps)!.id).toBe('c');
  });
  it('does not match unrelated or too-short names', () => {
    expect(findCompanyMatch('Northwind', apps)).toBeNull();
    expect(findCompanyMatch('', apps)).toBeNull();
    expect(findCompanyMatch('Canvas Group Holdings', apps)).toBeNull();
  });
});

describe('second pass prompt', () => {
  it('lists every application once and every email with its index, and asks for company and role', async () => {
    const { secondPassPrompt } = await import('../email/classify');
    const p = secondPassPrompt(
      [{ from: 'a@x.com', subject: 'S0', date: '2026-09-01T00:00:00Z', body: 'b0' }, { from: 'b@x.com', subject: 'S1', date: '2026-09-02T00:00:00Z', body: 'b1' }],
      [app('id-a', 'Canva'), app('id-b', 'Atlassian')],
    );
    expect(p.match(/id-a/g)).toHaveLength(1);
    expect(p).toContain('=== Email 1 ===');
    expect(p).toContain('- company:');
    expect(p).toContain('- role:');
  });
});

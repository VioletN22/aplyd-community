import { describe, it, expect } from 'vitest';
import { normalizeJobUrl, jobKey, sourceFromUrl, looksLikeJobUrl } from '../job-capture';

describe('normalizeJobUrl: LinkedIn', () => {
  it('turns a search-results currentJobId into the posting', () => {
    expect(normalizeJobUrl('https://www.linkedin.com/jobs/search-results/?currentJobId=4012345678&keywords=react&origin=JOBS_HOME'))
      .toBe('https://www.linkedin.com/jobs/view/4012345678/');
  });
  it('turns a collections currentJobId into the posting', () => {
    expect(normalizeJobUrl('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3999999999&discover=recommended'))
      .toBe('https://www.linkedin.com/jobs/view/3999999999/');
  });
  it('strips the slug and tracking off /jobs/view', () => {
    expect(normalizeJobUrl('https://au.linkedin.com/jobs/view/junior-full-stack-developer-at-pica-group-4012345678?trk=public_jobs&refId=abc&trackingId=xyz%3D%3D'))
      .toBe('https://www.linkedin.com/jobs/view/4012345678/');
  });
  it('handles /comm/ email links', () => {
    expect(normalizeJobUrl('https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=1&lipi=2&midToken=3'))
      .toBe('https://www.linkedin.com/jobs/view/4012345678/');
  });
});

describe('normalizeJobUrl: Seek', () => {
  it('turns a search page jobId into the posting', () => {
    expect(normalizeJobUrl('https://www.seek.com.au/react-developer-jobs/in-All-Sydney-NSW?jobId=78123456&type=standard'))
      .toBe('https://www.seek.com.au/job/78123456');
  });
  it('strips tracking off /job/N', () => {
    expect(normalizeJobUrl('https://www.seek.com.au/job/78123456?type=standout&ref=search-standalone&origin=cardTitle#sol=abc'))
      .toBe('https://www.seek.com.au/job/78123456');
  });
  it('keeps NZ on NZ', () => {
    expect(normalizeJobUrl('https://www.seek.co.nz/job/81234567?ref=x')).toBe('https://www.seek.co.nz/job/81234567');
  });
});

describe('normalizeJobUrl: Indeed', () => {
  it('uses jk', () => {
    expect(normalizeJobUrl('https://au.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b&from=serp&tk=1h')).toBe('https://au.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b');
  });
  it('uses vjk off a search page', () => {
    expect(normalizeJobUrl('https://au.indeed.com/jobs?q=developer&l=Sydney&vjk=ABCDEF0123456789')).toBe('https://au.indeed.com/viewjob?jk=abcdef0123456789');
  });
  it('defaults www.indeed.com to AU', () => {
    expect(normalizeJobUrl('https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b')).toBe('https://au.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b');
  });
  it('unwraps an Indeed redirect with a destination', () => {
    expect(normalizeJobUrl('https://au.indeed.com/rc/clk?jk=1a2b3c4d5e6f7a8b&fccid=x')).toBe('https://au.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b');
  });
});

describe('normalizeJobUrl: Jora', () => {
  it('drops the query on a posting', () => {
    expect(normalizeJobUrl('https://au.jora.com/job/Junior-Developer-0123456789abcdef0123456789abcdef?disallow=true&sp=serp&sponsored=false&tk=abc'))
      .toBe('https://au.jora.com/job/Junior-Developer-0123456789abcdef0123456789abcdef');
  });
  it('unwraps a Jora redirect to the employer site', () => {
    expect(normalizeJobUrl('https://au.jora.com/job/rd/abc?url=https%3A%2F%2Fcareers.acme.com%2Fjobs%2F42%3Futm_source%3Djora'))
      .toBe('https://careers.acme.com/jobs/42');
  });
});

describe('normalizeJobUrl: ATSs', () => {
  it('Workday: drops /apply and the query', () => {
    expect(normalizeJobUrl('https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Sydney/Graduate-Engineer_R12345/apply?source=LinkedIn'))
      .toBe('https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Sydney/Graduate-Engineer_R12345');
  });
  it('Greenhouse: boards path, no gh_src', () => {
    expect(normalizeJobUrl('https://boards.greenhouse.io/picagroup/jobs/4567890?gh_src=abc123')).toBe('https://boards.greenhouse.io/picagroup/jobs/4567890');
    expect(normalizeJobUrl('https://job-boards.greenhouse.io/picagroup/jobs/4567890?utm_source=li')).toBe('https://job-boards.greenhouse.io/picagroup/jobs/4567890');
  });
  it('Greenhouse on a company site keeps gh_jid', () => {
    expect(normalizeJobUrl('https://pica.com.au/careers/?gh_jid=4567890&utm_medium=social')).toBe('https://pica.com.au/careers/?gh_jid=4567890');
  });
  it('Lever: drops /apply and lever-source', () => {
    expect(normalizeJobUrl('https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply?lever-source=LinkedIn'))
      .toBe('https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
  });
  it('SmartRecruiters: path only', () => {
    expect(normalizeJobUrl('https://jobs.smartrecruiters.com/Canva/744000012345678-frontend-engineer?trid=abc'))
      .toBe('https://jobs.smartrecruiters.com/Canva/744000012345678-frontend-engineer');
  });
  it('Ashby: drops /application', () => {
    expect(normalizeJobUrl('https://jobs.ashbyhq.com/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/application?utm_source=x'))
      .toBe('https://jobs.ashbyhq.com/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
  });
});

describe('normalizeJobUrl: generic', () => {
  it('strips utm_* and click ids, keeps real params and drops the hash', () => {
    expect(normalizeJobUrl('https://careers.acme.com/role?id=42&utm_source=x&utm_campaign=y&fbclid=z&gclid=w#apply'))
      .toBe('https://careers.acme.com/role?id=42');
  });
  it('unwraps a Google redirect', () => {
    expect(normalizeJobUrl('https://www.google.com/url?q=https://careers.acme.com/jobs/7?utm_source%3Dg&sa=D')).toBe('https://careers.acme.com/jobs/7');
  });
  it('unwraps LinkedIn safety/go links', () => {
    expect(normalizeJobUrl('https://www.linkedin.com/safety/go?url=https%3A%2F%2Fjobs.lever.co%2Facme%2F0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b&trk=x'))
      .toBe('https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
  });
  it('leaves junk alone', () => {
    expect(normalizeJobUrl('not a url')).toBe('not a url');
  });
});

describe('jobKey', () => {
  it('matches the same LinkedIn job across URL shapes', () => {
    expect(jobKey('https://www.linkedin.com/jobs/search-results/?currentJobId=4012345678')).toBe('linkedin:4012345678');
    expect(jobKey('https://au.linkedin.com/jobs/view/dev-at-x-4012345678?trk=1')).toBe('linkedin:4012345678');
  });
  it('keys boards and ATSs on their job id', () => {
    expect(jobKey('https://www.seek.com.au/jobs?jobId=78123456')).toBe('seek:78123456');
    expect(jobKey('https://au.indeed.com/jobs?vjk=abcdef0123456789')).toBe('indeed:abcdef0123456789');
    expect(jobKey('https://pica.com.au/careers/?gh_jid=4567890')).toBe('greenhouse:4567890');
    expect(jobKey('https://boards.greenhouse.io/pica/jobs/4567890')).toBe('greenhouse:4567890');
  });
  it('falls back to host + path, without scheme, www or trailing slash', () => {
    expect(jobKey('https://www.acme.com/careers/frontend/?utm_source=x')).toBe('acme.com/careers/frontend');
    expect(jobKey('http://acme.com/careers/frontend')).toBe('acme.com/careers/frontend');
  });
  it('is null for no URL', () => {
    expect(jobKey('')).toBeNull();
    expect(jobKey(null)).toBeNull();
  });
});

describe('sourceFromUrl / looksLikeJobUrl', () => {
  it('names the board', () => {
    expect(sourceFromUrl('https://www.seek.com.au/job/1')).toBe('Seek');
    expect(sourceFromUrl('https://www.linkedin.com/jobs/view/1/')).toBe('LinkedIn');
    expect(sourceFromUrl('https://au.indeed.com/viewjob?jk=1')).toBe('Indeed');
    expect(sourceFromUrl('https://au.jora.com/job/x')).toBe('Jora');
    expect(sourceFromUrl('https://boards.greenhouse.io/x/jobs/1')).toBe('Company website');
    expect(sourceFromUrl('https://acme.com/careers')).toBeNull();
  });
  it('tells job links from other links', () => {
    expect(looksLikeJobUrl('https://acme.com/careers/frontend')).toBe(true);
    expect(looksLikeJobUrl('https://www.seek.com.au/')).toBe(true);
    expect(looksLikeJobUrl('https://www.google.com/search?q=cats')).toBe(false);
    expect(looksLikeJobUrl('https://news.ycombinator.com/item?id=1')).toBe(false);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  classifyClipboard, extractJsonLd, extractPage, parseHtml, mainContainerText, isSufficient,
  composeJobText, parseJobTitle, findDuplicate, companyKey, browserScriptFor, parseTabResult,
  parseLsappinfoBundle, acceleratorLabel, toCss, SITE_SELECTORS, textOf,
} from '../job-capture';
import { setDisplayLocale } from '../../shared/locale';

// Pin the display locale so number formatting does not follow the machine.
setDisplayLocale('en-AU');

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'quick-add', name), 'utf8');

const AD = `Junior Full Stack Developer
PICA Group · Sydney NSW (Hybrid)

About the role
We're looking for a junior developer to join our product team. You'll build features across React and Node.js.

Responsibilities
- Build and test features end to end
- Work with design and product

Requirements
- 1+ years of experience with TypeScript
- Strong communication skills

Full time, $80,000 - $90,000 + super. Apply now.`;

describe('classifyClipboard', () => {
  it('reads a bare link as a URL', () => {
    expect(classifyClipboard('https://www.seek.com.au/job/78123456')).toEqual({ kind: 'url', url: 'https://www.seek.com.au/job/78123456', notes: '' });
  });
  it('finds a URL in surrounding text and keeps the rest as notes', () => {
    const c = classifyClipboard('check this one out -> https://jobs.lever.co/acme/abc (referred by Sam)');
    expect(c.kind).toBe('url');
    if (c.kind === 'url') {
      expect(c.url).toBe('https://jobs.lever.co/acme/abc');
      expect(c.notes).toContain('referred by Sam');
    }
  });
  it('prefers the job link when several links are in a short text', () => {
    const c = classifyClipboard('see https://twitter.com/x and https://boards.greenhouse.io/pica/jobs/1');
    expect(c.kind === 'url' && c.url).toBe('https://boards.greenhouse.io/pica/jobs/1');
  });
  it('reads a pasted posting as an ad', () => {
    const c = classifyClipboard(AD);
    expect(c.kind).toBe('ad');
  });
  it('keeps the apply link that rides along with an ad', () => {
    const c = classifyClipboard(AD + '\n\nApply at https://boards.greenhouse.io/pica/jobs/4567890?gh_src=li');
    expect(c.kind).toBe('ad');
    if (c.kind === 'ad') expect(c.url).toBe('https://boards.greenhouse.io/pica/jobs/4567890?gh_src=li');
  });
  it('splits a burst of links', () => {
    expect(classifyClipboard('https://a.com/jobs/1\nhttps://b.com/jobs/2')).toEqual({ kind: 'urls', urls: ['https://a.com/jobs/1', 'https://b.com/jobs/2'] });
  });
  it('calls empty, short and off-topic text junk', () => {
    expect(classifyClipboard('   ')).toEqual({ kind: 'junk', reason: 'empty' });
    expect(classifyClipboard('Frontend Engineer')).toEqual({ kind: 'junk', reason: 'too-short' });
    const recipe = 'Preheat the oven to 180 degrees. '.repeat(20);
    expect(classifyClipboard(recipe)).toEqual({ kind: 'junk', reason: 'not-a-job' });
  });
});

describe('extractJsonLd', () => {
  it('reads a JobPosting inside @graph, with entity-escaped HTML description', () => {
    const ld = extractJsonLd(fixture('greenhouse-jsonld.html'))!;
    expect(ld.title).toBe('Junior Full Stack Developer');
    expect(ld.company).toBe('PICA Group');
    expect(ld.location).toBe('Sydney, NSW, AU / Melbourne, VIC, AU');
    expect(ld.salaryMin).toBe(75000);
    expect(ld.salaryMax).toBe(85000);
    expect(ld.salary).toBe('AUD 75,000 - 85,000 per year');
    expect(ld.employmentType).toBe('full time');
    expect(ld.datePosted).toBe('2026-09-10');
    expect(ld.validThrough).toBe('2026-10-10T23:59');
    expect(ld.description).toContain("What you'll do");
    expect(ld.description).toContain('- Build features across our React front end');
    expect(ld.description).not.toMatch(/<|&lt;/);
  });
  it('handles a bare top-level posting, string org, remote and a flat salary', () => {
    const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"Data Analyst","hiringOrganization":"Globex","jobLocationType":"TELECOMMUTE","baseSalary":{"currency":"AUD","value":{"value":"110000","unitText":"YEAR"}},"employmentType":"CONTRACTOR","description":"Plain text description"}</script>`;
    const ld = extractJsonLd(html)!;
    expect(ld.company).toBe('Globex');
    expect(ld.location).toBe('Remote');
    expect(ld.salaryMin).toBe(110000);
    expect(ld.employmentType).toBe('contractor');
    expect(ld.description).toBe('Plain text description');
  });
  it('survives broken JSON and raw newlines in strings', () => {
    expect(extractJsonLd('<script type="application/ld+json">{not json</script>')).toBeNull();
    const nl = '<script type="application/ld+json">{"@type":"JobPosting","title":"QA\nEngineer"}</script>';
    expect(extractJsonLd(nl)!.title).toBe('QA Engineer');
  });
  it('ignores non-job structured data', () => {
    expect(extractJsonLd('<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>')).toBeNull();
  });
});

describe('extractPage', () => {
  it('uses the Seek container and keeps the heading, not the nav or similar jobs', () => {
    const cap = extractPage(fixture('seek.html'), 'https://www.seek.com.au/job/78123456');
    expect(cap.via).toBe('site');
    expect(cap.mainText.startsWith('Graduate Software Engineer')).toBe(true);
    expect(cap.mainText).toContain('Participate in code reviews & incident retros');
    expect(cap.mainText).not.toContain('Similar jobs');
    expect(cap.mainText).not.toContain('Career advice');
    expect(cap.mainText).not.toContain('not text');
    expect(cap.title).toBe('Graduate Software Engineer Job in Sydney NSW - SEEK');
    expect(isSufficient(cap)).toBe(true);
  });
  it('prefers JSON-LD and marks it sufficient', () => {
    const cap = extractPage(fixture('greenhouse-jsonld.html'), 'https://boards.greenhouse.io/picagroup/jobs/4567890');
    expect(cap.jsonLd?.company).toBe('PICA Group');
    expect(cap.title).toBe('Junior Full Stack Developer');
    expect(isSufficient(cap)).toBe(true);
  });
  it('finds the main container on an unknown site by heuristic', () => {
    const cap = extractPage(fixture('generic-careers.html'), 'https://www.canva.com/careers/frontend');
    expect(cap.via).toBe('heuristic');
    expect(cap.mainText.startsWith('Frontend Engineer')).toBe(true);
    expect(cap.mainText).toContain('We are looking for a Frontend Engineer');
    expect(cap.mainText).toContain('Apply with your resume');
    expect(cap.mainText).not.toContain('More roles');
    expect(cap.mainText).not.toContain('Privacy policy');
    expect(cap.mainText).not.toMatch(/^Home/);
    expect(isSufficient(cap)).toBe(true);
  });
  it('flags a LinkedIn sign-in wall as not sufficient', () => {
    const cap = extractPage(fixture('linkedin-authwall.html'), 'https://www.linkedin.com/jobs/view/4012345678/');
    expect(cap.loginWall).toBe(true);
    expect(isSufficient(cap)).toBe(false);
    expect(parseJobTitle(cap.title)).toEqual({ company: 'PICA Group', role: 'Junior Full Stack Developer' });
  });
  it('flags auth URLs as walls', () => {
    const cap = extractPage('<html><body><p>hello</p></body></html>', 'https://www.linkedin.com/authwall?trk=x');
    expect(cap.loginWall).toBe(true);
  });
  it('matches every site selector it declares', () => {
    const cases: [string, string][] = [
      ['https://www.linkedin.com/jobs/view/1/', '<div class="show-more-less-html__markup x">BODY</div>'],
      ['https://au.indeed.com/viewjob?jk=1', '<div id="jobDescriptionText">BODY</div>'],
      ['https://au.jora.com/job/x', '<div id="job-description-container">BODY</div>'],
      ['https://acme.wd3.myworkdayjobs.com/x', '<div data-automation-id="jobPostingDescription">BODY</div>'],
      ['https://jobs.lever.co/acme/x', '<div data-qa="job-description">BODY</div>'],
      ['https://jobs.smartrecruiters.com/acme/1', '<div itemprop="description">BODY</div>'],
      ['https://jobs.ashbyhq.com/acme/x', '<div class="ashby-job-posting-right-pane">BODY</div>'],
      ['https://boards.greenhouse.io/acme/jobs/1', '<div class="job__description">BODY</div>'],
    ];
    const body = 'Responsibilities and requirements for this role. '.repeat(10);
    for (const [url, html] of cases) {
      const page = `<html><body><nav>menu menu menu</nav>${html.replace('BODY', body)}<footer>foot</footer></body></html>`;
      const cap = extractPage(page, url);
      expect(cap.via, url).toBe('site');
      expect(cap.mainText, url).toContain('Responsibilities and requirements');
    }
  });
});

describe('parseHtml / textOf', () => {
  it('is forgiving about unclosed tags, entities and void elements', () => {
    const t = parseHtml('<div><p>One &amp; two<p>Three<br>Four &#8211; five &#x2014; six</div><img src=x>');
    expect(textOf(t)).toBe('One & two\n\nThree\nFour – five — six');
  });
  it('mainContainerText never returns chrome for an empty page', () => {
    expect(mainContainerText(parseHtml('<body><nav>Home About</nav></body>'))).toBe('');
  });
});

describe('composeJobText', () => {
  it('leads with JSON-LD facts, then the posting, then the user notes', () => {
    const cap = extractPage(fixture('greenhouse-jsonld.html'), 'https://boards.greenhouse.io/picagroup/jobs/4567890');
    const t = composeJobText({ url: 'https://boards.greenhouse.io/picagroup/jobs/4567890', capture: cap, notes: 'referred by Sam' });
    const lines = t.split('\n');
    expect(lines[0]).toBe('Junior Full Stack Developer at PICA Group');
    expect(t).toContain('Location: Sydney, NSW, AU / Melbourne, VIC, AU');
    expect(t).toContain('Salary: AUD 75,000 - 85,000 per year');
    expect(t).toContain('Job URL: https://boards.greenhouse.io/picagroup/jobs/4567890');
    expect(t).toContain('Some experience with SQL databases');
    expect(t.trim().endsWith('Notes: referred by Sam')).toBe(true);
  });
  it('falls back to the tab title when the page gave nothing', () => {
    const t = composeJobText({ url: 'https://x.com/jobs/1', capture: null, tabTitle: 'Dev at X' });
    expect(t).toBe('Dev at X\nJob URL: https://x.com/jobs/1');
  });
});

describe('parseJobTitle', () => {
  it('reads board title shapes', () => {
    expect(parseJobTitle('(3) Canva hiring Frontend Engineer in Sydney | LinkedIn')).toEqual({ company: 'Canva', role: 'Frontend Engineer' });
    expect(parseJobTitle('Graduate Software Engineer Job in Sydney NSW - SEEK')).toEqual({ role: 'Graduate Software Engineer', company: null });
    expect(parseJobTitle('Job Application for Junior Developer at PICA Group')).toEqual({ role: 'Junior Developer', company: 'PICA Group' });
    expect(parseJobTitle('Frontend Engineer - Canva')).toEqual({ role: 'Frontend Engineer', company: 'Canva' });
    expect(parseJobTitle('')).toEqual({ role: null, company: null });
  });
});

describe('findDuplicate', () => {
  const existing = [
    { id: 'a', company: 'PICA Group Pty Ltd', job_title: 'Junior Full Stack Developer', job_url: 'https://www.linkedin.com/jobs/view/4012345678/' },
    { id: 'b', company: 'Canva', job_title: 'Frontend Engineer', job_url: '' },
    { id: 'c', company: 'Atlassian', job_title: 'Graduate Engineer', job_url: 'https://www.seek.com.au/job/78123456?ref=x' },
  ];
  it('matches by job id across URL shapes', () => {
    expect(findDuplicate({ url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4012345678' }, existing)?.id).toBe('a');
    expect(findDuplicate({ url: 'https://www.seek.com.au/jobs?jobId=78123456' }, existing)?.id).toBe('c');
  });
  it('matches by company + title, ignoring suffixes, case and punctuation', () => {
    expect(findDuplicate({ company: 'pica group', title: 'Junior Full-Stack Developer' }, existing)?.id).toBe('a');
    expect(findDuplicate({ company: 'Canva Pty Ltd', title: 'frontend engineer' }, existing)?.id).toBe('b');
  });
  it('never matches on company alone, or on the row itself', () => {
    expect(findDuplicate({ company: 'Canva', title: 'Backend Engineer' }, existing)).toBeNull();
    expect(findDuplicate({ company: 'Canva', title: 'Frontend Engineer' }, existing, 'b')).toBeNull();
    expect(findDuplicate({ url: 'https://www.seek.com.au/job/99999999' }, existing)).toBeNull();
  });
  it('companyKey drops legal suffixes', () => {
    expect(companyKey('The Acme Group Pty. Ltd.')).toBe(companyKey('acme'));
  });
});

describe('front browser tab', () => {
  it('has a script for Chromium browsers and Safari, none for others', () => {
    expect(browserScriptFor('com.google.Chrome')).toContain('active tab of front window');
    expect(browserScriptFor('company.thebrowser.Browser')).toContain('application id "company.thebrowser.Browser"');
    expect(browserScriptFor('com.brave.Browser')).toContain('title of t');
    expect(browserScriptFor('com.microsoft.edgemac')).toContain('URL of t');
    expect(browserScriptFor('com.apple.Safari')).toContain('current tab of front window');
    expect(browserScriptFor('com.apple.finder')).toBeNull();
    expect(browserScriptFor('bad"id')).toBeNull();
  });
  it('reads osascript results and errors', () => {
    expect(parseTabResult('com.google.Chrome', 'https://www.seek.com.au/job/1\nDev Job in Sydney - SEEK\n', null))
      .toEqual({ ok: true, url: 'https://www.seek.com.au/job/1', title: 'Dev Job in Sydney - SEEK', browser: 'Google Chrome' });
    expect(parseTabResult('com.apple.Safari', '', { message: 'Command failed', stderr: 'execution error: Not authorized to send Apple events to Safari. (-1743)' }))
      .toEqual({ ok: false, reason: 'denied', browser: 'Safari' });
    expect(parseTabResult('com.google.Chrome', 'chrome://newtab/\nNew Tab', null)).toMatchObject({ ok: false, reason: 'no-tab' });
    expect(parseTabResult('com.google.Chrome', '', null)).toMatchObject({ ok: false, reason: 'no-tab' });
    expect(parseTabResult('com.google.Chrome', '', { message: 'timeout' })).toMatchObject({ ok: false, reason: 'failed' });
  });
  it('reads lsappinfo output', () => {
    expect(parseLsappinfoBundle('"CFBundleIdentifier"="com.google.Chrome"\n')).toBe('com.google.Chrome');
    expect(parseLsappinfoBundle('')).toBeNull();
  });
});

describe('small helpers', () => {
  it('labels accelerators the Mac way', () => {
    expect(acceleratorLabel('Control+Command+J', 'darwin')).toBe('⌃⌘J');
    expect(acceleratorLabel('Command+Shift+Alt+j', 'darwin')).toBe('⌥⇧⌘J');
    expect(acceleratorLabel('CommandOrControl+Alt+J', 'win32')).toBe('Ctrl+Alt+J');
  });
  it('turns selectors into CSS', () => {
    const css = SITE_SELECTORS.flatMap((s) => s.selectors).map(toCss);
    expect(css).toContain('[data-automation="jobAdDetails"]');
    expect(css).toContain('.show-more-less-html__markup');
    expect(css).toContain('[class*="_descriptionText"]');
  });
});

describe('stored salary text', () => {
  afterEach(() => setDisplayLocale('en-AU'));
  it('uses one fixed number format whatever the display locale', () => {
    for (const locale of ['de-DE', 'ar-EG', 'fr-FR', 'en-IN']) {
      setDisplayLocale(locale);
      expect(extractJsonLd(fixture('greenhouse-jsonld.html'))!.salary).toBe('AUD 75,000 - 85,000 per year');
    }
  });
});

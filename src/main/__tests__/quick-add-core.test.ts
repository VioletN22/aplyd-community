import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createQuickAdd, QuickAddDeps, Notice, PARTIAL_NOTE } from '../quick-add-core';
import type { ExistingApp, TabResult } from '../job-capture';
import type { ApplicationAddedEvent } from '../events';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'quick-add', name), 'utf8');

/** Offline fakes for every side effect, with a record of what happened. */
function harness(over: Partial<QuickAddDeps> & { clip?: string; apps?: ExistingApp[]; tab?: TabResult; pages?: Record<string, string>; rendered?: Record<string, string> } = {}) {
  const apps: (ExistingApp & { notes?: string })[] = [...(over.apps || [])];
  const notices: Notice[] = [];
  const events: ApplicationAddedEvent[] = [];
  const addCalls: { text: string; jobSource?: string | null }[] = [];
  const fetched: string[] = [];
  const renderedUrls: string[] = [];
  const state = { clip: over.clip ?? '' };
  let n = 0;
  const deps: QuickAddDeps = {
    readClipboard: () => ({ text: state.clip }),
    frontmostTab: async () => over.tab ?? { ok: false, reason: 'not-a-browser' },
    fetchHtml: async (u) => { fetched.push(u); return over.pages?.[u] ?? ''; },
    renderHtml: async (u) => { renderedUrls.push(u); return over.rendered?.[u] ?? ''; },
    listApps: () => apps.map((a) => ({ ...a })),
    addFromText: async (input) => {
      addCalls.push(input);
      // Stand-in for the model: the first line names the job.
      const first = input.text.split('\n')[0];
      const m = first.match(/^(.+?) at (.+)$/);
      const row = { id: 'new' + ++n, company: m ? m[2] : 'Acme', job_title: m ? m[1] : 'Developer', job_url: '' };
      apps.push(row);
      return { applicationId: row.id, company: row.company, role: row.job_title, jobUrl: '' };
    },
    createPlaceholder: ({ company, role, jobUrl, notes }) => {
      const row = { id: 'ph' + ++n, company, job_title: role, job_url: jobUrl, notes };
      apps.push(row);
      return { applicationId: row.id, company, role, jobUrl };
    },
    patchApp: (id, patch) => { const a = apps.find((x) => x.id === id)!; Object.assign(a, patch); },
    deleteApp: (id) => { const i = apps.findIndex((x) => x.id === id); if (i >= 0) apps.splice(i, 1); },
    notify: (x) => notices.push(x),
    emitAdded: (e) => events.push(e),
    log: () => {},
    shortcutLabel: () => '⌃⌘J',
    ...over,
  };
  const qa = createQuickAdd(deps);
  return { qa, apps, notices, events, addCalls, fetched, renderedUrls, state };
}

const AD = `Junior Full Stack Developer at PICA Group
Sydney NSW (Hybrid)

About the role
We're looking for a junior developer to join our product team. You'll build features across React and Node.js with a friendly team.

Responsibilities
- Build and test features end to end
- Work with design and product

Requirements
- 1+ years of experience with TypeScript
- Strong communication skills

Full time, $80,000 - $90,000 + super. Apply now.`;

describe('quick add: clipboard ad', () => {
  it('awaits asynchronous desktop clipboard reads before classifying an ad', async () => {
    const h = harness({ readClipboard: async () => ({ text: AD }) });
    expect(await h.qa.run()).toMatchObject({ status: 'added', partial: false });
    expect(h.addCalls[0].text).toBe(AD);
  });

  it('adds a copied ad through the pipeline and reports it', async () => {
    const h = harness({ clip: AD });
    const o = await h.qa.run();
    expect(o).toMatchObject({ status: 'added', company: 'PICA Group', role: 'Junior Full Stack Developer', partial: false });
    expect(h.addCalls[0].text).toBe(AD);
    expect(h.notices.map((x) => x.kind)).toEqual(['progress', 'added']);
    expect(h.notices[1].title).toBe('Added: PICA Group, Junior Full Stack Developer');
    expect(h.notices[1].applicationId).toBe(o.status === 'added' ? o.applicationId : '');
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ via: 'quick-add', company: 'PICA Group' });
  });

  it('drops the new row and says so when the ad is one the user already has', async () => {
    const h = harness({ clip: AD, apps: [{ id: 'old', company: 'PICA Group', job_title: 'Junior Full Stack Developer', job_url: '' }] });
    const o = await h.qa.run();
    expect(o).toMatchObject({ status: 'duplicate', applicationId: 'old' });
    expect(h.apps.map((a) => a.id)).toEqual(['old']);
    expect(h.notices.at(-1)).toMatchObject({ kind: 'duplicate', title: 'Already in Aplyd Community', body: 'PICA Group, Junior Full Stack Developer', applicationId: 'old' });
    expect(h.events).toHaveLength(0);
  });
});

describe('quick add: clipboard link', () => {
  const GH = 'https://boards.greenhouse.io/picagroup/jobs/4567890';

  it('normalises, fetches, prefers JSON-LD, sets source and link', async () => {
    const h = harness({ clip: GH + '?gh_src=li', pages: { [GH]: fixture('greenhouse-jsonld.html') } });
    const o = await h.qa.run();
    expect(o).toMatchObject({ status: 'added', company: 'PICA Group', role: 'Junior Full Stack Developer', partial: false });
    expect(h.fetched).toEqual([GH]);
    expect(h.renderedUrls).toEqual([]); // plain fetch was enough
    expect(h.addCalls[0].jobSource).toBe('Company website');
    expect(h.addCalls[0].text.startsWith('Junior Full Stack Developer at PICA Group')).toBe(true);
    expect(h.apps.find((a) => a.id === (o as any).applicationId)!.job_url).toBe(GH);
  });

  it('stops before fetching when the link is already in aplyd', async () => {
    const h = harness({ clip: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4012345678', apps: [{ id: 'li', company: 'X', job_title: 'Y', job_url: 'https://au.linkedin.com/jobs/view/y-at-x-4012345678' }] });
    const o = await h.qa.run();
    expect(o).toMatchObject({ status: 'duplicate', applicationId: 'li' });
    expect(h.fetched).toEqual([]);
    expect(h.notices).toEqual([expect.objectContaining({ kind: 'duplicate', body: 'X, Y' })]);
  });

  it('renders in the in-app browser when the plain fetch is thin', async () => {
    const SEEK = 'https://www.seek.com.au/job/78123456';
    const h = harness({ clip: 'https://www.seek.com.au/jobs?jobId=78123456', pages: { [SEEK]: '<html><body><div id="app"></div></body></html>' }, rendered: { [SEEK]: fixture('seek.html') } });
    const o = await h.qa.run();
    expect(o.status).toBe('added');
    expect(h.renderedUrls).toEqual([SEEK]);
    expect(h.addCalls[0].jobSource).toBe('Seek');
    expect(h.addCalls[0].text).toContain('Participate in code reviews');
  });

  it('keeps a LinkedIn link behind a login as a placeholder row with the note', async () => {
    const LI = 'https://www.linkedin.com/jobs/view/4012345678/';
    const wall = fixture('linkedin-authwall.html');
    const h = harness({ clip: 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678', pages: { [LI]: wall }, rendered: { [LI]: wall } });
    const o = await h.qa.run();
    expect(o).toMatchObject({ status: 'added', partial: true, company: 'PICA Group', role: 'Junior Full Stack Developer' });
    const row = h.apps.find((a) => a.id === (o as any).applicationId)!;
    expect(row.job_url).toBe(LI);
    expect(row.notes).toBe(PARTIAL_NOTE);
    expect(h.addCalls).toHaveLength(0); // nothing worth extracting
    expect(h.notices.at(-1)!.title).toBe('Added (partly): PICA Group, Junior Full Stack Developer');
    expect(h.events[0]).toMatchObject({ partial: true, jobUrl: LI });
  });

  it('refuses a non-job page it cannot read', async () => {
    const h = harness({ clip: 'https://news.ycombinator.com/item?id=1' });
    const o = await h.qa.run();
    expect(o.status).toBe('failed');
    expect(h.notices.at(-1)!.body).toContain('does not look like a job ad');
    expect(h.apps).toHaveLength(0);
  });
});

describe('quick add: front browser tab', () => {
  const SEEK = 'https://www.seek.com.au/job/78123456';

  it('uses the tab when the clipboard is empty', async () => {
    const h = harness({ clip: '', tab: { ok: true, url: SEEK + '?ref=x', title: 'Graduate Software Engineer Job in Sydney NSW - SEEK', browser: 'Google Chrome' }, pages: { [SEEK]: fixture('seek.html') } });
    const o = await h.qa.run();
    expect(o.status).toBe('added');
    expect(h.fetched).toEqual([SEEK]);
  });

  it('uses the tab, not a clipboard it already used', async () => {
    const h = harness({ clip: AD, tab: { ok: true, url: SEEK, title: 't', browser: 'Arc' }, pages: { [SEEK]: fixture('seek.html') } });
    h.qa.primeClipboard(); // the ad was on the clipboard before aplyd started
    await h.qa.run();
    expect(h.fetched).toEqual([SEEK]);
    expect(h.addCalls[0].text).not.toBe(AD);
  });

  it('explains how to allow Automation when the browser said no', async () => {
    const h = harness({ clip: '', tab: { ok: false, reason: 'denied', browser: 'Safari' } });
    const o = await h.qa.run();
    expect(o.status).toBe('failed');
    const body = h.notices.at(-1)!.body;
    expect(body).toContain('Privacy & Security > Automation');
    expect(body).toContain('Safari');
    expect(body).toContain('⌃⌘J');
  });

  it('says what to do when there is nothing to add', async () => {
    const h = harness({ clip: 'hello' });
    const o = await h.qa.run();
    expect(o.status).toBe('failed');
    expect(h.notices.at(-1)!.body).toContain('too short');
  });
});

describe('quick add: queueing', () => {
  it('runs presses one at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const h = harness({
      clip: AD,
      addFromText: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 5)); active--; return { applicationId: 'z' + Math.random(), company: 'C' + Math.random(), role: 'R', jobUrl: '' }; },
    });
    const a = h.qa.run();
    h.state.clip = AD + ' again';
    const b = h.qa.run();
    await Promise.all([a, b]);
    expect(maxActive).toBe(1);
  });
});

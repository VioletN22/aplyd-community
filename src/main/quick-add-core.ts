// Quick add, the decisions: given what the clipboard and the front browser tab
// hold, which posting is the user adding, is it already in the app, and what text goes
// to the existing add pipeline. Every side effect is injected (QuickAddDeps), so
// this runs offline in tests; quick-add.ts supplies the real ones.
import {
  classifyClipboard, ClipboardClass, normalizeJobUrl, looksLikeJobUrl, sourceFromUrl,
  extractPage, isSufficient, captureScore, composeJobText, parseJobTitle, findDuplicate,
  jobSignalCount, PageCapture, ExistingApp, TabResult,
} from './job-capture';
import type { ApplicationAddedEvent } from './events';

/** The note on a row added from a link whose page could not be read in full. */
export const PARTIAL_NOTE = 'Added from link; open it once to fill details';

export interface AddedRow { applicationId: string; company: string; role: string; jobUrl: string }

export interface Notice {
  kind: 'progress' | 'added' | 'duplicate' | 'error';
  title: string;
  body: string;
  /** The row to open when the notice is clicked. */
  applicationId?: string;
}

export interface QuickAddDeps {
  readClipboard(): { text: string; bookmarkUrl?: string | null } | Promise<{ text: string; bookmarkUrl?: string | null }>;
  frontmostTab(): Promise<TabResult>;
  /** Plain HTTP GET, HTML kept. '' on any failure. */
  fetchHtml(url: string): Promise<string>;
  /** The page as the in-app browser renders it (outerHTML). '' on any failure. */
  renderHtml(url: string): Promise<string>;
  listApps(): ExistingApp[];
  /** The existing add pipeline (extraction, raw_job_text, workflow, fit score). */
  addFromText(input: { text: string; jobSource?: string | null }): Promise<AddedRow>;
  /** A row with only company, role and link, for a posting behind a login. */
  createPlaceholder(input: { company: string; role: string; jobUrl: string; jobSource: string | null; notes: string }): AddedRow;
  patchApp(id: string, patch: { job_url?: string; notes?: string }): void;
  deleteApp(id: string): void;
  notify(n: Notice): void;
  emitAdded(e: ApplicationAddedEvent): void;
  log(...args: unknown[]): void;
  /** The shortcut as the user would press it, for "press X again" hints. */
  shortcutLabel(): string;
}

export type Outcome =
  | { status: 'added'; applicationId: string; company: string; role: string; partial: boolean }
  | { status: 'duplicate'; applicationId: string; company: string; role: string }
  | { status: 'failed'; reason: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** "seek.com.au" -> "Seek": a company stand-in when nothing better is known. */
function hostLabel(url: string): string {
  const h = hostOf(url).split('.').filter((p) => !/^(com|co|net|org|au|nz|uk|io|jobs|careers|apply|boards|job-boards|www)$/.test(p));
  const base = h[0] || hostOf(url);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function createQuickAdd(deps: QuickAddDeps) {
  const state = { lastClip: null as string | null };
  let chain: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const dupOutcome = (d: ExistingApp): Outcome => {
    deps.notify({ kind: 'duplicate', title: 'Already in Aplyd Community', body: `${d.company}, ${d.job_title}`, applicationId: d.id });
    return { status: 'duplicate', applicationId: d.id, company: d.company, role: d.job_title };
  };

  const failOutcome = (reason: string): Outcome => {
    deps.notify({ kind: 'error', title: 'Could not add that job', body: reason });
    return { status: 'failed', reason };
  };

  /** After the pipeline made a row: last duplicate check, the link, the note, the news. */
  function finish(added: AddedRow, ctx: { url: string | null; partial: boolean; before: ExistingApp[] }): Outcome {
    const dup = findDuplicate({ url: ctx.url, company: added.company, title: added.role }, ctx.before, added.applicationId);
    if (dup) {
      // Only now did the posting's company and title become known. The row is
      // seconds old and ours; drop it rather than leave them a twin to clean up.
      try { deps.deleteApp(added.applicationId); } catch (e) { deps.log('[quick-add] duplicate cleanup failed', errText(e)); }
      return dupOutcome(dup);
    }
    const patch: { job_url?: string; notes?: string } = {};
    if (ctx.url && added.jobUrl !== ctx.url) patch.job_url = ctx.url;
    if (ctx.partial) patch.notes = PARTIAL_NOTE;
    if (Object.keys(patch).length) {
      try { deps.patchApp(added.applicationId, patch); } catch (e) { deps.log('[quick-add] patch failed', errText(e)); }
    }
    const jobUrl = patch.job_url || added.jobUrl || ctx.url || '';
    deps.emitAdded({ applicationId: added.applicationId, company: added.company, role: added.role, jobUrl, via: 'quick-add', partial: ctx.partial });
    deps.notify({
      kind: 'added',
      title: ctx.partial ? `Added (partly): ${added.company}, ${added.role}` : `Added: ${added.company}, ${added.role}`,
      body: ctx.partial ? 'Could not read the whole posting. Open it once to fill in the details.' : 'Click to open it in Aplyd Community.',
      applicationId: added.applicationId,
    });
    deps.log('[quick-add] added', added.applicationId, added.company, '/', added.role, ctx.partial ? '(partial)' : '');
    return { status: 'added', applicationId: added.applicationId, company: added.company, role: added.role, partial: ctx.partial };
  }

  /** Plain fetch first; the in-app browser only when that came back thin. */
  async function capture(url: string): Promise<PageCapture | null> {
    let best: PageCapture | null = null;
    const html = await deps.fetchHtml(url).catch(() => '');
    if (html) best = extractPage(html, url);
    if (!isSufficient(best)) {
      deps.log('[quick-add] plain fetch thin', best ? `via=${best.via} chars=${best.mainText.length} wall=${best.loginWall}` : 'empty', '-> rendering');
      const rendered = await deps.renderHtml(url).catch(() => '');
      if (rendered) {
        const r = extractPage(rendered, url);
        if (captureScore(r) > captureScore(best)) best = r;
      }
    }
    if (best) deps.log('[quick-add] captured', url, `via=${best.via} chars=${best.mainText.length} jsonld=${!!best.jsonLd} wall=${best.loginWall}`);
    return best;
  }

  async function addFromUrl(rawUrl: string, hint: { notes?: string; tabTitle?: string | null } = {}): Promise<Outcome> {
    const url = normalizeJobUrl(rawUrl);
    const before = deps.listApps();
    const byUrl = findDuplicate({ url }, before);
    if (byUrl) return dupOutcome(byUrl);

    deps.notify({ kind: 'progress', title: 'Adding job…', body: hostOf(url) });
    const cap = await capture(url);
    const ld = cap?.jsonLd || null;
    const titled = parseJobTitle(ld?.title ? null : (cap?.title || hint.tabTitle));
    const company = ld?.company || titled.company;
    const role = ld?.title || titled.role;
    const byName = findDuplicate({ company, title: role }, before);
    if (byName) return dupOutcome(byName);

    const notes = (hint.notes || '').trim();
    const notesArePosting = notes.length >= 600 && jobSignalCount(notes) >= 3;
    const sufficient = isSufficient(cap) || notesArePosting;
    const jobSource = sourceFromUrl(url);
    const text = composeJobText({ url, capture: cap, notes, tabTitle: hint.tabTitle });
    const readable = (cap?.mainText || '').length + notes.length;

    if (sufficient || readable >= 200) {
      try {
        const added = await deps.addFromText({ text, jobSource });
        return finish(added, { url, partial: !sufficient, before });
      } catch (e) {
        deps.log('[quick-add] extraction failed', errText(e));
        if (sufficient) return failOutcome(errText(e));
      }
    }

    // Behind a login, or a JS page that never rendered: still keep the link, as a
    // row the user can finish later, but only for something that is plainly a job.
    if (!ld && !looksLikeJobUrl(url)) {
      return failOutcome(`${hostOf(url)} does not look like a job ad. Copy the posting text, then press ${deps.shortcutLabel()}.`);
    }
    const pCompany = company || hostLabel(url);
    const pRole = role || `Job at ${pCompany}`;
    const byPlaceholder = findDuplicate({ company: pCompany, title: pRole }, before);
    if (byPlaceholder) return dupOutcome(byPlaceholder);
    const row = deps.createPlaceholder({ company: pCompany, role: pRole, jobUrl: url, jobSource, notes: PARTIAL_NOTE });
    return finish(row, { url, partial: true, before });
  }

  async function addFromAd(text: string, rawUrl: string | null): Promise<Outcome> {
    const url = rawUrl ? normalizeJobUrl(rawUrl) : null;
    const before = deps.listApps();
    if (url) {
      const d = findDuplicate({ url }, before);
      if (d) return dupOutcome(d);
    }
    deps.notify({ kind: 'progress', title: 'Adding job…', body: 'From the copied ad' });
    const withUrl = url && !text.includes(url) ? `${text}\n\nJob URL: ${url}` : text;
    try {
      const added = await deps.addFromText({ text: withUrl, jobSource: url ? sourceFromUrl(url) : null });
      return finish(added, { url, partial: false, before });
    } catch (e) {
      return failOutcome(errText(e));
    }
  }

  async function fromClipboard(c: Exclude<ClipboardClass, { kind: 'junk' }>): Promise<Outcome> {
    if (c.kind === 'ad') return addFromAd(c.text, c.url);
    if (c.kind === 'url') return addFromUrl(c.url, { notes: c.notes });
    let last: Outcome = { status: 'failed', reason: 'no links' };
    for (const u of c.urls.slice(0, 10)) last = await addFromUrl(u);
    return last;
  }

  async function runOnce(): Promise<Outcome> {
    let raw = '';
    try {
      const clip = await deps.readClipboard();
      raw = String(clip.text || '').trim() || String(clip.bookmarkUrl || '').trim();
    } catch (e) { deps.log('[quick-add] clipboard read failed', errText(e)); }
    const c = classifyClipboard(raw);
    const fresh = !!raw && raw !== state.lastClip;

    // 1. Something new on the clipboard that is a job or a link: that is the ask.
    if (fresh && c.kind !== 'junk') {
      state.lastClip = raw;
      return fromClipboard(c);
    }

    // 2. Otherwise the tab the user is looking at, if the front app is a browser.
    const tab = await deps.frontmostTab().catch((e): TabResult => ({ ok: false, reason: 'failed', detail: errText(e) }));
    if (tab.ok) return addFromUrl(tab.url, { tabTitle: tab.title });

    // 3. A clipboard the user already used is still better than nothing.
    if (c.kind !== 'junk') {
      state.lastClip = raw;
      return fromClipboard(c);
    }

    if (!tab.ok && tab.reason === 'denied') {
      return failOutcome(`Aplyd Community is not allowed to read ${tab.browser || 'the browser'}'s tab. Open System Settings > Privacy & Security > Automation and turn on ${tab.browser || 'the browser'} under Aplyd Community. Or copy the link and press ${deps.shortcutLabel()} again.`);
    }
    if (!tab.ok && tab.reason === 'failed') deps.log('[quick-add] front tab read failed', tab.detail || '');
    if (raw && c.kind === 'junk' && c.reason === 'too-short') {
      return failOutcome(`The copied text is too short to be a job ad. Copy the whole posting or its link, then press ${deps.shortcutLabel()}.`);
    }
    return failOutcome(`Nothing to add. Copy a job link or the ad text (or open the job in your browser), then press ${deps.shortcutLabel()}.`);
  }

  return {
    /** Remember what is on the clipboard now, so only a later copy counts as new. */
    primeClipboard(): Promise<void> {
      const primed = (async () => {
        try { const clip = await deps.readClipboard(); state.lastClip = String(clip.text || '').trim() || String(clip.bookmarkUrl || '').trim() || null; } catch { /* ignore */ }
      })();
      chain = primed;
      return primed;
    },
    /** One shortcut press. Presses queue (three deep) and run one at a time. */
    run(): Promise<Outcome> {
      if (pending >= 3) return Promise.resolve({ status: 'failed', reason: 'busy' } as Outcome);
      pending++;
      const next = chain.then(() => runOnce()).catch((e): Outcome => failOutcome(errText(e))).finally(() => { pending--; });
      chain = next;
      return next;
    },
    addFromUrl,
    addFromAd,
  };
}

export type QuickAdd = ReturnType<typeof createQuickAdd>;

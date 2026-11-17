// Hydration for every letter path: one place that turns an application (or a bare
// company + role from the standalone studio) into the LetterContext the prompt builders
// consume. Everything expensive is cached, because the same resume, the same
// portfolio and the same company research get asked for over and over:
//
//   resume     app_settings.resume_text_cache   keyed on the locker file's mtime
//   portfolio  app_settings.portfolio_cache     7 day TTL
//   research   company_research table           14 day TTL
//   voice      app_settings.voice_profile       re-distilled when the notes change
//
// The prompt builders in autopilot-prompts.ts do no DB and no network work; this
// module is where all of it lives.
import fs from 'fs';
import { createHash } from 'crypto';
import {
  getApplication, getAnswerBank, getDocuments, getPortfolioLinks, getVoiceNotes,
  getSetting, setSetting, getCompanyResearch, saveCompanyResearch,
  getVoiceProfile, saveVoiceProfile, getKeptLetterBodies, getRawJobText,
  getResumeFocus, setApplicationResumeIfEmpty, type VoiceProfile,
} from './database';
import {
  getProfile, extractResumeText, extractResumeTextFrom, portfolioSnapshotAll, companyResearch,
  distillVoicePrompt, DISTILL_SCHEMA, resumePickPrompt, type LetterContext,
} from './autopilot-prompts';
import { runClaudeJSON, SYS } from './claude';
import { loadSources } from './autopilot-lazy';

const DAY_MS = 24 * 60 * 60 * 1000;
const RESEARCH_TTL_MS = 14 * DAY_MS;
const PORTFOLIO_TTL_MS = 7 * DAY_MS;
const EXEMPLAR_COUNT = 3;
const VOICE_GUIDE_CAP = 4000;
// Optional user-authored text, stored with this installation's preferences.

export interface HydrateOpts {
  /**
   * Set on refine paths. Two effects: the caller is going to append it to the
   * prompt, and hydration stays cache-only for company research (a refine should
   * never pay for a fresh web hop, the research it needs was already fetched).
   */
  feedback?: string;
  /**
   * Same cache-only rule as a refine, without pretending to be one. The
   * assistant hydrates on every chat turn, and a live web crawl per turn would
   * be both slow and rude to the site: it takes the saved research or none.
   */
  researchCacheOnly?: boolean;
  /** Status line for the UI, e.g. while research is running or was skipped. */
  onProgress?: (message: string) => void;
}

/** LetterContext plus what the UI wants to show about the research it used. */
export interface HydratedLetterContext extends LetterContext {
  /** Label of the resume variant picked as the best fit for this job. */
  primaryResume?: string;
  /** Its locker document id, when one was read. */
  primaryResumeDocId?: string | null;
  researched: boolean;
  researchSources: string[];
}

export interface StandaloneInput {
  company: string;
  role: string;
  rawJobText?: string;
  jobSummary?: string;
  jobUrl?: string;
  location?: string;
  /**
   * Free text the user typed alongside the request (the studio's "extra"
   * field). Threaded in as a labelled fact rather than glued onto the posting,
   * so it is attributed correctly and cannot be cut off by the posting cap.
   */
  extraContext?: string;
}

const fresh = (iso: string | undefined, ttlMs: number): boolean => {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) && Date.now() - t < ttlMs;
};

// ── resume ───────────────────────────────────────────────────────────────────
function defaultResumeDoc(): { id: string; label: string; filePath: string } | null {
  const doc = getDocuments().find((d) => d.isDefault && d.tags.includes('resume'))
    || getDocuments().find((d) => d.tags.includes('resume'));
  return doc || null;
}

function resumeFilePath(): string | null {
  return defaultResumeDoc()?.filePath ?? null;
}

/**
 * Resume text, cached on the file's mtime. Extraction runs pdf-parse over a
 * multi-page PDF, so doing it per letter is pure waste; touching the file (or
 * swapping the default resume) invalidates the cache by itself.
 */
export async function cachedResumeText(): Promise<string> {
  const file = resumeFilePath();
  if (!file) return '';
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return ''; }
  try {
    const raw = getSetting('resume_text_cache');
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.path === file && c.mtimeMs === mtimeMs && typeof c.text === 'string') return c.text;
    }
  } catch { /* corrupt cache, re-extract */ }
  const text = await extractResumeText().catch(() => '');
  if (text) {
    try { setSetting('resume_text_cache', JSON.stringify({ path: file, mtimeMs, text })); } catch { /* cache is best effort */ }
  }
  return text;
}

/**
 * Every resume variant in the locker, text-extracted and cached per file mtime.
 * Letters and the assistant see ALL of them: the variants are the same person
 * with different emphasis, so a fact that only made it onto the retail or the
 * infrastructure version is still true and still usable.
 */
interface ResumeVariant { id: string; label: string; focus: string; isDefault: boolean; text: string }

async function allResumeVariants(): Promise<ResumeVariant[]> {
  const docs = getDocuments().filter((d) => d.tags.includes('resume'));
  if (!docs.length) return [];
  let cache: Record<string, { mtimeMs: number; text: string }> = {};
  try { cache = JSON.parse(getSetting('resume_texts_cache') || '{}') || {}; } catch { cache = {}; }
  const focus = getResumeFocus();
  let dirty = false;
  const out: ResumeVariant[] = [];
  for (const d of docs) {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(d.filePath).mtimeMs; } catch { continue; }
    let text = cache[d.filePath] && cache[d.filePath].mtimeMs === mtimeMs ? cache[d.filePath].text : '';
    if (!text) {
      text = await extractResumeTextFrom(d.filePath).catch(() => '');
      if (text) { cache[d.filePath] = { mtimeMs, text }; dirty = true; }
    }
    if (text) out.push({ id: d.id, label: d.label, focus: focus[d.id] || '', isDefault: d.isDefault, text });
  }
  if (dirty) { try { setSetting('resume_texts_cache', JSON.stringify(cache)); } catch { /* best effort */ } }
  return out;
}

const PICK_SCHEMA = {
  type: 'object',
  properties: { index: { type: 'integer' } },
  required: ['index'],
  additionalProperties: false,
};

/**
 * Which variant fits THIS job best. One cheap haiku call, cached on the job and
 * the variant set, so refines and every assistant turn reuse the answer.
 */
async function pickPrimaryResume(variants: ResumeVariant[], role: string, jobText: string): Promise<number> {
  const fallback = Math.max(0, variants.findIndex((v) => v.isDefault));
  if (variants.length < 2 || !String(jobText || role || '').trim()) return fallback;
  const key = createHash('sha1')
    .update([role, jobText.slice(0, 6000), ...variants.map((v) => v.id + ':' + v.focus)].join('\n'))
    .digest('hex');
  let cache: Record<string, string> = {};
  try { cache = JSON.parse(getSetting('resume_pick_cache') || '{}') || {}; } catch { cache = {}; }
  const hit = variants.findIndex((v) => v.id === cache[key]);
  if (hit >= 0) return hit;
  try {
    const r = await runClaudeJSON<{ index: number }>(
      resumePickPrompt(variants.map((v) => ({ label: v.label, focus: v.focus || v.text.slice(0, 400) })), { title: role, jobText }),
      { schema: PICK_SCHEMA, model: 'haiku', fallbackModel: 'sonnet', timeoutMs: 30000, systemPrompt: SYS.resolve },
    );
    const i = Number(r && r.index);
    if (Number.isInteger(i) && i >= 0 && i < variants.length) {
      cache[key] = variants[i].id;
      const keys = Object.keys(cache);
      if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete cache[k];
      try { setSetting('resume_pick_cache', JSON.stringify(cache)); } catch { /* best effort */ }
      return i;
    }
  } catch (e) {
    console.warn('[resume] pick failed, using default', String(e));
  }
  return fallback;
}

/**
 * The resume block for one job: the best-fit variant in full as PRIMARY, then
 * every other variant as supporting material. Falls back to the single cached
 * default resume when the locker has one file or extraction fails.
 */
export interface ResumeForJob {
  text: string;
  /** Label of the primary (best-fit) variant, '' when none. */
  primary: string;
  /** Locker document id of that variant, null when no resume was read. */
  primaryDocId: string | null;
}

export async function resumeTextForJob(role: string, jobText: string): Promise<ResumeForJob> {
  const variants = await allResumeVariants().catch(() => [] as ResumeVariant[]);
  if (variants.length < 2) {
    if (variants[0]) return { text: variants[0].text, primary: variants[0].label, primaryDocId: variants[0].id };
    const text = await cachedResumeText();
    const doc = text ? defaultResumeDoc() : null;
    return { text, primary: doc?.label || '', primaryDocId: doc?.id ?? null };
  }
  const idx = await pickPrimaryResume(variants, role, jobText);
  const primary = variants[idx];
  const others = variants.filter((_, i) => i !== idx);
  const text =
    `PRIMARY RESUME for this job (the best-fit variant: "${primary.label}"). Build the letter's structure and lead evidence from this one.\n` +
    primary.text +
    `\n\nOTHER RESUME VARIANTS (the same person, different emphasis; every fact in them is true and usable). ` +
    `Pull in any fact from these that matches the posting better than what the primary shows, and ignore what is irrelevant to this role. ` +
    `Where two variants disagree on a date or a title, trust the most recently dated one.\n` +
    others.map((v) => `--- ${v.label}${v.focus ? ` (focus: ${v.focus})` : ''} ---\n${v.text}`).join('\n\n');
  return { text, primary: primary.label, primaryDocId: primary.id };
}

// ── portfolio ────────────────────────────────────────────────────────────────
function portfolioLinkLines(): string {
  const links = getPortfolioLinks();
  return links.length ? `LINKS:\n${links.map((p) => `- ${p.label}: ${p.url}`).join('\n')}` : '';
}

/** Live site text, refreshed at most once a week. */
export async function cachedPortfolioText(): Promise<string> {
  const links = portfolioLinkLines();
  let snapshot = '';
  try {
    const raw = getSetting('portfolio_cache');
    if (raw) {
      const c = JSON.parse(raw);
      if (c && typeof c.text === 'string' && fresh(c.fetched_at, PORTFOLIO_TTL_MS)) snapshot = c.text;
    }
  } catch { /* corrupt cache, refetch */ }
  if (!snapshot) {
    snapshot = await portfolioSnapshotAll().catch(() => '');
    if (snapshot) {
      try { setSetting('portfolio_cache', JSON.stringify({ fetched_at: new Date().toISOString(), text: snapshot })); } catch { /* best effort */ }
    }
  }
  return [links, snapshot].filter(Boolean).join('\n\n');
}

// ── voice profile ────────────────────────────────────────────────────────────
function readVoiceGuide(): string {
  return (getSetting('voice_guide_text') || '').slice(0, VOICE_GUIDE_CAP);
}

// Identity of the raw notes: ids plus text, so an edit or a deletion re-distils
// but a plain app restart does not.
function voiceSrcHash(notes: { id: string; note: string }[]): string {
  const h = createHash('sha1');
  for (const n of notes) h.update(`${n.id}\0${n.note}\0`);
  return h.digest('hex');
}

/**
 * The distilled {follow, avoid} profile. One cheap haiku pass over all raw voice
 * notes plus the voice guide; re-run only when the notes change (or when forced,
 * right after a new note is remembered). Letter prompts never see raw notes:
 * that is what keeps a pasted model preamble or a one-off content request from
 * becoming a permanent style rule.
 */
export async function ensureVoiceProfile(force = false): Promise<VoiceProfile> {
  const notes = getVoiceNotes();
  const hash = voiceSrcHash(notes);
  const stored = getVoiceProfile();
  if (!force && stored && getSetting('voice_profile_src_hash') === hash) return stored;

  const guide = readVoiceGuide();
  if (!notes.length && !guide) {
    const empty: VoiceProfile = { follow: [], avoid: [] };
    try { saveVoiceProfile(empty); setSetting('voice_profile_src_hash', hash); } catch { /* best effort */ }
    return empty;
  }

  try {
    const out = await runClaudeJSON<VoiceProfile>(
      distillVoicePrompt(notes.map((n) => n.note), guide),
      { model: 'haiku', schema: DISTILL_SCHEMA, systemPrompt: SYS.distill, timeoutMs: 60000 },
    );
    const profile: VoiceProfile = {
      follow: (out?.follow || []).map(String).filter(Boolean).slice(0, 12),
      avoid: (out?.avoid || []).map(String).filter(Boolean).slice(0, 12),
    };
    saveVoiceProfile(profile);
    setSetting('voice_profile_src_hash', hash);
    return profile;
  } catch (e) {
    // A failed distillation must not take their voice away: keep the last good
    // profile until the next attempt succeeds.
    console.warn('[voice] distillation failed, keeping the stored profile:', String(e));
    return stored || { follow: [], avoid: [] };
  }
}

// ── company research ─────────────────────────────────────────────────────────
function sourcesFromText(text: string): string[] {
  return (text.match(/SOURCE (\S+):/g) || []).map((m) => m.replace(/^SOURCE |:$/g, ''));
}

async function hydrateResearch(
  company: string,
  jobUrl: string | undefined,
  location: string | undefined,
  opts: HydrateOpts,
): Promise<{ text: string; sources: string[] }> {
  const note = (m: string) => { try { opts.onProgress?.(m); } catch { /* ignore */ } };
  const cached = getCompanyResearch(company);
  if (cached && cached.text && fresh(cached.fetchedAt, RESEARCH_TTL_MS)) {
    note(`Using saved research on ${company}.`);
    return { text: cached.text, sources: cached.sources };
  }
  const stale = cached && cached.text ? { text: cached.text, sources: cached.sources } : { text: '', sources: [] };

  // Refines (and every assistant turn) reuse whatever research the draft was
  // written from; they never pay for a fresh crawl mid-conversation.
  if (opts.feedback || opts.researchCacheOnly) return stale;

  // Everything past here lives in the research chain (sources → driver).
  // autopilot-lazy loads it at the first live research hop rather than at import
  // time, so neither a cold start nor a draft answered from cache pays for it.
  note(`Researching ${company} on the web…`);
  let text = '';
  let sources: string[] = [];
  try {
    const { researchCompany } = await loadSources();
    const r = await researchCompany(company, jobUrl, location);
    text = r.text || '';
    sources = r.sources || [];
  } catch (e) {
    console.warn('[cover] researchCompany err', String(e));
  }
  if (!text) {
    text = await companyResearch(company, jobUrl).catch(() => '');
    sources = sourcesFromText(text);
  }
  if (text) {
    try { saveCompanyResearch(company, text, sources); } catch { /* cache is best effort */ }
    return { text, sources };
  }
  return stale;
}

// ── hydration ────────────────────────────────────────────────────────────────
async function hydrate(input: StandaloneInput, opts: HydrateOpts): Promise<HydratedLetterContext> {
  const jobText = String(input.rawJobText || input.jobSummary || '');
  const [resume, portfolioText, voice, research] = await Promise.all([
    resumeTextForJob(input.role, jobText).catch(async (): Promise<ResumeForJob> => ({ text: await cachedResumeText(), primary: '', primaryDocId: null })),
    cachedPortfolioText(),
    ensureVoiceProfile(),
    hydrateResearch(input.company, input.jobUrl, input.location, opts),
  ]);

  const facts = getAnswerBank().map((e) => ({
    label: e.label + (e.context ? ` (${e.context})` : ''),
    value: e.value,
  }));
  const extra = String(input.extraContext || '').trim();
  if (extra) facts.unshift({ label: 'Extra context the user gave for this letter', value: extra });

  return {
    company: input.company,
    role: input.role,
    rawJobText: input.rawJobText || undefined,
    jobSummary: input.jobSummary || undefined,
    researchText: research.text,
    portfolioText,
    resumeText: resume.text,
    primaryResume: resume.primary,
    primaryResumeDocId: resume.primaryDocId,
    profile: getProfile(),
    facts,
    voice,
    exemplars: getKeptLetterBodies(EXEMPLAR_COUNT),
    researched: !!research.text,
    researchSources: research.sources,
  };
}

/**
 * Everything a letter for THIS application needs. The posting is the raw stored
 * text when we have it, and the old extraction summary only as a fallback for
 * rows added before raw_job_text existed.
 */
export async function hydrateLetterContext(
  applicationId: string,
  opts: HydrateOpts = {},
): Promise<HydratedLetterContext> {
  const app = getApplication(applicationId);
  if (!app) throw new Error(`Application ${applicationId} not found`);
  const raw = getRawJobText(applicationId) || '';
  const summary = [app.job_description, app.key_responsibilities, app.required_skills]
    .filter(Boolean).join('\n\n');
  const ctx = await hydrate({
    company: app.company,
    role: app.job_title,
    rawJobText: raw || undefined,
    jobSummary: raw ? undefined : summary,
    jobUrl: app.job_url || undefined,
    location: app.location || undefined,
  }, opts);
  // "Resume sent": the variant this letter was built on, recorded once. A pick
  // the user made by hand (or an earlier draft's) is never overwritten. The
  // assistant (researchCacheOnly) hydrates too, but a chat turn sends nothing.
  if (!opts.researchCacheOnly && ctx.primaryResumeDocId && !app.resume_doc_id) {
    try { setApplicationResumeIfEmpty(applicationId, ctx.primaryResumeDocId); } catch (e) { console.warn('[resume] could not record resume sent', String(e)); }
  }
  return ctx;
}

/**
 * Same hydration for the surface that has no application row: the standalone
 * cover-letter studio in the vault.
 */
export async function hydrateStandaloneLetterContext(
  input: StandaloneInput,
  opts: HydrateOpts = {},
): Promise<HydratedLetterContext> {
  return hydrate(input, opts);
}

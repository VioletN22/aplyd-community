// Shared Claude prompt-building for cover letters, the profile seed and company
// research, so every letter draws on the SAME profile: answer bank + portfolio
// links + resume + the learned voice profile. (The file name is historical.)
import fs from 'fs';
import { app } from 'electron';
import {
  getAnswerBank, getDocuments, getPortfolioLinks, getSetting,
} from './database';
import type { AnswerBankEntry } from '../shared/types';
import { acceptLanguage, displayLocale } from '../shared/locale';
import { safeFetch } from './safe-fetch';

// The structured profile (identity / work-auth / salary / locations / links),
// stored as a JSON object in app_settings under 'profile'. Rendered as facts.
export function getProfile(): Record<string, string> {
  try { const raw = getSetting('profile'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
export function factsBlock(bank: AnswerBankEntry[] = getAnswerBank()): string {
  return bank.map((e) => `- ${e.label}${e.context ? ` (${e.context})` : ''}: ${e.value}`).join('\n') || '(none yet)';
}

export function portfolioBlock(): string {
  const links = getPortfolioLinks();
  return links.length ? links.map((p) => `- ${p.label}: ${p.url}`).join('\n') : '(none)';
}

export function resumeText(): string {
  const resume = getDocuments().find((d) => d.isDefault && d.tags.includes('resume'))
    || getDocuments().find((d) => d.tags.includes('resume'));
  if (resume && /\.(txt|md|markdown)$/i.test(resume.filePath) && fs.existsSync(resume.filePath)) {
    try { return fs.readFileSync(resume.filePath, 'utf-8').slice(0, 8000); } catch { /* ignore */ }
  }
  return '';
}

// Both fetchers go through safeFetch, which allows only public http(s)
// addresses and checks the address the socket really connects to, on every
// redirect hop.

// The app's own name and version, so a site owner can tell what fetched the page.
function userAgent(): string {
  try { return `AplydCommunity/${app.getVersion()}`; } catch { return 'AplydCommunity'; }
}

// Best-effort fetch of a portfolio page, stripped to text, so Claude can ground
// a letter in the actual site content. Short timeout; failure is non-fatal.
export async function fetchUrlText(url: string, timeoutMs = 6000, _depth = 0, maxChars = 3000): Promise<string> {
  const data = await safeFetch(url, { timeoutMs, maxBytes: 200000, headers: { 'User-Agent': userAgent() } });
  return data
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

// Raw fetch (HTML kept), used to parse search-result links. Browser-like UA so
// search endpoints don't 403 us. Caps the body and never rejects.
export async function fetchUrlRaw(url: string, timeoutMs = 7000): Promise<string> {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept-Language': acceptLanguage(displayLocale()) };
  return safeFetch(url, { timeoutMs, maxBytes: 400000, headers });
}

// LIVE company research for cover letters: web-search the company and read a couple
// of their own pages, so the letter can speak to what they do, recent work, this
// year's goals, and values. Best-effort + capped; returns '' on failure (the letter
// then leans on the job posting + the model's own knowledge).
export async function companyResearch(company: string, jobUrl?: string): Promise<string> {
  const name = (company || '').trim();
  if (!name) return '';
  const year = new Date().getFullYear();
  const enc = (s: string) => encodeURIComponent(s);
  const pickLinks = (html: string): string[] => {
    const urls: string[] = [];
    const re = /uddg=([^"&]+)/g; // DuckDuckGo HTML wraps results as /l/?uddg=<encoded>
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && urls.length < 30) {
      try { const u = decodeURIComponent(m[1]); if (/^https?:\/\//.test(u)) urls.push(u); } catch { /* skip */ }
    }
    return urls;
  };
  const junk = /duckduckgo|google\.|bing\.|facebook\.|twitter\.|x\.com|instagram\.|youtube\.|wikipedia\.|glassdoor\.|indeed\.|linkedin\.com\/(?!company)|crunchbase\.|bloomberg\.|zoominfo/i;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const score = (u: string) => {
    let s = 0;
    try {
      const host = new URL(u).host.toLowerCase();
      if (host.replace(/[^a-z0-9]/g, '').includes(slug.slice(0, 8))) s += 5; // their own domain
    } catch { /* ignore */ }
    if (/about|values|mission|culture|careers|company|who-we-are|annual|investor|sustainab|strateg/i.test(u)) s += 2;
    return s;
  };
  // two angles: who they are / values, and this year's direction
  const queries = [name + ' company about values mission', name + ' ' + year + ' strategy goals annual report'];
  const candidates: string[] = [];
  for (const q of queries) {
    const html = await fetchUrlRaw('https://html.duckduckgo.com/html/?q=' + enc(q)).catch(() => '');
    for (const u of pickLinks(html)) if (!junk.test(u) && !candidates.includes(u)) candidates.push(u);
  }
  // prefer their own / about-ish pages; always consider the job's own host too
  if (jobUrl) { try { candidates.unshift(new URL(jobUrl).origin); } catch { /* ignore */ } }
  const ranked = candidates.sort((a, b) => score(b) - score(a)).slice(0, 3);
  const chunks: string[] = [];
  for (const u of ranked) {
    const t = await fetchUrlText(u, 7000).catch(() => '');
    if (t && t.length > 120) chunks.push('SOURCE ' + u + ':\n' + t.slice(0, 1600));
    if (chunks.length >= 2) break;
  }
  return chunks.join('\n\n').slice(0, 3500);
}

// Pull a short text snapshot of the default/first portfolio site for grounding.
export async function portfolioSnapshot(): Promise<string> {
  const links = getPortfolioLinks();
  if (!links.length) return '';
  const text = await fetchUrlText(links[0].url);
  return text ? `PORTFOLIO SITE CONTENT (${links[0].url}):\n${text}\n` : '';
}

// Scan ALL portfolio links (up to a few) so a cover letter can reference real work.
export async function portfolioSnapshotAll(): Promise<string> {
  const links = getPortfolioLinks();
  if (!links.length) return '';
  const parts: string[] = [];
  for (const l of links.slice(0, 3)) {
    const t = await fetchUrlText(l.url);
    if (t) parts.push(`PORTFOLIO (${l.label}: ${l.url}):\n${t}`);
  }
  return parts.join('\n\n');
}

// Full resume text: reads .txt/.md directly, extracts .pdf via pdf-parse.
// This is what gives cover letters real grounding (the sync resumeText() above
// only handled plain text).
export async function extractResumeText(): Promise<string> {
  const resume = getDocuments().find((d) => d.isDefault && d.tags.includes('resume'))
    || getDocuments().find((d) => d.tags.includes('resume'));
  if (!resume) return '';
  return extractResumeTextFrom(resume.filePath);
}

/** Text of one resume file (PDF or plain text), capped per file. */
export async function extractResumeTextFrom(filePath: string): Promise<string> {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    if (/\.(txt|md|markdown)$/i.test(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').slice(0, 9000);
    }
    if (/\.pdf$/i.test(filePath)) {
      const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
      const data = await pdfParse(fs.readFileSync(filePath));
      return (data.text || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 9000);
    }
  } catch { /* ignore, fall back to facts block */ }
  return '';
}

// ── Letter engine: pure, testable prompt builders ────────────────────────────
// Everything a letter prompt needs is hydrated by the caller (Task 3's
// letter-context.ts). These builders do NO database and NO network access, so the
// exact prompt text is pinned by src/main/__tests__/prompts.test.ts.
export interface LetterContext {
  company: string; role: string;
  rawJobText?: string;          // full posting text, capped at JOB_TEXT_CAP inside
  jobSummary?: string;          // legacy fallback when rawJobText is absent
  researchText?: string; portfolioText?: string; resumeText?: string;
  profile: Record<string, string>;               // app_settings.profile parsed
  facts: { label: string; value: string }[];
  voice: { follow: string[]; avoid: string[] };  // distilled voice profile
  exemplars: string[];          // up to 3 kept letter bodies
}

const JOB_TEXT_CAP = 6000;
const RESEARCH_CAP = 3500;
// Room for the best-fit variant in full plus the other variants as support.
const RESUME_CAP = 26000;
const PORTFOLIO_CAP = 4000;
const EXEMPLAR_CAP = 1800;
// Salary and notice period never belong in a cover letter, so they never enter the
// prompt at all: dropping the keys is stronger than asking the model to stay quiet.
const LETTER_EXCLUDE = /salary|notice/i;

// Strict output contracts (fed to the CLI as --json-schema by Task 3's call sites).
export const LETTER_SCHEMA = {
  type: 'object',
  properties: { letter: { type: 'string' }, note: { type: 'string' } },
  required: ['letter', 'note'],
  additionalProperties: false,
};

export const STUDIO_SCHEMA = {
  type: 'object',
  properties: {
    letter: { type: 'string' },
    note: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['letter', 'note', 'questions'],
  additionalProperties: false,
};

export const DISTILL_SCHEMA = {
  type: 'object',
  properties: {
    follow: { type: 'array', items: { type: 'string' } },
    avoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['follow', 'avoid'],
  additionalProperties: false,
};

// The locked template. Every letter path (generate, refine, studio)
// includes this verbatim, so the shape of a letter is decided in exactly one place.
export const LETTER_RULES = `FORMAT, exact, every letter:
- First line of the letter: "Dear Hiring Manager," (if the research names a specific hiring contact, "Dear <Name>," instead).
- Then 3 to 4 tight paragraphs. Specific, genuine, no corporate cliches.
- Then the sign-off block, exactly these three lines:
Sincerely,
<full name>
<email> | <phone>
  (one space, pipe, space as the separator; take name, email, phone from USER PROFILE)
HARD RULES:
- Never mention salary, notice period, or work authorization unless the user's feedback for this letter explicitly asks.
- never use em dashes anywhere; use commas, colons, or parentheses.
- Avoid AI-tell phrasing: "delve", "tapestry", "testament to", "landscape" (figurative), "leverage" as a verb, "I am excited to apply", "aligns perfectly", "passionate about the intersection".
- Ground every claim in the USER RESUME, KNOWN FACTS, PORTFOLIO, or the posting. Invent nothing.
- Never state a duration of experience ("N years of X") unless that exact figure appears in the material.
- Never state or imply a length of experience in any wording ("over the past two years", "several years"); the resume dates speak for themselves.
- Output only the JSON requested.`;

// How to fit the user's material to a posting. Shared by the draft paths.
const FIT_METHOD =
  `METHOD, before writing: (1) list to yourself the 4 to 6 things this posting weighs most (hard requirements, then responsibilities). ` +
  `(2) For each, find the strongest real evidence across ALL the resume variants, the facts and the portfolio, preferring concrete systems, numbers and outcomes over tool lists. ` +
  `(3) Lead with the evidence that answers the heaviest requirements, and frame each piece in the posting's own vocabulary when that framing is accurate. ` +
  `(4) Where the posting asks for something the material does not show, do not claim it and do not dwell on the gap; at most one short line on how the closest real experience transfers. ` +
  `Leave out experience that does not serve this role.\n\n`;

const LETTER_OUTPUT =
  `OUTPUT: respond with ONLY valid JSON, no markdown fences: {"letter":"<the full cover letter body, ready to send>","note":"<a short message to the user: a clarifying question, a heads-up about any placeholder, or what you changed; empty string if nothing>"}. ` +
  `The "letter" field must ALWAYS contain a complete cover letter; questions and commentary go ONLY in "note". ` +
  `If a contact detail is genuinely missing from USER PROFILE, still write the COMPLETE letter (use a clear placeholder such as [your phone]) and ask for it in "note".`;

// Profile and facts, minus anything that would put money or notice period in a letter.
function letterProfileBlock(profile: Record<string, string>): string {
  const lines = Object.entries(profile || {})
    .filter(([k, v]) => v != null && String(v).trim() && !LETTER_EXCLUDE.test(k))
    .map(([k, v]) => `- ${k}: ${String(v).trim()}`);
  return lines.length ? lines.join('\n') : '(none yet)';
}

function letterFactsBlock(facts: { label: string; value: string }[]): string {
  const lines = (facts || [])
    .filter((f) => f && f.label && String(f.value ?? '').trim() && !LETTER_EXCLUDE.test(f.label))
    .map((f) => `- ${f.label}: ${String(f.value).trim()}`);
  return lines.length ? lines.join('\n') : '(none yet)';
}

function letterVoiceBlock(voice: { follow: string[]; avoid: string[] }): string {
  const fmt = (xs: string[]) => (xs || []).map((x) => String(x).trim()).filter(Boolean).map((x) => `- ${x}`).join('\n') || '(none yet)';
  return `WRITING STYLE TO FOLLOW:\n${fmt(voice?.follow || [])}\nAVOID:\n${fmt(voice?.avoid || [])}\n\n`;
}

// Few-shot voice: real letters the user kept. Framed hard as VOICE, never as content,
// so the model copies the cadence and not the claims.
function exemplarBlock(exemplars: string[]): string {
  const kept = (exemplars || []).map((e) => String(e || '').trim()).filter(Boolean).slice(0, 3);
  if (!kept.length) return '';
  const body = kept.map((e, i) => `--- kept letter ${i + 1} ---\n${e.slice(0, EXEMPLAR_CAP)}`).join('\n\n');
  return `LETTERS THE USER KEPT (match their voice, not their content):\n${body}\n\n`;
}

function jobBlock(ctx: LetterContext): string {
  const text = String(ctx.rawJobText || ctx.jobSummary || '').trim();
  return text ? `JOB POSTING:\n${text.slice(0, JOB_TEXT_CAP)}\n\n` : '';
}

function researchBlock(ctx: LetterContext): string {
  const text = String(ctx.researchText || '').trim();
  if (!text) return '';
  return (
    `COMPANY RESEARCH (pulled from the web, may be imperfect). FIRST verify it actually describes the SAME company as the JOB POSTING above: same line of business, consistent with the role and location. ` +
    `If it looks like a different company (a same-named business in another country or industry), IGNORE this research entirely and write only from the posting plus the user's experience. ` +
    `If it does match, weave in 1 or 2 concrete, verifiable details (what they do, this year's direction, their values). Never fabricate or overstate.\n${text.slice(0, RESEARCH_CAP)}\n\n`
  );
}

// The shared body of every letter prompt: the role, the posting, and everything
// the app knows about the user, in one fixed order.
function letterContextBlocks(ctx: LetterContext): string {
  const resume = String(ctx.resumeText || '').trim();
  const portfolio = String(ctx.portfolioText || '').trim();
  return (
    `ROLE: ${ctx.role}\nCOMPANY: ${ctx.company}\n\n` +
    jobBlock(ctx) +
    researchBlock(ctx) +
    `USER PROFILE (identity and contact for the sign-off; do not restate salary, notice period, or work authorization in the body):\n${letterProfileBlock(ctx.profile)}\n\n` +
    (resume ? `USER RESUME:\n${resume.slice(0, RESUME_CAP)}\n\n` : '') +
    (portfolio ? `PORTFOLIO:\n${portfolio.slice(0, PORTFOLIO_CAP)}\n\n` : '') +
    `KNOWN FACTS (answer bank):\n${letterFactsBlock(ctx.facts)}\n\n` +
    letterVoiceBlock(ctx.voice) +
    exemplarBlock(ctx.exemplars)
  );
}

function buildCoverLetterPrompt(ctx: LetterContext): string {
  return (
    `Write a cover letter for the user, first person, tailored to THIS specific role. ` +
    `Read what the posting actually wants, then match the user's real experience to those needs: lead with the overlaps that matter most and connect them to where the company is heading.\n\n` +
    FIT_METHOD +
    letterContextBlocks(ctx) +
    LETTER_RULES + '\n\n' +
    LETTER_OUTPUT
  );
}

function buildRefineCoverLetterPrompt(ctx: LetterContext & { body: string; feedback: string }): string {
  return (
    `Revise the cover letter below using the user's feedback. Change ONLY what the feedback asks for; keep every other sentence exactly as it is so the edit is surgical. ` +
    `If the feedback asks for content, substantiate it from the material below rather than inventing it.\n\n` +
    letterContextBlocks(ctx) +
    `CURRENT DRAFT:\n${ctx.body}\n\n` +
    `USER FEEDBACK:\n${ctx.feedback}\n\n` +
    LETTER_RULES + '\n\n' +
    LETTER_OUTPUT
  );
}

function buildCoverLetterStudioPrompt(ctx: LetterContext): string {
  return (
    `Write a cover letter for the user, first person, tailored to THIS role, grounded only in the material below.\n\n` +
    FIT_METHOD +
    letterContextBlocks(ctx) +
    LETTER_RULES + '\n\n' +
    `ALSO: if the job or company emphasises something important that the user's material does NOT clearly cover (a specific tool, domain, or experience worth addressing), include up to 2 short clarifying questions whose answers would make the letter stronger. If nothing is missing, return an empty list.\n\n` +
    `OUTPUT: respond with ONLY valid JSON, no markdown fences: {"letter":"<the full cover letter body, ready to send>","note":"<a short message to the user; empty string if nothing>","questions":["<question 1>","<question 2>"]}. ` +
    `The "letter" field must ALWAYS contain a complete cover letter; commentary goes in "note" and clarifying questions go in "questions".`
  );
}

// One cheap pass that turns the pile of raw voice notes (typed fast, typos and all)
// into a clean {follow, avoid} profile. Prompts consume the distilled profile only,
// which is what quarantines one-off content requests and pasted model output.
export function distillVoicePrompt(rawNotes: string[], voiceGuideText: string): string {
  const notes = (rawNotes || [])
    .map((n) => String(n ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((n) => `- ${n}`);
  const guide = String(voiceGuideText || '').trim().slice(0, 4000);
  return (
    `Distill the user's raw feedback notes into a clean writing profile for their job application letters.\n\n` +
    `RAW NOTES (typed quickly over time, typos and all):\n${notes.join('\n') || '(none yet)'}\n\n` +
    (guide ? `VOICE GUIDE (an authored reference for how this person writes):\n${guide}\n\n` : '') +
    `HOW TO CLASSIFY:\n` +
    `- Read each note and decide whether it states something the writing should DO (goes in "follow") or something the writing should NOT do (goes in "avoid"). A note phrased as a complaint ("too stiff", "stop saying passionate") becomes an avoid rule.\n` +
    `- Translate typos, shorthand, and half sentences into one clean, specific, reusable rule each. Keep the user's intent exactly; do not soften it.\n` +
    `- DROP any note that is a one-off content request about a single letter (for example "mention my php work at Acme"), a question to the assistant, or leaked model output pasted back in. None of those are style rules.\n` +
    `- Merge duplicates. Keep each rule under 15 words. At most 12 rules per list.\n` +
    `- If a list ends up empty, return an empty array for it.\n\n` +
    `OUTPUT: respond with ONLY valid JSON, no markdown fences: {"follow":["<rule>"],"avoid":["<rule>"]}.`
  );
}

// ── Public letter prompt API ─────────────────────────────────────────────────
// Callers hydrate a LetterContext first (see letter-context.ts). These builders
// are pure: same context in, same prompt out.
export function coverLetterPrompt(ctx: LetterContext): string {
  return buildCoverLetterPrompt(ctx);
}

export function refineCoverLetterPrompt(ctx: LetterContext & { body: string; feedback: string }): string {
  return buildRefineCoverLetterPrompt(ctx);
}

export function coverLetterStudioPrompt(ctx: LetterContext): string {
  return buildCoverLetterStudioPrompt(ctx);
}

// Parse the {letter, note} JSON; tolerate a plain-text letter (treat as letter, no note).
// With --json-schema on the letter paths this should always be the strict branch; the
// lenient branch survives for the streaming path and logs when the template slipped.
export function parseCoverLetter(out: string): { letter: string; note: string } {
  const raw = (out || '').trim();
  const guard = (r: { letter: string; note: string }) => {
    const first = (r.letter.split('\n')[0] || '').trim();
    if (r.letter && !first.startsWith('Dear ')) {
      console.warn('[cover] parsed letter does not open with a "Dear " greeting:', first.slice(0, 80));
    }
    return r;
  };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      if (typeof j.letter === 'string' && j.letter.trim()) return guard({ letter: j.letter.trim(), note: String(j.note || '').trim() });
    }
  } catch { /* fall through to plain text */ }
  // not JSON, so assume the whole thing is the letter (back-compat and safety)
  return guard({ letter: raw.replace(/^```[a-z]*\n?|\n?```$/g, '').trim(), note: '' });
}

// Seed the structured profile from the resume + known facts. Returns a flat
// map of standard application fields. Only fields the resume/facts actually
// support are included (no guessing personal/legal details).
export function profileSeedPrompt(): string {
  const resume = resumeText();
  return (
    `Extract a structured job-application profile from the user's materials below.\n` +
    `Return ONLY JSON: a flat object whose keys are standard application fields and whose values are the user's answers. Use these keys where the materials support them: ` +
    `"Legal first name", "Legal last name", "Preferred name", "Full name", "Email", "Phone", "Location", "Work authorization", "Require visa sponsorship", "Years of experience", "Current title", "LinkedIn", "GitHub", "Portfolio", "Salary expectation", "Notice period", "Open to remote".\n` +
    `For names: "Legal first name"/"Legal last name" are the real/legal name as on official ID; "Preferred name" is the name the person goes by if different (e.g. a chosen first name). If the materials only show one name, set the legal fields and leave Preferred name out.\n` +
    `Omit any key you cannot fill from the materials (do not invent). Keep values short.\n\n` +
    (resume ? `RESUME:\n${resume.slice(0, 6000)}\n\n` : '') +
    `KNOWN FACTS:\n${factsBlock()}\n\nPORTFOLIO:\n${portfolioBlock()}`
  );
}
export function parseProfileSeed(out: string): Record<string, string> {
  try {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(j)) {
        if (v != null && String(v).trim()) clean[k] = String(v).trim().slice(0, 200);
      }
      return clean;
    }
  } catch { /* fall through */ }
  return {};
}

// Pick which resume variant best fits a job (letter-context.ts, for letters, the
// assistant and the fit score), when the locker holds several variants.
export function resumePickPrompt(variants: { label: string; focus: string }[], job: { title?: string; jobText?: string }): string {
  const list = variants.map((v, i) => `${i}: "${v.label}"${v.focus ? `, focus: ${v.focus}` : ''}`).join('\n');
  return (
    `Pick which resume variant best fits this job. Choose the one whose focus most matches the role/company.\n\n` +
    `RESUME VARIANTS:\n${list}\n\n` +
    `JOB:\nTitle: ${job.title || ''}\n${job.jobText ? 'Description: ' + String(job.jobText).slice(0, 3000) : ''}\n\n` +
    `Respond ONLY with JSON: {"index": <0-based index of the best variant>}.`
  );
}

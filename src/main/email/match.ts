// Which application is this email about? Pure string matching first: the
// company name, normalised, against the sender's display name, the sender's
// domain, the subject and the start of the body. What comes out is a ranked
// shortlist the classifier then chooses from, so the model only ever sees them
// applications that plausibly fit rather than all of them.

import { domainOf, ATS_SENDERS, isAtsSender, parseJobBoardSubject } from './prefilter';

/** The slice of an application row matching needs. */
export interface AppLite {
  id: string;
  company: string;
  job_title: string;
  current_stage: string;
  created_at: string;
}

export interface MatchInput {
  fromAddress: string;
  fromName: string;
  subject: string;
  body: string;
}

export interface RankedCandidate {
  app: AppLite;
  score: number;
}

/** Legal suffixes and filler that differ between how the user typed it and how they sign it. */
const COMPANY_NOISE = new Set([
  'pty', 'ltd', 'limited', 'group', 'australia', 'australian', 'inc', 'incorporated',
  'the', 'co', 'corp', 'corporation', 'plc', 'llc', 'holdings', 'au',
]);

/** Lowercase words, punctuation gone, whitespace collapsed. */
export function normaliseText(s: string): string {
  return (s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Acme Group Pty. Ltd." and "ACME Australia" both become "acme". */
export function normaliseCompany(name: string): string {
  const words = normaliseText(name).split(' ').filter((w) => w && !COMPANY_NOISE.has(w));
  return words.join(' ');
}

/** Whole-phrase containment on normalised text, so "ing" never matches "billing". */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return (' ' + haystack + ' ').includes(' ' + phrase + ' ');
}

/** Domain tokens that name the sender's own organisation, ATS and mail hosts removed. */
function orgTokens(fromAddress: string): string[] {
  const generic = new Set(['com', 'au', 'net', 'org', 'io', 'co', 'mail', 'email', 'jobs', 'careers', 'hr', 'talent', 'recruiting', 'noreply', 'no', 'reply', 'www', 'gov', 'edu']);
  return domainOf(fromAddress)
    .split(/[.-]/)
    .filter((t) => t && !generic.has(t) && !/^wd\d+$/.test(t) && !ATS_SENDERS.some((a) => t.startsWith(a) || t.startsWith('my' + a)));
}

/** Whole-phrase containment either way between two normalised names, or equality. */
function sameRole(a: string, b: string): boolean {
  const x = normaliseText(a); const y = normaliseText(b);
  if (!x || !y) return false;
  return x === y || containsPhrase(x, y) || containsPhrase(y, x);
}

/**
 * A templated board subject names the employer and role outright, so it beats
 * every other clue: the applications at that company (exact normalised name,
 * or one name inside the other, as findCompanyMatch), narrowed to the ones
 * whose role fits when any does. Names elsewhere in the email are ignored,
 * because SEEK lists other employers' jobs under every update. Null when the
 * subject is not a board template or names a company the user has no row for, so
 * the ordinary scoring runs instead.
 */
function rankByBoardSubject(subject: string, apps: AppLite[], limit: number): RankedCandidate[] | null {
  const board = parseJobBoardSubject(subject);
  if (!board) return null;
  const want = normaliseCompany(board.company);
  if (want.replace(/ /g, '').length < 2) return null;
  const ranked: RankedCandidate[] = [];
  for (const app of apps) {
    const have = normaliseCompany(app.company);
    let score = 0;
    if (have === want) score = 10;
    else if (have.replace(/ /g, '').length >= 3 && want.replace(/ /g, '').length >= 3 && (containsPhrase(have, want) || containsPhrase(want, have))) score = 8;
    if (!score) continue;
    if (sameRole(app.job_title, board.role)) score += 3;
    ranked.push({ app, score });
  }
  if (!ranked.length) return null;
  const roleFits = ranked.filter((r) => sameRole(r.app.job_title, board.role));
  return (roleFits.length ? roleFits : ranked)
    .sort((a, b) => b.score - a.score || b.app.created_at.localeCompare(a.app.created_at))
    .slice(0, limit);
}

/**
 * Score every application against the email and return the plausible ones,
 * best first. Company evidence carries the score; the role only breaks ties
 * between rows that already match on company (the user often applies to several
 * roles at one employer). A job board's templated subject, when there is one,
 * decides on its own (rankByBoardSubject).
 */
export function rankCandidates(email: MatchInput, apps: AppLite[], limit = 5): RankedCandidate[] {
  const board = rankByBoardSubject(email.subject, apps, limit);
  if (board) return board;
  const name = normaliseText(email.fromName);
  const subject = normaliseText(email.subject);
  const body = normaliseText((email.body || '').slice(0, 2000));
  const tokens = orgTokens(email.fromAddress);
  const domainJoined = tokens.join('');

  const ranked: RankedCandidate[] = [];
  for (const app of apps) {
    const company = normaliseCompany(app.company);
    const compact = company.replace(/ /g, '');
    if (compact.length < 2) continue;

    let score = 0;
    if (tokens.includes(compact) || (compact.length >= 4 && domainJoined.includes(compact))) score += 5;
    if (containsPhrase(name, company)) score += 4;
    if (containsPhrase(subject, company)) score += 4;
    if (containsPhrase(body, company)) score += 2;
    if (score === 0) continue;

    const role = normaliseText(app.job_title);
    if (role && containsPhrase(subject, role)) score += 2;
    else if (role && containsPhrase(body, role)) score += 1;

    ranked.push({ app, score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || b.app.created_at.localeCompare(a.app.created_at))
    .slice(0, limit);
}

const DAY_MS = 86_400_000;

/**
 * With no name match, the applications the email could still be about: applied
 * within `windowDays` before it was sent (a day of grace after, for clock skew),
 * nearest first, capped so the prompt stays small.
 */
export function plausibleApps(apps: AppLite[], sentAt: string, windowDays = 120, cap = 40): AppLite[] {
  const sent = new Date(sentAt).getTime();
  if (!Number.isFinite(sent)) return apps.slice(0, cap);
  return apps
    .filter((a) => {
      const t = new Date(a.created_at).getTime();
      return Number.isFinite(t) && t <= sent + DAY_MS && t >= sent - windowDays * DAY_MS;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, cap);
}

/** Words in a sender's display name that are about the mailbox, not the company. */
const SENDER_NOISE = /\b(careers?|recruit(ment|ing|er|ers)?|talent( acquisition)?|hiring|people( and culture| & culture)?|hr|human resources|team|jobs?|no[- ]?reply|notifications?|via .*)\b/gi;

/**
 * Best guess at the company behind an email when the model gave none: the
 * sender's display name with the mailbox words taken out ("Canva Careers" ->
 * "Canva"), else the organisation part of the domain ("hr@example.com"
 * -> "Example"). ATS and mail-host domains say nothing, so they give ''.
 */
export function companyFromSender(fromName: string, fromAddress: string): string {
  // "SEEK Applications", "LinkedIn": the board's own mailbox, never the employer.
  if (/\b(seek|linkedin|indeed|jora)\b/i.test(fromName || '') && isAtsSender(fromAddress)) return '';
  const fromDisplay = String(fromName || '').replace(/["<>]/g, ' ').replace(SENDER_NOISE, ' ').replace(/[|,:@-]+\s*$/g, '').replace(/\s+/g, ' ').trim();
  // A display name that is just a person ("Jane Smith") still beats nothing only when there is no domain to go on.
  // An ATS or board domain names the software, not the employer; mail hosts name no one.
  const tokens = isAtsSender(fromAddress) || /greenhouse|lever|workday|ashby|workable/i.test(domainOf(fromAddress)) ? [] : orgTokens(fromAddress)
    .filter((t) => t.length >= 3 && !['gmail', 'googlemail', 'outlook', 'hotmail', 'yahoo', 'icloud', 'live', 'bigpond', 'proton', 'protonmail'].includes(t));
  const fromDomain = tokens[0] ? tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1) : '';
  if (fromDisplay && fromDisplay.length >= 2 && !/@/.test(fromDisplay)) {
    // Prefer the domain when the display name looks like a person's name and the domain is the company's own.
    if (fromDomain && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(fromDisplay) && !normaliseText(fromDisplay).includes(fromDomain.toLowerCase())) return fromDomain;
    return fromDisplay;
  }
  return fromDomain;
}

/**
 * The existing application for a company name, by normalised name: exact
 * first, then whole-phrase containment either way ("Globex" and
 * "Globex Media"). Newest wins when there are several rows for it.
 */
export function findCompanyMatch(company: string, apps: AppLite[]): AppLite | null {
  const want = normaliseCompany(company);
  if (want.replace(/ /g, '').length < 2) return null;
  const newest = (xs: AppLite[]) => xs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
  const exact = apps.filter((a) => normaliseCompany(a.company) === want);
  if (exact.length) return newest(exact);
  const loose = apps.filter((a) => {
    const have = normaliseCompany(a.company);
    if (have.replace(/ /g, '').length < 3) return false;
    return containsPhrase(have, want) || containsPhrase(want, have);
  });
  return newest(loose);
}

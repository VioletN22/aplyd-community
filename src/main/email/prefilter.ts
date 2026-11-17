// Which emails are worth a closer look. Pure and envelope-only (sender and
// subject), because it runs on every message in the mailbox before any body is
// downloaded: on a large Gmail that is the difference between a scan that
// finishes and one that does not.
//
// Nothing here logs, and nothing it returns carries message content.

/** Applicant tracking systems and job boards whose mail is about applications. */
export const ATS_SENDERS = [
  'workday', 'myworkdayjobs', 'greenhouse', 'lever', 'smartrecruiters', 'ashbyhq',
  'workable', 'successfactors', 'pageuppeople', 'livehire', 'jobadder', 'seek',
  'indeed', 'linkedin',
];

/** Subject words that mean an application moved, whoever sent it. */
const SUBJECT_KEYWORDS = [
  'application', 'applying', 'applied', 'interview', 'unfortunately',
  'not progressing', 'not be progressing', 'next steps', 'assessment', 'offer',
  'candidacy', 'your submission',
];

/** Job alerts, recommendations and newsletters: the boards' marketing, not their applications. */
const NOISE = [
  'jobs you may', 'job alert', 'recommended jobs', 'recommended for you', 'new jobs',
  'jobs for you', 'jobs near', 'job matches', 'digest', 'weekly', 'newsletter',
  'is hiring', 'are hiring', 'people viewed', 'viewed your profile', 'top job picks',
  'webinar', 'unsubscribe',
];

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase().trim() : '';
}

/**
 * Does the sender's domain belong to a known ATS or board? Matched per domain
 * token (split on dots and dashes) so us.greenhouse-mail.io and myworkday.com
 * count but clever.com does not. LinkedIn sends far more than job mail, so only
 * its jobs mailboxes (jobs-noreply@) count as a sender match.
 */
export function isAtsSender(fromAddress: string): boolean {
  const domain = domainOf(fromAddress);
  if (!domain) return false;
  const tokens = domain.split(/[.-]/);
  const hit = ATS_SENDERS.find((name) => tokens.some((t) => t.startsWith(name) || t.startsWith('my' + name)));
  if (!hit) return false;
  if (hit === 'linkedin') return /jobs/i.test(fromAddress.slice(0, fromAddress.lastIndexOf('@')));
  return true;
}

export interface PrefilterInput {
  fromAddress: string;
  fromName?: string;
  subject: string;
}

export interface PrefilterVerdict {
  candidate: boolean;
  /** A short code, never message content: 'own', 'ats', 'keyword', 'noise' or 'none'. */
  reason: 'own' | 'ats' | 'keyword' | 'noise' | 'none';
}

/** Lowercased, trimmed, deduped addresses; anything without an @ dropped. */
export function normaliseAddresses(list: (string | null | undefined)[]): string[] {
  return Array.from(new Set(list.map((a) => String(a || '').trim().toLowerCase()).filter((a) => a.includes('@'))));
}

/** Did the user send this themselves (a reply, a forward, a note to self)? Case-insensitive, exact address. */
export function isOwnAddress(fromAddress: string, own: string[] = []): boolean {
  const from = String(fromAddress || '').trim().toLowerCase();
  if (!from) return false;
  return own.some((a) => String(a || '').trim().toLowerCase() === from);
}

export interface BoardSubject { company: string; role: string }

/**
 * The templated subjects job boards and ATSs send about one application, read
 * into the employer and the role (Gmail can hand back a folded subject with its
 * CRLF still in it, so whitespace is collapsed first):
 *
 *   SEEK:             "Application update for <Role> at <Company>"
 *   SEEK:             "<Company> has responded to your application for <Role>"
 *   SmartRecruiters:  "An update on your application with <Company> for <Role>"
 *
 * "at" splits on its last occurrence, since a role can hold one ("Sales
 * Assistant at Night") far more often than an employer does. null for anything
 * else: the subject alone is not enough to name an application.
 */
export function parseJobBoardSubject(subject: string): BoardSubject | null {
  const s = String(subject || '').replace(/\s+/g, ' ').trim().replace(/^((re|fwd?|fw)\s*:\s*)+/i, '');
  const clean = (x: string) => x.replace(/^["'\s]+|["'\s.!]+$/g, '').trim();
  const out = (company: string, role: string): BoardSubject | null => {
    const c = clean(company); const r = clean(role);
    return c && r ? { company: c, role: r } : null;
  };
  let m = s.match(/^application update for (.+) at (.+)$/i);
  if (m) {
    const at = s.toLowerCase().lastIndexOf(' at ');
    return out(s.slice(at + 4), s.slice('application update for '.length, at));
  }
  m = s.match(/^(.+?) has responded to your application for (.+)$/i);
  if (m) return out(m[1], m[2]);
  m = s.match(/^an update on your application with (.+?) for (.+)$/i);
  if (m) return out(m[1], m[2]);
  return null;
}

/**
 * `own`: the user's own addresses (connected accounts, the profile email).
 * The user's own sent mail is never a company writing back, however job-like
 * its subject ("Re: Team Fit Interview"), so it is dropped before anything else.
 */
export function prefilter(input: PrefilterInput, own: string[] = []): PrefilterVerdict {
  if (isOwnAddress(input.fromAddress, own)) return { candidate: false, reason: 'own' };
  const subject = (input.subject || '').toLowerCase();
  const name = (input.fromName || '').toLowerCase();
  // An application update in a board's own template is never marketing, even
  // when the role happens to hold a noise word ("Weekly Payroll Officer").
  if (parseJobBoardSubject(input.subject)) return { candidate: true, reason: isAtsSender(input.fromAddress || '') ? 'ats' : 'keyword' };
  if (NOISE.some((n) => subject.includes(n) || name.includes(n))) return { candidate: false, reason: 'noise' };
  if (isAtsSender(input.fromAddress || '')) return { candidate: true, reason: 'ats' };
  if (SUBJECT_KEYWORDS.some((k) => subject.includes(k))) return { candidate: true, reason: 'keyword' };
  return { candidate: false, reason: 'none' };
}

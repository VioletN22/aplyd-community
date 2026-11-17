// "What's working" and the Today view. Two layers: pure aggregation over plain
// rows (unit tested), and thin SQL loaders written against the structural
// MigrationDb handle, so the tests run them on node:sqlite in memory.
import type { MigrationDb } from './database';
import { silentDays, type OutcomeRow, type OutcomeStats, type TodayData } from '../shared/types';
import { listOpenActionItems, toTodayActionItems } from './action-items';
import { gmailSearchUrl } from './gmail-link';
import { sourceFamily } from '../shared/source';

export { gmailSearchUrl };

/** Outcome tables stay hidden until this many applications have a signal. */
export const OUTCOME_MIN = 10;
/** Email kinds that count as the company replying. */
export const REPLY_KINDS = ['rejection', 'interview', 'assessment', 'offer'] as const;
/**
 * Stages past applied that mean the company answered (an assessment invite is
 * an answer). withdrawn is their own move, not a reply, so it is not one of them.
 */
export const REPLY_STAGES = new Set(['assessment', 'take_home', 'assessed', 'phone_screen', 'interview', 'offer', 'rejected']);
/** Stages that mean the user got through a round: everything that answered except rejected. */
export const PROGRESS_STAGES = new Set([...REPLY_STAGES].filter((s) => s !== 'rejected'));
/** Email kinds that mean the user got through a round. */
export const PROGRESS_KINDS = ['interview', 'assessment', 'offer'] as const;

// ── role family ──────────────────────────────────────────────────────────────
export { ROLE_FAMILIES, roleFamily, type RoleFamily } from '../shared/role-family';
import { ROLE_FAMILIES, roleFamily } from '../shared/role-family';

const FAMILY_LABEL: Record<string, string> = Object.fromEntries(ROLE_FAMILIES.map((f) => [f.key, f.label]));

// ── outcomes ─────────────────────────────────────────────────────────────────
export interface OutcomeInput {
  id: string;
  job_title: string;
  job_source: string | null;
  current_stage: string;
  resume_doc_id: string | null;
  /** Label of that locker document; null when unset or since deleted. */
  resume_label: string | null;
  /** Their focus note for that resume (Settings > Resumes), when the user wrote one. */
  resume_focus?: string | null;
  /** A reply-kind email event is linked (and applied) to this application. */
  replied_by_email: boolean;
  /** An interview, assessment or offer email is linked to this application. */
  progressed_by_email?: boolean;
  /** stage_history shows it reached a progress stage, even if it was later rejected. */
  progressed_by_history?: boolean;
}

export function hasReply(r: Pick<OutcomeInput, 'current_stage' | 'replied_by_email'>): boolean {
  return r.replied_by_email || REPLY_STAGES.has(r.current_stage);
}

/** Got past the first cut at some point: an assessment, screen, interview or offer. */
export function hasProgress(r: Pick<OutcomeInput, 'current_stage' | 'progressed_by_email' | 'progressed_by_history'>): boolean {
  return !!r.progressed_by_email || !!r.progressed_by_history || PROGRESS_STAGES.has(r.current_stage);
}

/** Answered without ever progressing: a straight rejection. */
export function isRejected(r: OutcomeInput): boolean {
  return hasReply(r) && !hasProgress(r);
}

/** Buckets with fewer applications than this fold into one "Other" row per column. */
export const FOLD_BELOW = 5;
/** Key of the folded row; cannot clash with a role family or a document id. */
export const OTHER_KEY = '__other';

type KeyLabel = { key: string; label: string; sublabel?: string; primary?: boolean };

// ── source and resume naming ─────────────────────────────────────────────────
/**
 * One bucket per board: "SEEK", "Seek" and "SEEK Quick Apply" are all SEEK,
 * "linkedin" and "LinkedIn Easy Apply" are LinkedIn, every "Official Greenhouse
 * ..." is Greenhouse (shared/source.ts holds the list). Text that names nothing
 * known still merges case-insensitively, under the first spelling seen.
 */
export function sourceBucket(source: string | null | undefined): { key: string; label: string } {
  const family = sourceFamily(source);
  if (!family) return { key: 'unknown', label: 'Not specified' };
  return { key: `source:${family.toLowerCase().replace(/\s+/g, ' ')}`, label: family };
}

/**
 * The variant code in a resume file name: "Alex Morgan - Resume_R01.pdf" -> "R01",
 * "Alex Morgan - Resume_01.pdf (software)" -> "01", and a combined packet that
 * names its base resume ("O01 + Constantinople letter ...", "combined
 * Resume_01 + ...") -> that code, so it counts with the resume it carries.
 * null when the name carries no code ("Alex Morgan - Resume.pdf").
 */
export function resumeCode(label: string | null | undefined): string | null {
  const t = String(label || '');
  const named = /resume[\s_-]*([a-z]?\d{1,3})(?![\d])/i.exec(t);
  if (named) return named[1].toUpperCase();
  const bare = /(?:^|[\s(])([A-Z]\d{2})(?=$|[\s).,+])/.exec(t);
  return bare ? bare[1] : null;
}

const FOCUS_MAX = 32;

/**
 * A few words on what a resume is for: the bracketed note in its label
 * ("... _R01.pdf (retail)" -> "Retail"), else the start of their focus note, cut
 * at the first clause. null when there is neither.
 */
export function resumeFocus(label: string | null | undefined, focusNote?: string | null): string | null {
  const bracket = /\(([^()]+)\)\s*$/.exec(String(label || ''));
  let text = bracket ? bracket[1] : String(focusNote || '').split(/[;.,:]|\s[-–]\s/)[0];
  text = text.trim();
  if (!text) return null;
  if (text.length > FOCUS_MAX) text = `${text.slice(0, FOCUS_MAX - 1).trimEnd()}…`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The display name for a file label with no code: the file name without the person or the extension. */
function resumeName(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, '').replace(/\.pdf$/i, '').replace(/^.*?\s-\s/, '').trim() || label;
}

export function resumeBucket(r: Pick<OutcomeInput, 'resume_doc_id' | 'resume_label' | 'resume_focus'>): KeyLabel {
  if (!r.resume_doc_id) return { key: 'none', label: 'Not recorded' };
  if (!r.resume_label) return { key: r.resume_doc_id, label: 'Removed resume' };
  const code = resumeCode(r.resume_label);
  const focus = resumeFocus(r.resume_label, r.resume_focus) ?? undefined;
  // The plain file ("..._R01.pdf (retail)") names the focus best; a combined
  // packet carrying the same code only fills in when nothing better has.
  const primary = /\([^()]+\)\s*$/.test(r.resume_label);
  if (code) return { key: `resume:${code}`, label: code, sublabel: focus, primary };
  return { key: r.resume_doc_id, label: resumeName(r.resume_label), sublabel: focus };
}


const rate = (r: OutcomeRow) => (r.applied > 0 ? r.progressed / r.applied : 0);
const rejectRate = (r: OutcomeRow) => (r.applied > 0 ? r.rejected / r.applied : 0);

/**
 * Pure: group rows, then fold every bucket under `foldBelow` applications into
 * one "Other" row, and sort by progress rate (ties: lower rejection rate, then
 * more applications first).
 * Other always sits last. A bucket's sublabel comes from its first primary row
 * (the plain resume file), else the first row that has one.
 */
export function bucketOutcomes(rows: OutcomeInput[], keyLabel: (r: OutcomeInput) => KeyLabel, foldBelow = FOLD_BELOW): OutcomeRow[] {
  const m = new Map<string, OutcomeRow>();
  const primaryNoted = new Set<string>();
  for (const r of rows) {
    const { key, label, sublabel, primary } = keyLabel(r);
    const row = m.get(key) || { key, label, applied: 0, replied: 0, progressed: 0, rejected: 0 };
    if (sublabel && (primary ? !primaryNoted.has(key) : !row.sublabel)) {
      row.sublabel = sublabel;
      if (primary) primaryNoted.add(key);
    }
    row.applied++;
    if (hasReply(r)) row.replied++;
    if (hasProgress(r)) row.progressed++;
    else if (isRejected(r)) row.rejected++;
    m.set(key, row);
  }
  const kept: OutcomeRow[] = [];
  const other: OutcomeRow = { key: OTHER_KEY, label: 'Other', applied: 0, replied: 0, progressed: 0, rejected: 0, folded: 0 };
  for (const row of m.values()) {
    if (row.applied >= foldBelow) { kept.push(row); continue; }
    other.applied += row.applied;
    other.replied += row.replied;
    other.progressed += row.progressed;
    other.rejected += row.rejected;
    other.folded!++;
  }
  kept.sort((a, b) => rate(b) - rate(a) || rejectRate(a) - rejectRate(b) || b.applied - a.applied || a.label.localeCompare(b.label));
  if (other.folded) kept.push({ ...other, label: `Other (${other.folded})` });
  return kept;
}

/** Pure: progress and rejection rates by source, by resume sent and by role family. */
export function aggregateOutcomes(rows: OutcomeInput[], min = OUTCOME_MIN, foldBelow = FOLD_BELOW): OutcomeStats {
  const withOutcome = rows.filter(hasReply).length;
  return {
    eligible: withOutcome >= min,
    withOutcome,
    bySource: bucketOutcomes(rows, (r) => sourceBucket(r.job_source), foldBelow),
    byResume: bucketOutcomes(rows, resumeBucket, foldBelow),
    byRoleFamily: bucketOutcomes(rows, (r) => {
      const key = roleFamily(r.job_title);
      return { key, label: FAMILY_LABEL[key] };
    }, foldBelow),
  };
}

/** Their focus note per resume document id (Settings > Resumes), {} when unset or unreadable. */
function loadResumeFocus(db: MigrationDb): Record<string, string> {
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'resume_focus'`).get() as { value?: string } | undefined;
    const parsed = row?.value ? JSON.parse(row.value) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadOutcomeInputs(db: MigrationDb): OutcomeInput[] {
  const focus = loadResumeFocus(db);
  const kinds = REPLY_KINDS.map(() => '?').join(',');
  const progressKinds = PROGRESS_KINDS.map(() => '?').join(',');
  const progressStages = [...PROGRESS_STAGES];
  return db.prepare(`SELECT a.id, a.job_title, a.job_source, a.current_stage, a.resume_doc_id,
        d.label AS resume_label,
        EXISTS(SELECT 1 FROM email_events e WHERE e.application_id = a.id AND e.status = 'applied' AND e.kind IN (${kinds})) AS replied,
        EXISTS(SELECT 1 FROM email_events e WHERE e.application_id = a.id AND e.status = 'applied' AND e.kind IN (${progressKinds})) AS progressed_email,
        EXISTS(SELECT 1 FROM stage_history h WHERE h.application_id = a.id AND h.stage IN (${progressStages.map(() => '?').join(',')})) AS progressed_history
      FROM applications a LEFT JOIN locker_documents d ON d.id = a.resume_doc_id`)
    .all(...REPLY_KINDS, ...PROGRESS_KINDS, ...progressStages)
    .map((r: any) => ({
      id: String(r.id),
      job_title: String(r.job_title || ''),
      job_source: r.job_source ?? null,
      current_stage: String(r.current_stage || ''),
      resume_doc_id: r.resume_doc_id ?? null,
      resume_label: r.resume_label ?? null,
      resume_focus: r.resume_doc_id ? focus[String(r.resume_doc_id)] ?? null : null,
      replied_by_email: !!Number(r.replied),
      progressed_by_email: !!Number(r.progressed_email),
      progressed_by_history: !!Number(r.progressed_history),
    }));
}

export function outcomeStats(db: MigrationDb): OutcomeStats {
  return aggregateOutcomes(loadOutcomeInputs(db));
}

// ── Today ────────────────────────────────────────────────────────────────────
export const INTERVIEW_WINDOW_DAYS = 7;
/** "About to go quiet": this many silent days, up to the day before No response. */
export const GOING_QUIET_FROM = 18;
export const GOING_QUIET_TO = 20;

export interface TodayAppRow {
  id: string;
  company: string;
  job_title: string;
  current_stage: string;
  created_at: string;
  updated_at: string;
  interview_at: string | null;
  last_email_at: string | null;
  application_deadline: string | null;
  /** Gmail deep link to the email worth reading about this one; null when nothing qualifies. */
  email_url: string | null;
  job_url: string | null;
}

export interface TodayDraftRow { id: string; company: string; job_title: string; draft_updated_at: string }

// ── Today: linking straight to the email worth reading ──────────────────────
export interface EmailLinkRow { email: string; message_id: string; kind: string; sent_at: string }

/**
 * Pure: which email_events row (for one application) is worth linking from
 * Today. Prefer the newest assessment or interview email (the actual invite),
 * otherwise the newest email that isn't a plain "received" acknowledgement.
 * undefined when there is nothing worth linking (no rows, or only acks).
 */
export function pickEmailForLink(events: EmailLinkRow[]): EmailLinkRow | undefined {
  const byRecency = (a: EmailLinkRow, b: EmailLinkRow) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime();
  const stage = events.filter((e) => e.kind === 'assessment' || e.kind === 'interview').sort(byRecency)[0];
  if (stage) return stage;
  return events.filter((e) => e.kind !== 'received').sort(byRecency)[0];
}

/** Pure: the Today lists from plain rows. */
export function computeToday(
  apps: TodayAppRow[], drafts: TodayDraftRow[], now: number = Date.now(), actionItems: TodayData['actionItems'] = [],
): TodayData {
  const until = now + INTERVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const interviewsSoon = apps
    .filter((a) => {
      if (!a.interview_at) return false;
      const t = new Date(a.interview_at).getTime();
      return Number.isFinite(t) && t >= now && t <= until;
    })
    .sort((a, b) => new Date(a.interview_at!).getTime() - new Date(b.interview_at!).getTime())
    .map((a) => ({
      applicationId: a.id, company: a.company, role: a.job_title, interviewAt: a.interview_at!,
      emailUrl: a.email_url, jobUrl: a.job_url,
    }));
  // The custom "assessment" and "take_home" stages, merged into one bucket:
  // any due date (or none) counts, unlike interviews, which only show inside
  // the coming week. "assessed" (screening done, waiting to hear back) is
  // deliberately not in here: nothing left for them to do until a reply lands.
  const assessmentsDue = apps
    .filter((a) => a.current_stage === 'assessment' || a.current_stage === 'take_home')
    .map((a) => ({
      applicationId: a.id, company: a.company, role: a.job_title, dueAt: a.application_deadline,
      stage: a.current_stage as 'assessment' | 'take_home',
      emailUrl: a.email_url, jobUrl: a.job_url,
    }));
  const goingQuiet = apps
    .filter((a) => a.current_stage === 'applied')
    .map((a) => ({ a, d: silentDays(a, a.last_email_at, now) }))
    .filter(({ d }) => d >= GOING_QUIET_FROM && d <= GOING_QUIET_TO)
    .sort((x, y) => y.d - x.d)
    .map(({ a, d }) => ({ applicationId: a.id, company: a.company, role: a.job_title, daysQuiet: d }));
  return {
    draftsReady: drafts.map((d) => ({ applicationId: d.id, company: d.company, role: d.job_title, updatedAt: d.draft_updated_at })),
    interviewsSoon,
    assessmentsDue,
    actionItems,
    goingQuiet,
  };
}

export function todayData(db: MigrationDb, now: number = Date.now()): TodayData {
  const apps = db.prepare(`SELECT a.id, a.company, a.job_title, a.current_stage, a.created_at, a.updated_at, a.interview_at, a.application_deadline, a.job_url,
        (SELECT MAX(e.sent_at) FROM email_events e WHERE e.application_id = a.id AND e.status = 'applied') AS last_email_at
      FROM applications a`).all() as (TodayAppRow & { job_url: string })[];
  // A working draft the user has not saved a version of yet, on a row still at applied.
  const drafts = db.prepare(`SELECT a.id, a.company, a.job_title, MAX(c.updated_at) AS draft_updated_at
      FROM applications a JOIN cover_letters c ON c.application_id = a.id AND c.is_final = 0
      WHERE a.current_stage = 'applied'
        AND NOT EXISTS (SELECT 1 FROM cover_letters f WHERE f.application_id = a.id AND f.is_final = 1)
      GROUP BY a.id ORDER BY draft_updated_at DESC`).all() as TodayDraftRow[];
  // Every job email seen, application by application, so the best one to link
  // (the actual invite, not a plain ack) can be picked in plain JS.
  const events = db.prepare(`SELECT application_id, email, message_id, kind, sent_at FROM email_events WHERE application_id IS NOT NULL`)
    .all() as (EmailLinkRow & { application_id: string })[];
  const eventsByApp = new Map<string, EmailLinkRow[]>();
  for (const e of events) {
    const list = eventsByApp.get(e.application_id);
    if (list) list.push(e); else eventsByApp.set(e.application_id, [e]);
  }
  const actionItems = toTodayActionItems(listOpenActionItems(db));
  return computeToday(
    apps.map((a) => {
      const picked = pickEmailForLink(eventsByApp.get(a.id) ?? []);
      return {
        ...a, interview_at: a.interview_at ?? null, last_email_at: a.last_email_at ?? null,
        application_deadline: a.application_deadline ?? null,
        email_url: picked ? gmailSearchUrl(picked.email, picked.message_id) : null,
        job_url: a.job_url && a.job_url.trim() ? a.job_url : null,
      };
    }),
    drafts, now, actionItems,
  );
}

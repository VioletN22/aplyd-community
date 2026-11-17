// Shared TypeScript types for Job Application Tracker

/**
 * The job sites / channels an application can be found on.
 * Single source of truth: the Add form dropdown, the AI extraction prompt,
 * and any display all reference this list. Ordered roughly by AU popularity,
 * with generic channels and "Other" last.
 */
// Channels used everywhere come first, then regional job boards, then Other.
// Stored values are kept as they are; a value that is not in this list still
// shows on the application.
export const JOB_SOURCES = [
  'LinkedIn',
  'Indeed',
  'Glassdoor',
  'Company website',
  'Referral',
  'Recruiter / Agency',
  'Email',
  'Seek',
  'Prosple',
  'GradConnection',
  'Jora',
  'CareerOne',
  'Workforce Australia',
  'Hatch',
  'Other',
] as const;

/** The source choices for a dropdown, keeping a stored value that is not in JOB_SOURCES. */
export function jobSourceOptions(current: string | null | undefined): string[] {
  const list: string[] = [...JOB_SOURCES];
  return current && !list.includes(current) ? [...list, current] : list;
}

export type JobSource = (typeof JOB_SOURCES)[number];

/**
 * Represents a job application with all relevant information
 */
export interface JobApplication {
  id: string;
  company: string;
  job_title: string;
  location: string;
  /** Exact workplace street address when known; never inferred from the user's address. */
  workplace_address?: string | null;
  job_url: string;
  /** Which job site / channel this was found on, e.g. "Seek". null = not specified. */
  job_source: string | null;
  salary_min: number | null;
  salary_max: number | null;
  equity: string | null;
  benefits: string | null;
  job_description: string;
  key_responsibilities: string;
  required_skills: string;
  nice_to_have_skills: string;
  team_info: string | null;
  hiring_timeline: string | null;
  application_deadline: string | null;
  current_stage: string;
  workflow_id: string;
  notes: string | null;
  /**
   * The posting exactly as it arrived (pasted or fetched). job_description is a
   * 150-word paraphrase of it; letters and the fit score are written from this.
   * Empty on rows added before the column existed, and on quick adds.
   */
  raw_job_text?: string | null;
  /** 0-10 match against their best-fit resume, scored once at ingest. */
  fit_score?: number | null;
  /** One sentence explaining that score, shown on the card and detail header. */
  fit_reason?: string | null;
  /** When the interview is, as a local `YYYY-MM-DDTHH:mm` string. null = none set. */
  interview_at?: string | null;
  interview_minutes?: number | null;
  /** Free-form prep notes for that interview. */
  prep_notes?: string | null;
  /**
   * Joined presence flags, set only by `getAllApplications` (the list payload):
   * true when this application already has a cover-letter row. Left
   * undefined by single-row fetches, which do not run the join.
   */
  has_letter?: boolean;
  /**
   * The locker resume sent with this application: set by letter hydration the
   * first time it picks one (never overwriting a manual pick), or by hand via
   * applications.setResume. null = not known.
   */
  resume_doc_id: string | null;
  /**
   * Computed, read-only (list and single-row fetches): a working cover-letter
   * draft (is_final=0) exists for this application. Ignored on update.
   */
  has_letter_draft: boolean;
  /** Computed, read-only: newest linked email event's sentAt, null when none. Ignored on update. */
  last_email_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The one fixed stage list. Every application moves along these, nothing else:
 * per-company workflows are gone (the workflows table and workflow_id column
 * are kept, unread).
 */
export const STAGES = ['applied', 'assessment', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Stages the app recognises beyond the funnel: 'assessed' (the assessment is
 * done, waiting on them; sorts right after 'assessment') and the legacy
 * 'take_home', an assessment still to do under its old name.
 */
export const EXTRA_STAGES = ['take_home', 'assessed'] as const;
export type ExtraStage = (typeof EXTRA_STAGES)[number];

/** An assessment still waiting on them: the 'assessment' stage and its legacy alias. */
export const ASSESSMENT_TODO_STAGES: readonly string[] = ['assessment', 'take_home'];

/** Any stage an application may be moved to: the funnel plus the recognised extras. */
export function isStage(s: unknown): s is Stage | ExtraStage {
  return typeof s === 'string' && ((STAGES as readonly string[]).includes(s) || (EXTRA_STAGES as readonly string[]).includes(s));
}

/**
 * An applied application with no email and no touch for this many days counts
 * as "No response": hidden from the active list, stage left at applied.
 */
export const NO_RESPONSE_AFTER_DAYS = 21;
/** Kept for older callers: quiet and no-response are the same rule now. */
export const QUIET_AFTER_DAYS = NO_RESPONSE_AFTER_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between `iso` and `now`. Negative for future dates, 0 for unparseable. */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((now - t) / DAY_MS);
}

/**
 * The last moment this application saw any activity. Stage timing is not carried
 * on the row (stage_history is a separate fetch), so the newer of created_at and
 * updated_at stands in for it: a stage move rewrites updated_at.
 */
export function lastTouchedAt(app: Pick<JobApplication, 'created_at' | 'updated_at'>): string {
  const created = new Date(app.created_at).getTime();
  const updated = new Date(app.updated_at).getTime();
  if (!Number.isFinite(updated)) return app.created_at;
  if (!Number.isFinite(created)) return app.updated_at;
  return updated > created ? app.updated_at : app.created_at;
}

/**
 * Days since anything happened on this row: the newer of its last touch and
 * its last email event. Any email or edit resets the clock.
 */
export function silentDays(
  app: Pick<JobApplication, 'created_at' | 'updated_at'>,
  lastEmailAt: string | null,
  now: number = Date.now(),
): number {
  const touched = daysSince(lastTouchedAt(app), now);
  if (!lastEmailAt || !Number.isFinite(new Date(lastEmailAt).getTime())) return touched;
  return Math.min(touched, daysSince(lastEmailAt, now));
}

/**
 * "No response": still at applied, and neither an email event nor a touch in
 * the last NO_RESPONSE_AFTER_DAYS days. Pure; `lastEmailAt` is the newest
 * linked email event (JobApplication.last_email_at on list rows).
 */
export function isNoResponse(
  app: Pick<JobApplication, 'current_stage' | 'created_at' | 'updated_at'>,
  lastEmailAt: string | null,
  now: number = Date.now(),
): boolean {
  return app.current_stage === 'applied' && silentDays(app, lastEmailAt, now) >= NO_RESPONSE_AFTER_DAYS;
}

/** Days of silence on a row (email-aware when the list payload carries last_email_at). */
export function quietDays(app: JobApplication, now: number = Date.now()): number {
  return silentDays(app, app.last_email_at ?? null, now);
}

/** Same rule as isNoResponse, reading last_email_at off the row. */
export function isQuiet(app: JobApplication, now: number = Date.now()): boolean {
  return isNoResponse(app, app.last_email_at ?? null, now);
}

/** An interview is booked and has not happened yet. */
export function hasUpcomingInterview(app: JobApplication): boolean {
  if (!app.interview_at) return false;
  const t = new Date(app.interview_at).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/**
 * What a quick add (company + role only) writes into job_description. It is an
 * honest placeholder, not a posting: nothing may be generated from a row that
 * still says this, so the detail page checks for it before offering a letter.
 */
export const PLACEHOLDER_DESCRIPTION = 'Job details to be added. Paste the posting or its link when you have it. Connect AI in Settings to extract the details.';
/** The stable prefix of the above, which is what detection actually matches. */
export const PLACEHOLDER_DESCRIPTION_PREFIX = 'Job details to be added';

/** One item's fate during a batch add, streamed on `apps:batchProgress`. */
export interface BatchAddProgress {
  index: number;
  status: 'working' | 'done' | 'error';
  /** How many items are in this batch, so a reopened modal can size itself. */
  total: number;
  applicationId?: string;
  /** Known once the posting is extracted: what to show on the finished line. */
  company?: string;
  role?: string;
  error?: string;
}

/**
 * Represents a workflow template with stages
 */
export interface Workflow {
  id: string;
  company: string;
  name: string;
  stages: string[];
  is_default: boolean;
  created_at: string;
}

/**
 * Represents the history of stage transitions for an application
 */
export interface StageHistory {
  id: string;
  application_id: string;
  stage: string;
  entered_at: string;
  exited_at: string | null;
  notes: string | null;
  guidance: string | null;
  outcome: string | null;
}

/**
 * Type for guidance document types
 */
export type GuidanceType = 'interview_prep' | 'company_research' | 'application_strategy' | 'follow_up_template';

/**
 * Represents a guidance document for an application stage
 */
export interface GuidanceDoc {
  id: string;
  application_id: string;
  stage: string;
  guidance_type: GuidanceType;
  content: string;
  generated_at: string;
}

/**
 * Represents job data extracted from a job listing
 * (without application-specific fields like id, current_stage, workflow_id, notes, created_at, updated_at)
 */
export interface ExtractedJobData {
  company: string;
  job_title: string;
  location: string;
  /** Exact workplace street address only when the listing states one. */
  workplace_address?: string | null;
  job_url: string;
  job_source: string | null;
  salary_min: number | null;
  salary_max: number | null;
  equity: string | null;
  benefits: string | null;
  job_description: string;
  key_responsibilities: string;
  required_skills: string;
  nice_to_have_skills: string;
  team_info: string | null;
  hiring_timeline: string | null;
  application_deadline: string | null;
}

/**
 * Represents content for guidance documents
 */
export interface GuidanceContent {
  interview_prep: string;
  company_research: string;
  application_strategy: string;
  follow_up_template: string;
}

/**
 * Application flow (Sankey) aggregation types.
 * Built by aggregating every application's stage_history into nodes + links.
 */
export type FlowNodeKind = 'active' | 'offer' | 'rejected' | 'withdrawn';

export interface FlowNode {
  /** canonical stage key, e.g. 'applied' */
  id: string;
  /** display label, e.g. 'Applied' */
  label: string;
  /** number of applications that passed through this stage */
  count: number;
  kind: FlowNodeKind;
}

export interface FlowLink {
  /** source stage key */
  source: string;
  /** target stage key */
  target: string;
  /** number of applications that made this transition */
  count: number;
}

export interface FlowSummary {
  total: number;
  offers: number;
  rejected: number;
  withdrawn: number;
  inProgress: number;
}

export interface FlowData {
  nodes: FlowNode[];
  links: FlowLink[];
  summary: FlowSummary;
}

// ── Their material: answer bank, document locker, voice, portfolio, letters ────
export interface AnswerBankEntry {
  id: string;
  fieldKey: string;        // normalized concept, e.g. "legal_name", "years_experience"
  label: string;           // human label, e.g. "Legal name"
  value: string;           // the answer to fill
  context: string | null;  // when to use it, e.g. "when the field asks for legal/full name"
  patterns: string[];      // field-label substrings that map to this answer
  createdAt: string;
  updatedAt: string;
}

export interface LockerDocument {
  id: string;
  label: string;           // "Resume", "Cover letter (eng roles)"
  filePath: string;        // local path, read for its text
  tags: string[];          // ["resume"], ["cover-letter"], ...
  isDefault: boolean;      // default file for its primary tag
  createdAt: string;
}

export type VoiceNoteKind = 'like' | 'dislike' | 'style';
export interface VoiceNote {
  id: string;
  kind: VoiceNoteKind;
  note: string;            // a learned writing preference, grown from feedback
  createdAt: string;
}

// Portfolio is a live website (or several links) Claude can reference/fetch.
export interface PortfolioLink {
  id: string;
  label: string;           // "Portfolio site", "GitHub", "Case study, Acme"
  url: string;
  createdAt: string;
}

// The cover-letter vault: perfected letters saved for reuse, plus your own.
export interface CoverLetter {
  id: string;
  company: string;
  role: string;
  jobUrl: string | null;
  applicationId: string | null;   // set when this draft belongs to a tracked application
  label: string | null;           // friendly name for a saved version
  body: string;
  isFinal: boolean;        // marked perfected/locked in the vault
  createdAt: string;
  updatedAt: string;
}

// ── Per-application assistant ────────────────────────────────────────────────
// The assistant on the detail page: it knows one application, every resume
// variant and their letters, and it drafts form answers as them.

/** One turn of the assistant conversation, as both processes exchange it. */
export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** A stored turn, as `assistant:history` hands it back. */
export interface AssistantHistoryMessage extends AssistantMessage {
  id: string;
  createdAt: string;
}

/**
 * A pasteable answer to an application form question. Present only when the
 * message the user sent WAS such a question, so the panel knows when to offer
 * "Save to answer bank".
 */
export interface AssistantFormAnswer {
  /** The question, in the form's words: this becomes the answer bank label. */
  question: string;
  /** The answer, ready to paste into the field. */
  answer: string;
}

export interface AssistantReply {
  reply: string;
  formAnswer?: AssistantFormAnswer;
}

// ── Inbox sync ───────────────────────────────────────────────────────────────
// Job email read over IMAP (Gmail app password), matched to an application and
// turned into a stage change. Main owns the pipeline; the renderer only sees
// these shapes over the email:* channels.

/** What an email says about an application. */
export type EmailKind = 'received' | 'rejection' | 'interview' | 'assessment' | 'offer' | 'other';

/**
 * applied: its change was made (or it was logged against an application and
 * changes nothing); ignored: not about an application, or not sure enough;
 * pending: read from the inbox but not yet decided, because the model could
 * not read it (Claude signed out, at its limit, offline). Every sync tries
 * again and decides it automatically; nothing waits for their review.
 * dismissed (and pending rows without stored text) come from the retired
 * review flow and are re-decided on the next sync.
 */
export type EmailEventStatus = 'applied' | 'pending' | 'dismissed' | 'ignored';

/** A connected mailbox. The password lives in the macOS Keychain, never here. */
export interface EmailAccount {
  email: string;
  provider: 'gmail';
  lastSyncAt: string | null;
  lastError: string | null;
}

/** One application an email might be about, best first. */
export interface EmailCandidate {
  applicationId: string;
  company: string;
  role: string;
}

/** One job email and what it did (or proposes to do) to an application. */
export interface EmailEvent {
  id: string;
  email: string;
  messageId: string;
  fromAddress: string;
  subject: string;
  sentAt: string;
  applicationId: string | null;
  /** Joined from the application row; null when unmatched or since deleted. */
  company: string | null;
  role: string | null;
  kind: EmailKind;
  confidence: number;
  evidence: string;
  /** The application's stage when the event was decided or applied. */
  fromStage: string | null;
  /** The stage it moves to; null when it changes no stage. */
  proposedStage: string | null;
  status: EmailEventStatus;
  candidates: EmailCandidate[];
}

/** The sync run, streamed on email:progress. */
export interface EmailSyncStatus {
  running: boolean;
  phase: 'idle' | 'connecting' | 'scanning' | 'classifying' | 'done' | 'error';
  message: string;
  seen: number;
  candidates: number;
  proposals: number;
  autoApplied: number;
  lastSyncAt: string | null;
  /** Emails read from the inbox but still waiting for the model (status 'pending'). Never waiting for them. */
  pendingCount: number;
  error: string | null;
}

// ── Wave 2: background prep, outcomes, Today ─────────────────────────────────

/** Background prep progress, streamed on prep:progress. */
export interface PrepStatus {
  applicationId: string;
  task: 'fit' | 'letter' | 'interview_prep';
  state: 'queued' | 'running' | 'done' | 'error';
  message?: string;
}

/** One bucket of the "What's working" tables: `replied` of `applied`. */
export interface OutcomeRow {
  key: string;
  label: string;
  /** Small text under the label: a resume's focus ("Retail"). */
  sublabel?: string;
  applied: number;
  /** Any answer: progressed or rejected. */
  replied: number;
  /** Reached an assessment, screen, interview or offer at some point. */
  progressed: number;
  /** Answered with a rejection and never progressed. */
  rejected: number;
  /** On the "Other" row only: how many small buckets were folded into it. */
  folded?: number;
}

export interface OutcomeStats {
  /** true once withOutcome >= 10; the section stays hidden until then. */
  eligible: boolean;
  /** Applications with any outcome signal (a reply email or a stage past applied). */
  withOutcome: number;
  bySource: OutcomeRow[];
  byResume: OutcomeRow[];
  byRoleFamily: OutcomeRow[];
}

export type ActionItemPriority = 'high' | 'normal' | 'low';

/**
 * Something outside Aplyd the user needs to do to keep an application moving that
 * isn't itself an interview or assessment stage: book a time, verify identity,
 * solve a captcha, answer a question, create a portal account, finish a
 * stalled application, or an optional extra. application_id (and so company /
 * role) is null when one item spans several applications, e.g. a single SEEK
 * Pass verification several employers have asked for.
 */
export interface TodayActionItem {
  id: string;
  applicationId: string | null;
  kind: string;
  title: string;
  detail: string | null;
  company: string | null;
  role: string | null;
  /** e.g. "SEEK Pass: Globex Solutions, Umbrella Co, ..." */
  groupLabel: string | null;
  dueAt: string | null;
  /** When the item ends, for one that takes a span of time (a rostered shift). */
  endsAt?: string | null;
  priority: ActionItemPriority;
  /** The item's own primary link: a booking page, a verification start page, a portal login, a job listing. */
  url: string | null;
  emailUrl: string | null;
}

export interface TodayData {
  draftsReady: { applicationId: string; company: string; role: string; updatedAt: string }[];
  interviewsSoon: { applicationId: string; company: string; role: string; interviewAt: string; emailUrl: string | null; jobUrl: string | null }[];
  /** Stage 'assessment' and 'take_home' applications; dueAt is null when no deadline was captured. */
  assessmentsDue: { applicationId: string; company: string; role: string; dueAt: string | null; stage: 'assessment' | 'take_home'; emailUrl: string | null; jobUrl: string | null }[];
  /** Things to do outside the app: booking links, verifications, captchas, questions, portal accounts, stalled applications, optional extras. */
  actionItems: TodayActionItem[];
  goingQuiet: { applicationId: string; company: string; role: string; daysQuiet: number }[];
}

// ── Quick add (global shortcut capture; handlers arrive with the quick-add merge) ──

/** Sent on quickadd:added when a quick add lands a row. */
export interface QuickAddAdded {
  applicationId: string;
  /** true when the app should open that application's detail page. */
  open: boolean;
}

/** The registered global shortcut, and why registering it failed, if it did. */
export interface QuickAddShortcut {
  shortcut: string;
  error: string | null;
  /** Display form of the accelerator, e.g. "⌥⌘J". */
  label?: string;
  /** Is it actually registered with the OS right now? */
  registered?: boolean;
  /** The shortcut a fresh install uses. */
  default?: string;
}

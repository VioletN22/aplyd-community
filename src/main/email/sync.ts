// The inbox sync engine: scan -> prefilter (inside the fetcher) -> match ->
// classify -> decide -> apply. Everything with a side effect outside sqlite
// (IMAP, the Keychain, the model, stage changes) is injected, so the whole
// pipeline runs offline in tests.
//
// Fully automatic: nothing waits for review. The rules:
//   1. A matched email the classifier gives >= 0.5 applies (backlog included):
//      a stage move when one is warranted, a log (receipt) or note (assessment)
//      when not. Below 0.5, or 'other', it is ignored.
//   2. An email the shortlist could not place, whose kind would matter
//      (rejection, interview, assessment, offer), gets a second look against
//      ALL their applications.
//   3. An interview or offer still unplaced after that is from a company the user
//      never logged: it becomes an application of its own (one per company).
//   4. Their own sent mail is never a company writing back: ignored.
//   5. An email the model could not read (Claude signed out, at its limit,
//      offline) is never dropped: it is stored as a 'pending' event with its
//      text, the account says why, and every later run reads it again until
//      the model answers. The UID watermark moves on regardless.
// Never backwards, never out of a final stage (stages.ts).

import type { EmailKind, EmailSyncStatus, EmailCandidate } from '../../shared/types';
import type { AccountRow, EmailStore, StoredEvent } from './store';
import type { FolderScan, ScanOptions, ScannedMessage } from './imap';
import { rankCandidates, plausibleApps, companyFromSender, findCompanyMatch, type AppLite } from './match';
import { decideStage, emailNote } from './stages';
import { isOwnAddress, parseJobBoardSubject } from './prefilter';
import { detectActionEmail, type DetectedAction } from './action-detect';

export const AUTO_APPLY_CONFIDENCE = 0.5;
/** Kinds worth a second look when the shortlist missed. */
const STAGE_KINDS = new Set<EmailKind>(['rejection', 'interview', 'assessment', 'offer']);
/** Kinds that create an application when nothing the user logged fits. */
const CREATE_KINDS = new Set<EmailKind>(['interview', 'offer']);
const DAY_MS = 86_400_000;
/**
 * Incremental syncs look back this far before the last sync (not before now),
 * as a safety net under the UID watermark: after days with the Mac asleep or
 * the app closed, the whole gap is read.
 */
export const INCREMENTAL_LOOKBACK_DAYS = 14;
/** How much of a waiting email's text is kept for the run that finally reads it. */
const WAITING_BODY_CHARS = 3000;
/** The backlog starts this long before their first application. */
export const BACKLOG_LEAD_DAYS = 7;

export interface ClassifyInput {
  from: string;
  subject: string;
  date: string;
  body: string;
  candidates: AppLite[];
}
export interface ClassifyResult {
  applicationId: string | null;
  kind: EmailKind;
  confidence: number;
  evidence: string;
}
export type Classifier = (input: ClassifyInput) => Promise<ClassifyResult>;
/** Several emails in one model call; results in input order. */
export type BatchClassifier = (inputs: ClassifyInput[]) => Promise<ClassifyResult[]>;

/** What the second pass sees of an email: the same fields, no shortlist (it gets every application). */
export interface SecondPassEmail {
  from: string;
  subject: string;
  date: string;
  body: string;
}
export interface SecondPassResult extends ClassifyResult {
  /** For an email about none of their applications: the hiring company, when the model can tell. */
  company: string | null;
  role: string | null;
}
/** Several emails against the full application list, one call; results in input order. */
export type SecondPassClassifier = (emails: SecondPassEmail[], apps: AppLite[]) => Promise<SecondPassResult[]>;

/** Emails per batched model call. */
export const CLASSIFY_BATCH = 8;

const RECEIVED_RE = /\b(thank(s| you) for (applying|your application|your interest)|we('ve| have) received your application|application (received|submitted|confirmation)|your application (has been|was) (received|submitted))\b/i;
const NOT_JUST_RECEIVED_RE = /\b(unfortunately|regret|not (be )?(progress|proceed|mov)|other candidates|interview|phone (call|screen)|assessment|coding (test|challenge)|next steps|offer|shortlist)/i;

/**
 * An unmistakable "no": the job boards' templates (SEEK "has decided not to
 * progress your application", "your application is unlikely to progress
 * further"; SmartRecruiters "not to progress your application to the next
 * stage") and the plainest employer wording. Deliberately narrow, because a
 * rejection is final: anything softer goes to the model.
 */
const REJECTION_RE = new RegExp([
  String.raw`\bnot to (?:progress|proceed with|continue with|move forward with|take forward) (?:with )?your (?:application|candidacy)\b`,
  String.raw`\bunlikely to progress(?: any)? further\b`,
  String.raw`\b(?:will|would|are|is) not (?:be )?(?:progressing|proceeding with|moving forward with|taking forward) your (?:application|candidacy)\b`,
  String.raw`\b(?:not|unable to) (?:progress|proceed with|move forward with) your (?:application|candidacy)\b`,
  String.raw`\b(?:move|moving|proceed|proceeding|progress|progressing|go ahead|going ahead) (?:forward )?with (?:other|another) (?:candidates?|applicants?)\b`,
  String.raw`\byour application (?:was|has been|is) unsuccessful\b`,
].join('|'), 'gi');
/** "If the employer decides not to progress your application, we'll let you know" is a receipt, not a no. */
const CONDITIONAL_RE = /\b(if|should|unless|whether|in the event|in case|once)\b/i;
/** Anything hopeful next to a "no" (another role, an interview, a test) is the model's call. */
const HOPEFUL_RE = /\b(interview|phone (?:call|screen|chat)|screening call|assessment|coding (?:test|challenge)|online test|psychometric|job offer|offer of employment|pleased to offer|shortlist(?:ed)?|invite you|invitation|congratulations|book a time|schedule (?:a|an|your)|next round|final round)\b/i;

/** The sentence a match sits in, whitespace collapsed. */
function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n')) + 1;
  const stop = text.slice(end).search(/[.!?\n]/);
  const to = stop < 0 ? text.length : end + stop + 1;
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

/**
 * The obvious cases, decided without the model, and only when the email names
 * exactly one of their applications: an unmistakable rejection with nothing
 * hopeful beside it, or a plain "thanks for applying". Anything that also
 * smells of a rejection, interview, test or offer goes to the model.
 */
export function quickClassify(subject: string, body: string, ranked: AppLite[]): ClassifyResult | null {
  if (ranked.length !== 1) return null;
  const text = `${subject}\n${body.slice(0, 3000)}`;
  if (!HOPEFUL_RE.test(text)) {
    for (const no of text.matchAll(REJECTION_RE)) {
      const sentence = sentenceAround(text, no.index!, no.index! + no[0].length);
      if (!CONDITIONAL_RE.test(sentence)) return { applicationId: ranked[0].id, kind: 'rejection', confidence: 0.9, evidence: sentence.slice(0, 160) };
    }
  }
  if (!RECEIVED_RE.test(text) || NOT_JUST_RECEIVED_RE.test(text)) return null;
  const m = text.match(RECEIVED_RE);
  return { applicationId: ranked[0].id, kind: 'received', confidence: 0.9, evidence: (m ? m[0] : subject).slice(0, 120) };
}
export type Fetcher = (opts: ScanOptions) => Promise<FolderScan[]>;

// ── when the model cannot answer ──────────────────────────────────────────────
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err ?? ''));
// AI is not set up yet (no provider chosen, or Anthropic chosen with no key).
// These are app-generated messages, checked first because the no-key text
// happens to contain the word "login" which SIGNED_OUT_RE would otherwise claim.
const NO_KEY_RE = /Add an Anthropic API key/i;
const NO_PROVIDER_RE = /AI is optional|Choose a provider in Settings|Select an AI provider/i;
const NEEDS_SETUP_RE = new RegExp(`${NO_KEY_RE.source}|${NO_PROVIDER_RE.source}`, 'i');
const SIGNED_OUT_RE = /OAuth|authenticat|not logged in|\blog ?in\b|\/login|\b401\b|unauthori[sz]ed|invalid api key|credential/i;
const MISSING_RE = /not found|ENOENT|failed to start/i;
const LIMIT_RE = /usage limit|rate.?limit|\b429\b|overloaded|\b529\b|quota/i;
const OFFLINE_RE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|offline/i;

/**
 * Does this failure mean the model is unavailable for every email (signed out,
 * not installed, at its limit, offline), rather than one email going wrong? A
 * run stops asking once it is.
 */
export function isModelUnavailable(err: unknown): boolean {
  const m = errText(err);
  return NEEDS_SETUP_RE.test(m) || SIGNED_OUT_RE.test(m) || MISSING_RE.test(m) || LIMIT_RE.test(m) || OFFLINE_RE.test(m);
}

/** Why emails are waiting, in words the user can act on. */
export function explainModelFailure(err: unknown): string {
  if (!err) return 'Claude has not read them yet. They are read on the next sync.';
  const m = errText(err);
  if (NO_KEY_RE.test(m)) return 'No Anthropic API key is set. Open Settings and add your key under AI provider to read job emails. Manual tracking still works.';
  if (NO_PROVIDER_RE.test(m)) return 'No AI provider is set up. Open Settings and choose an AI provider to read job emails. Manual tracking still works.';
  if (SIGNED_OUT_RE.test(m)) return 'Claude is signed out on this Mac. Open Terminal, run claude, type /login and sign in. They are read on the next sync.';
  if (MISSING_RE.test(m)) return 'The claude command is not installed or not found on this Mac, so they cannot be read yet.';
  if (LIMIT_RE.test(m)) return 'Claude is at its usage limit right now. They are read on a later sync.';
  if (OFFLINE_RE.test(m)) return 'Claude could not be reached (no network). They are read on the next sync.';
  if (/timed out/i.test(m)) return 'Claude took too long to answer. They are read on the next sync.';
  return `Claude could not read them (${m.replace(/\s+/g, ' ').slice(0, 160)}). They are read on the next sync.`;
}

/** The line under an account while it has emails waiting. */
export function waitingNote(n: number, reason: string): string {
  return `${n} job email${n === 1 ? ' is' : 's are'} waiting to be read. ${reason}`;
}

/** How stage changes and notes reach an application. Production wires database.ts's own functions. */
export interface StageOps {
  /** Record the move in stage_history and on the row. Returns the history row id. */
  move(applicationId: string, stage: string, note: string): string;
  addNote(applicationId: string, line: string): void;
  /**
   * Create an application at 'applied' for a company the user never logged
   * (job_source 'Email', `notes` on the row) and announce it. Returns its id.
   */
  create(input: { company: string; role: string; notes: string }): string;
}

/** How a detected action item (book a time, verify SEEK Pass) reaches Today. Production wires action-items.ts. */
export interface ActionItemOps {
  upsertDetected(ctx: {
    detected: DetectedAction; applicationId: string | null; company: string | null; role: string | null;
    email: string; messageId: string; sentAt: string;
  }): void;
}

export interface SyncDeps {
  store: EmailStore;
  fetcher: Fetcher;
  classify: Classifier;
  /** Optional: classify several emails per call (much faster). Falls back to `classify` per email on failure. */
  classifyBatch?: BatchClassifier;
  /** Optional: the second look against every application. Without it, unplaced emails stay unplaced. */
  classifySecondPass?: SecondPassClassifier;
  getPassword: (email: string) => Promise<string | null>;
  stages: StageOps;
  /** Optional: turns a new email that asks them to book a time or verify SEEK Pass into a Today action item. */
  actionItems?: ActionItemOps;
  now?: () => Date;
  /** Explains a fetch failure in words (explainImapFailure in production). */
  explain?: (err: unknown, email: string) => string;
  onStatus?: (s: EmailSyncStatus) => void;
  /** Parallel classifier calls. */
  concurrency?: number;
}

export interface EventDecision {
  status: 'applied' | 'ignored';
  fromStage: string | null;
  proposedStage: string | null;
  /** True when applying means a stage move or note, not just logging. */
  apply: boolean;
}

/**
 * Pure: what to do with one classified email, once matching (both passes and
 * any creation) is done. Nothing is ever left pending.
 *
 *  - 'other', unmatched, or matched below AUTO_APPLY_CONFIDENCE: ignored.
 *  - matched, a stage move warranted: applied, and the move is made.
 *  - matched, no move (receipt, assessment, a blocked move): applied as a log
 *    against the application; an assessment also gets its note.
 */
export function decideEvent(input: {
  kind: EmailKind; confidence: number; app: AppLite | null; text: string;
}): EventDecision {
  const { kind, confidence, app, text } = input;
  if (kind === 'other' || !app) return { status: 'ignored', fromStage: app?.current_stage ?? null, proposedStage: null, apply: false };
  if (confidence < AUTO_APPLY_CONFIDENCE) return { status: 'ignored', fromStage: app.current_stage, proposedStage: null, apply: false };
  const decision = decideStage(kind, app.current_stage, text);
  if (decision.proposedStage) return { status: 'applied', fromStage: app.current_stage, proposedStage: decision.proposedStage, apply: true };
  return { status: 'applied', fromStage: app.current_stage, proposedStage: null, apply: kind === 'assessment' };
}

/** A role to put on an application created from an email: the model's guess, else the subject without Re:/Fwd:. */
export function roleFromSubject(subject: string): string {
  return String(subject || '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Role from email';
}

const toCandidate = (a: AppLite): EmailCandidate => ({ applicationId: a.id, company: a.company, role: a.job_title });

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const idle = (): EmailSyncStatus => ({
  running: false, phase: 'idle', message: '', seen: 0, candidates: 0, proposals: 0, autoApplied: 0,
  lastSyncAt: null, pendingCount: 0, error: null,
});

/** One email after classification, with what the second pass guessed for an unplaced one. */
interface Classified {
  result: ClassifyResult;
  ranked: AppLite[];
  text: string;
  guess?: { company: string | null; role: string | null };
}

const KINDS: EmailKind[] = ['received', 'rejection', 'interview', 'assessment', 'offer', 'other'];

/** Trust nothing the model says about ids outside the list it was shown. */
function normaliseResult(raw: ClassifyResult | null | undefined, pool: AppLite[]): ClassifyResult {
  return {
    applicationId: raw?.applicationId && pool.some((a) => a.id === raw.applicationId) ? raw.applicationId : null,
    kind: raw && KINDS.includes(raw.kind) ? raw.kind : 'other',
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0)),
    evidence: String(raw?.evidence ?? '').slice(0, 300),
  };
}

const cleanGuess = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t && !/^(null|none|unknown|n\/a)$/i.test(t) ? t.slice(0, 120) : null;
};

export class EmailSync {
  private state: EmailSyncStatus = idle();
  private current: Promise<EmailSyncStatus> | null = null;
  private queued: Promise<EmailSyncStatus> | null = null;
  /** This run's model failure worth reporting, and whether it means the model is out for the rest of the run. */
  private modelError: unknown = null;
  private modelDown = false;

  constructor(private deps: SyncDeps) {
    this.state.lastSyncAt = this.latestSyncAt();
    this.state.pendingCount = this.waitingCount();
  }

  private now(): Date { return this.deps.now ? this.deps.now() : new Date(); }
  private latestSyncAt(): string | null {
    try {
      const all = this.deps.store.listAccounts().map((a) => a.lastSyncAt).filter(Boolean) as string[];
      return all.sort().pop() ?? null;
    } catch { return null; }
  }
  private waitingCount(email?: string): number {
    try { return this.deps.store.countWaiting(email); } catch { return 0; }
  }

  private set(patch: Partial<EmailSyncStatus>): void {
    this.state = { ...this.state, ...patch };
    try { this.deps.onStatus?.(this.status()); } catch { /* a closed window must not break a sync */ }
  }

  /** pendingCount: emails stored but still waiting for the model to read them. */
  status(): EmailSyncStatus {
    return { ...this.state };
  }

  get running(): boolean { return this.current !== null; }

  /**
   * Start a sync unless one is running; either way, resolves when that run
   * ends. With `again` (a new inbox was just added), a running sync is
   * followed by one more run instead of absorbing the request.
   */
  start(opts: { again?: boolean } = {}): Promise<EmailSyncStatus> {
    if (this.current) {
      if (!opts.again) return this.current;
      if (!this.queued) {
        this.queued = this.current.catch(() => undefined).then(() => { this.queued = null; return this.start(); });
      }
      return this.queued;
    }
    this.current = this.runAll().finally(() => { this.current = null; });
    return this.current;
  }

  private async runAll(): Promise<EmailSyncStatus> {
    const { store } = this.deps;
    const accounts = store.listAccounts();
    this.modelError = null;
    this.modelDown = false;
    this.set({ running: true, phase: 'connecting', message: 'Starting', seen: 0, candidates: 0, proposals: 0, autoApplied: 0, error: null });
    // First what earlier runs stored but could not read (and anything the old
    // review flow left pending): if Claude is back, it is decided now.
    try { await this.reprocessPending(); } catch { /* retried on the next run */ }
    let firstError: string | null = null;
    const synced: string[] = [];
    for (const account of accounts) {
      try {
        await this.syncAccount(account);
        synced.push(account.email);
      } catch (err) {
        const msg = this.deps.explain ? this.deps.explain(err, account.email) : (err instanceof Error ? err.message : String(err));
        firstError = firstError ?? msg;
        try { store.recordSync(account.email, this.now().toISOString(), msg); } catch { /* account removed mid-run */ }
      }
    }

    // Nothing waits silently: an inbox with unread emails says how many and why.
    const waiting = this.waitingCount();
    const reason = waiting ? explainModelFailure(this.modelError) : '';
    for (const email of synced) {
      const n = this.waitingCount(email);
      if (n) { try { store.setAccountError(email, waitingNote(n, reason)); } catch { /* account removed mid-run */ } }
    }

    const lastSyncAt = this.latestSyncAt();
    if (firstError) {
      this.set({ running: false, phase: 'error', message: firstError, error: firstError, lastSyncAt, pendingCount: waiting });
    } else {
      const message = accounts.length === 0
        ? 'No email account connected'
        : `${this.state.autoApplied} updated${waiting ? `, ${waiting} waiting: ${reason}` : ''}`;
      this.set({ running: false, phase: 'done', message, error: null, lastSyncAt, pendingCount: waiting });
    }
    return this.status();
  }

  private async syncAccount(account: AccountRow): Promise<void> {
    const { store } = this.deps;
    const { email } = account;
    const backlog = !account.backlogDone;
    this.set({ phase: 'connecting', message: `Connecting to ${email}` });
    const password = await this.deps.getPassword(email);
    if (!password) throw new Error(`No saved password for ${email}. Remove the account and add it again.`);

    const now = this.now();
    let since: Date;
    if (backlog) {
      const earliest = store.earliestApplicationAt();
      const t = earliest ? new Date(earliest).getTime() : NaN;
      since = new Date((Number.isFinite(t) ? t : now.getTime() - 120 * DAY_MS) - BACKLOG_LEAD_DAYS * DAY_MS);
    } else {
      // Anchored on the last sync, not on now: a catch-up after a week away
      // (laptop shut, battery flat) reads the whole gap.
      const last = account.lastSyncAt ? new Date(account.lastSyncAt).getTime() : NaN;
      const anchor = Number.isFinite(last) ? Math.min(last, now.getTime()) : now.getTime();
      since = new Date(anchor - INCREMENTAL_LOOKBACK_DAYS * DAY_MS);
    }

    const own = store.ownAddresses();
    const baseSeen = this.state.seen;
    this.set({ phase: 'scanning', message: backlog ? `Reading ${email} since ${since.toISOString().slice(0, 10)}` : `Checking ${email}` });
    const scans = await this.deps.fetcher({
      email, password, provider: 'gmail', since, ownAddresses: own,
      // The backlog ignores any watermark: it is a full pass from `since`.
      watermarkFor: (folder) => (backlog ? null : store.getWatermark(email, folder)),
      onProgress: (seen) => this.set({ seen: baseSeen + seen }),
    });
    this.set({ seen: baseSeen + scans.reduce((n, s) => n + s.seen, 0) });

    for (const scan of scans) {
      const fresh = scan.messages
        .map((m) => ({ ...m, messageId: m.messageId || `${email}|${scan.folder}|${scan.uidValidity}|${m.uid}` }))
        .filter((m) => !store.hasMessage(m.messageId));
      this.set({ phase: 'classifying', candidates: this.state.candidates + fresh.length, message: `Reading ${fresh.length} job emails` });

      const classified: (Classified | null)[] = new Array(fresh.length).fill(null);
      const { failed, ranked } = await this.readEmails(fresh, own, (i, c) => {
        // The backlog saves each email the moment it is read: a quit or restart
        // mid-backlog then loses nothing, and the next run skips what is saved
        // (hasMessage above). Stage rules never move backwards, so read order is safe.
        if (backlog) { if (store.getAccount(email)) this.settle(email, fresh[i], c); }
        else classified[i] = c;
      });
      this.set({ message: `Read ${fresh.length} job emails` });

      // Decide and apply oldest first, so a later email wins over an earlier one.
      const ready = fresh
        .map((m, i) => ({ m, c: classified[i] }))
        .filter((x): x is { m: ScannedMessage; c: Classified } => x.c !== null)
        .sort((a, b) => a.m.sentAt.localeCompare(b.m.sentAt));
      for (const { m, c } of ready) this.settle(email, m, c);

      if (!store.getAccount(email)) return; // removed while syncing: leave nothing behind
      // What the model could not read is stored, waiting, with its text; every
      // later run reads it again. So nothing is lost and the watermark moves on.
      for (const i of failed) this.holdForLater(email, fresh[i], ranked[i]);
      store.setWatermark(email, scan.folder, { uidValidity: scan.uidValidity, lastUid: scan.highestUid });
    }
    // Every email in the scan is now decided or stored waiting: a backlog is done.
    if (store.getAccount(email)) store.recordSync(email, this.now().toISOString(), null, backlog);
  }

  /**
   * Every model call goes through here. Once the model is plainly unavailable
   * (signed out, missing, at its limit, offline) the rest of the run stops
   * asking: a long backlog must not spawn a failing `claude` per email.
   */
  private async askModel<T>(call: () => Promise<T>): Promise<T> {
    if (this.modelDown) throw this.modelError;
    try {
      return await call();
    } catch (err) {
      if (!this.modelError || (isModelUnavailable(err) && !isModelUnavailable(this.modelError))) this.modelError = err;
      if (isModelUnavailable(err)) this.modelDown = true;
      throw err;
    }
  }

  /**
   * Read a set of emails: their own mail and the obvious cases without the model,
   * the rest in batches against their shortlists, then the unplaced ones that
   * matter against every application. `onDone` fires as each one is decided;
   * the ones the model could not read come back in `failed`, with every
   * email's shortlist in `ranked`.
   */
  private async readEmails(
    msgs: ScannedMessage[], own: string[], onDone: (i: number, c: Classified) => void,
  ): Promise<{ failed: number[]; ranked: AppLite[][] }> {
    const { store } = this.deps;
    const failed: number[] = [];
    const apps = store.listApps();
    const prepared = msgs.map((m) => this.prepare(m, apps));
    const unplaced = (): Classified => ({ result: { applicationId: null, kind: 'other', confidence: 0, evidence: '' }, ranked: [], text: '' });

    // 1. No model needed: their own mail, or an obvious receipt or rejection.
    //    Nothing plausible on the shortlist goes straight to the second look.
    const needModel: number[] = [];
    const needSecond: number[] = [];
    const pass1: (Classified | null)[] = new Array(msgs.length).fill(null);
    prepared.forEach((p, i) => {
      if (isOwnAddress(msgs[i].fromAddress, own)) return onDone(i, unplaced());
      if (!p.pool.length) { pass1[i] = { ...unplaced(), text: p.text }; needSecond.push(i); return; }
      const quick = quickClassify(msgs[i].subject, p.body, p.ranked);
      if (quick) return onDone(i, { result: quick, ranked: p.ranked, text: p.text });
      needModel.push(i);
    });

    // 2. The shortlist pass, in batches (or one by one when no batch classifier is wired).
    const size = this.deps.classifyBatch ? CLASSIFY_BATCH : 1;
    await mapPool(chunk(needModel, size), this.deps.concurrency ?? 3, async (ids) => {
      let raws: (ClassifyResult | null)[] | null = null;
      if (this.deps.classifyBatch && ids.length > 1) {
        try {
          const out = await this.askModel(() => this.deps.classifyBatch!(ids.map((i) => prepared[i].input)));
          if (Array.isArray(out) && out.length === ids.length) raws = out;
        } catch { /* fall back to one at a time */ }
      }
      for (let j = 0; j < ids.length; j++) {
        const i = ids[j];
        try {
          const raw = raws ? raws[j] : await this.askModel(() => this.deps.classify(prepared[i].input));
          const c: Classified = { result: normaliseResult(raw, prepared[i].pool), ranked: prepared[i].ranked, text: prepared[i].text };
          if (!c.result.applicationId && STAGE_KINDS.has(c.result.kind) && this.deps.classifySecondPass) { pass1[i] = c; needSecond.push(i); }
          else onDone(i, c);
        } catch { failed.push(i); }
      }
    });

    // 3. The second look: every unplaced email that matters, against all their applications.
    if (needSecond.length) {
      this.set({ message: `Matching ${needSecond.length} emails against every application` });
      const results = await this.secondPass(needSecond.map((i) => ({ ...prepared[i].second })), store.listApps());
      needSecond.forEach((i, k) => {
        const r = results[k];
        if (r === undefined) { failed.push(i); return; }
        onDone(i, r ? { ...r, ranked: pass1[i]!.ranked, text: prepared[i].text } : pass1[i]!);
      });
    }
    return { failed, ranked: prepared.map((p) => p.ranked) };
  }

  /**
   * The second look, CLASSIFY_BATCH emails per call against every application.
   * Per email: the classified result (with the company/role guess), null when
   * no second-pass classifier is wired (keep the first result), or undefined
   * when the model failed on it (it waits for a later run).
   */
  private async secondPass(emails: SecondPassEmail[], apps: AppLite[]): Promise<(Omit<Classified, 'ranked' | 'text'> | null | undefined)[]> {
    const fn = this.deps.classifySecondPass;
    if (!fn) return emails.map(() => null);
    const out: (Omit<Classified, 'ranked' | 'text'> | null | undefined)[] = new Array(emails.length).fill(undefined);
    const toClassified = (r: SecondPassResult) => ({
      result: normaliseResult(r, apps),
      guess: { company: cleanGuess(r?.company), role: cleanGuess(r?.role) },
    });
    const idx = emails.map((_, i) => i);
    await mapPool(chunk(idx, CLASSIFY_BATCH), this.deps.concurrency ?? 3, async (ids) => {
      try {
        const res = await this.askModel(() => fn(ids.map((i) => emails[i]), apps));
        if (!Array.isArray(res) || res.length !== ids.length) throw new Error('second pass count mismatch');
        ids.forEach((i, k) => { out[i] = toClassified(res[k]); });
        return;
      } catch { /* one at a time below */ }
      if (ids.length === 1) return;
      for (const i of ids) {
        try {
          const [r] = await this.askModel(() => fn([emails[i]], apps));
          if (r) out[i] = toClassified(r);
        } catch { /* stays undefined: it waits for a later run */ }
      }
    });
    return out;
  }

  /** Everything about one email that does not need the model. */
  private prepare(m: ScannedMessage, apps: AppLite[]) {
    const body = (m.body || '').slice(0, 3000);
    const ranked = rankCandidates({ fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, body }, apps).map((r) => r.app);
    const pool = ranked.length ? ranked : plausibleApps(apps, m.sentAt);
    const from = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress;
    const input: ClassifyInput = { from, subject: m.subject, date: m.sentAt, body, candidates: pool };
    const second: SecondPassEmail = { from, subject: m.subject, date: m.sentAt, body };
    return { body, ranked, pool, input, second, text: `${m.subject}\n${body}` };
  }

  /**
   * The application an email lands on: the model's match, or for an unplaced
   * interview/offer, an existing application for the company the email names
   * (normalised), or a new one. Several emails from one company in a run
   * create one application: the second finds the first by name. A job board's
   * templated subject names the employer and role better than its sender does
   * ("SEEK Applications" is nobody's employer).
   */
  private resolveApp(c: Classified, m: { fromName: string; fromAddress: string; subject: string }): AppLite | null {
    const { store, stages } = this.deps;
    const { result } = c;
    if (result.applicationId) return store.getApp(result.applicationId);
    if (!CREATE_KINDS.has(result.kind) || result.confidence < AUTO_APPLY_CONFIDENCE) return null;
    const board = parseJobBoardSubject(m.subject);
    const company = c.guess?.company || board?.company || companyFromSender(m.fromName, m.fromAddress);
    if (!company || company.replace(/[^a-z0-9]/gi, '').length < 2) return null;
    const existing = findCompanyMatch(company, store.listApps());
    if (existing) return existing;
    const id = stages.create({
      company,
      role: c.guess?.role || board?.role || roleFromSubject(m.subject),
      notes: `Created from email: ${String(m.subject || '(no subject)').replace(/\s+/g, ' ').trim().slice(0, 160)}`,
    });
    return store.getApp(id);
  }

  /** An email the model could not read: stored as 'pending' with its text, so a later run can. */
  private holdForLater(email: string, m: ScannedMessage, ranked: AppLite[]): void {
    this.deps.store.insertEvent({
      email, messageId: m.messageId, fromAddress: m.fromAddress, subject: m.subject, sentAt: m.sentAt,
      applicationId: null, kind: 'other', confidence: 0, evidence: '', fromStage: null, proposedStage: null,
      status: 'pending', candidates: ranked.map(toCandidate),
      pendingInput: { fromName: m.fromName || '', body: (m.body || '').slice(0, WAITING_BODY_CHARS) },
    }, this.now().toISOString());
  }

  /**
   * Decide one classified email and make its change. A new email is inserted;
   * one that was waiting (`waitingId`) is updated in place, and only while it
   * is still waiting, so nothing is ever applied twice.
   */
  private settle(email: string, m: ScannedMessage, c: Classified, waitingId?: string): void {
    const { store } = this.deps;
    // Checked before anything is created: a message already decided does nothing twice.
    if (waitingId) { if (store.getEvent(waitingId)?.status !== 'pending') return; }
    else if (store.hasMessage(m.messageId)) return;
    // Read the row fresh: an earlier email in this run may have moved it.
    const app = this.resolveApp(c, m);
    const d = decideEvent({ kind: c.result.kind, confidence: c.result.confidence, app, text: c.text });
    const candidates = (c.ranked.length ? c.ranked : []).map(toCandidate);
    if (app && !candidates.some((x) => x.applicationId === app.id)) candidates.unshift(toCandidate(app));
    const decided = {
      // An ignored email is linked to nothing, so it never shows on an application.
      applicationId: d.status === 'ignored' ? null : app?.id ?? null, kind: c.result.kind, confidence: c.result.confidence,
      evidence: c.result.evidence, fromStage: d.fromStage, proposedStage: d.proposedStage, status: d.status, candidates,
    };

    // Stored first: if the message is already there, nothing gets applied twice.
    let id: string | null;
    if (waitingId) {
      store.updateEvent(waitingId, { ...decided, pendingInput: null });
      id = waitingId;
    } else {
      id = store.insertEvent({ email, messageId: m.messageId, fromAddress: m.fromAddress, subject: m.subject, sentAt: m.sentAt, ...decided }, this.now().toISOString());
    }
    if (!id) return;

    // A newly decided email, regardless of its classified kind: does it ask them
    // to book a time or verify SEEK Pass? Independent of the stage decision.
    // Best effort: the event row is already stored, so a throw here would skip
    // the stage change below for good (the message never comes round again).
    // A match under the auto-apply bar is not trusted to name the application.
    if (this.deps.actionItems) {
      try {
        const detected = detectActionEmail({ subject: '', body: c.text });
        if (detected) {
          const linked = app && c.result.confidence >= AUTO_APPLY_CONFIDENCE ? app : null;
          this.deps.actionItems.upsertDetected({
            detected, applicationId: linked?.id ?? null, company: linked?.company ?? null, role: linked?.job_title ?? null,
            email, messageId: m.messageId, sentAt: m.sentAt,
          });
        }
      } catch (e) {
        console.warn('[email] action item detection failed:', e instanceof Error ? e.message : e);
      }
    }

    if (d.apply && app) {
      const historyId = this.applyChange(app, c.result.kind, d.proposedStage, m.subject, m.sentAt);
      store.updateEvent(id, { stageHistoryId: historyId });
      this.set({ autoApplied: this.state.autoApplied + 1 });
    }
  }

  /** Make the change on the application. Returns the stage_history id when a stage moved. */
  private applyChange(app: AppLite, kind: EmailKind, proposedStage: string | null, subject: string, sentAt: string): string | null {
    const note = emailNote(subject, sentAt);
    if (proposedStage) return this.deps.stages.move(app.id, proposedStage, note);
    if (kind === 'assessment') this.deps.stages.addNote(app.id, note);
    return null;
  }

  /**
   * Every 'pending' event, decided under today's rules. Two kinds:
   *  - waiting: stored because the model could not read it. It is read now
   *    from its stored text exactly as a fresh email would be; one the model
   *    still cannot read stays waiting (counted as retry).
   *  - left by the old review flow: only the subject and evidence were stored,
   *    so they stand in for the body (own mail ignored, the second look for the
   *    unplaced, creation for unknown companies, the 0.5 bar). An event whose
   *    second look fails stays pending and is retried on the next run.
   * Idempotent; once none are left this is a single cheap query.
   */
  async reprocessPending(): Promise<{ applied: number; ignored: number; retry: number }> {
    const { store } = this.deps;
    const all = store.listEvents({ status: 'pending' }).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const tally = { applied: 0, ignored: 0, retry: 0 };
    if (!all.length) return tally;

    const waiting = all.filter((e) => e.pendingInput);
    if (waiting.length) await this.readWaiting(waiting, tally);

    const pending = all.filter((e) => !e.pendingInput);
    if (!pending.length) return tally;
    const own = store.ownAddresses();

    const ignore = (e: StoredEvent) => {
      store.updateEvent(e.id, { status: 'ignored', applicationId: null, proposedStage: null, stageHistoryId: null });
      tally.ignored++;
    };
    // The stored proposal knew the full body; keep its phone-screen reading.
    const textOf = (e: StoredEvent) => `${e.subject}\n${e.evidence}${e.proposedStage === 'phone_screen' ? '\nphone screen' : ''}`;

    const ready: { e: StoredEvent; c: Classified }[] = [];
    const second: StoredEvent[] = [];
    for (const e of pending) {
      if (isOwnAddress(e.fromAddress, own) || e.kind === 'other') { ignore(e); continue; }
      const app = e.applicationId ? store.getApp(e.applicationId) : null;
      const c: Classified = {
        result: { applicationId: app?.id ?? null, kind: e.kind, confidence: e.confidence, evidence: e.evidence },
        ranked: [], text: textOf(e),
      };
      if (!app && STAGE_KINDS.has(e.kind) && this.deps.classifySecondPass) second.push(e);
      else ready.push({ e, c });
    }

    if (second.length) {
      this.set({ message: `Re-checking ${second.length} earlier emails` });
      const all = store.listApps();
      const results = await this.secondPass(second.map((e) => ({ from: e.fromAddress, subject: e.subject, date: e.sentAt, body: e.evidence })), all);
      second.forEach((e, k) => {
        const r = results[k];
        if (r === undefined) { tally.retry++; return; }
        const base: Classified = { result: { applicationId: null, kind: e.kind, confidence: e.confidence, evidence: e.evidence }, ranked: [], text: textOf(e) };
        ready.push({ e, c: r ? { ...r, ranked: [], text: textOf(e) } : base });
      });
    }

    ready.sort((a, b) => a.e.sentAt.localeCompare(b.e.sentAt));
    for (const { e, c } of ready) {
      const app = this.resolveApp(c, { fromName: '', fromAddress: e.fromAddress, subject: e.subject });
      const d = decideEvent({ kind: c.result.kind, confidence: c.result.confidence, app, text: c.text });
      let historyId: string | null = null;
      if (d.apply && app) historyId = this.applyChange(app, c.result.kind, d.proposedStage, e.subject, e.sentAt);
      store.updateEvent(e.id, {
        status: d.status, applicationId: d.status === 'ignored' ? null : app?.id ?? null,
        fromStage: d.fromStage, proposedStage: d.proposedStage, stageHistoryId: historyId,
        kind: c.result.kind, confidence: c.result.confidence, evidence: c.result.evidence,
      });
      if (d.status === 'applied') tally.applied++; else tally.ignored++;
      if (d.apply && app) this.set({ autoApplied: this.state.autoApplied + 1 });
    }
    return tally;
  }

  /** Emails stored while the model could not read them: read now, oldest first, from their stored text. */
  private async readWaiting(rows: StoredEvent[], tally: { applied: number; ignored: number; retry: number }): Promise<void> {
    const { store } = this.deps;
    this.set({ message: `Reading ${rows.length} job emails that were waiting` });
    const msgs: ScannedMessage[] = rows.map((e) => ({
      uid: 0, messageId: e.messageId, fromAddress: e.fromAddress, fromName: e.pendingInput?.fromName ?? '',
      subject: e.subject, sentAt: e.sentAt, body: e.pendingInput?.body ?? '',
    }));
    const decided: { i: number; c: Classified }[] = [];
    const { failed } = await this.readEmails(msgs, store.ownAddresses(), (i, c) => { decided.push({ i, c }); });
    decided.sort((a, b) => msgs[a.i].sentAt.localeCompare(msgs[b.i].sentAt));
    for (const { i, c } of decided) {
      this.settle(rows[i].email, msgs[i], c, rows[i].id);
      const status = store.getEvent(rows[i].id)?.status;
      if (status === 'applied') tally.applied++;
      else if (status === 'ignored') tally.ignored++;
    }
    tally.retry += failed.length;
  }
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let k = 0; k < xs.length; k += size) out.push(xs.slice(k, k + size));
  return out;
}

// Inbox sync's tables. Written against the structural MigrationDb handle, so
// the same code runs on better-sqlite3 in the app and on node:sqlite in tests.
// No password column exists anywhere in here, by design (see keychain.ts).

import { randomUUID } from 'crypto';
import type { MigrationDb } from '../database';
import type { EmailAccount, EmailCandidate, EmailEvent, EmailEventStatus, EmailKind } from '../../shared/types';
import type { AppLite } from './match';
import type { Watermark } from './imap';
import { normaliseAddresses } from './prefilter';

export interface AccountRow extends EmailAccount {
  backlogDone: boolean;
}

export interface NewEvent {
  email: string;
  messageId: string;
  fromAddress: string;
  subject: string;
  sentAt: string;
  applicationId: string | null;
  kind: EmailKind;
  confidence: number;
  evidence: string;
  fromStage: string | null;
  proposedStage: string | null;
  status: EmailEventStatus;
  candidates: EmailCandidate[];
  stageHistoryId?: string | null;
  /** Only for an email waiting for the model: what it needs to read it later. */
  pendingInput?: PendingInput | null;
}

/** What a waiting email keeps so a later run can read it without going back to IMAP. */
export interface PendingInput {
  fromName: string;
  body: string;
}

/**
 * The stored row plus what the renderer never needs: the stage_history id of
 * the move it made, and for an email still waiting for the model, its text.
 */
export interface StoredEvent extends EmailEvent {
  stageHistoryId: string | null;
  pendingInput: PendingInput | null;
}

function parsePendingInput(raw: unknown): PendingInput | null {
  if (raw == null || raw === '') return null;
  try {
    const v = JSON.parse(String(raw));
    return { fromName: String(v?.fromName ?? ''), body: String(v?.body ?? '') };
  } catch {
    return { fromName: '', body: '' };
  }
}

const EVENT_SELECT = `
  SELECT e.*, a.company AS app_company, a.job_title AS app_role
    FROM email_events e LEFT JOIN applications a ON a.id = e.application_id`;

function toEvent(r: any): StoredEvent {
  let candidates: EmailCandidate[] = [];
  try { candidates = JSON.parse(r.candidates || '[]'); } catch { /* keep empty */ }
  return {
    id: r.id,
    email: r.email,
    messageId: r.message_id,
    fromAddress: r.from_address,
    subject: r.subject,
    sentAt: r.sent_at,
    applicationId: r.application_id ?? null,
    company: r.app_company ?? null,
    role: r.app_role ?? null,
    kind: r.kind,
    confidence: Number(r.confidence ?? 0),
    evidence: r.evidence ?? '',
    fromStage: r.from_stage ?? null,
    proposedStage: r.proposed_stage ?? null,
    status: r.status,
    candidates,
    stageHistoryId: r.stage_history_id ?? null,
    pendingInput: parsePendingInput(r.pending_input),
  };
}

/** The renderer's shape: the history handle and any stored email text stay in main. */
export function publicEvent(e: StoredEvent): EmailEvent {
  const { stageHistoryId: _h, pendingInput: _p, ...rest } = e;
  return rest;
}

export class EmailStore {
  constructor(private db: MigrationDb) {}

  // ── accounts ──
  listAccounts(): AccountRow[] {
    return this.db.prepare('SELECT * FROM email_accounts ORDER BY created_at ASC').all().map((r: any) => ({
      email: r.email,
      provider: 'gmail' as const,
      lastSyncAt: r.last_sync_at ?? null,
      lastError: r.last_error ?? null,
      backlogDone: Number(r.backlog_done) === 1,
    }));
  }

  getAccount(email: string): AccountRow | null {
    return this.listAccounts().find((a) => a.email === email) ?? null;
  }

  addAccount(email: string, now = new Date().toISOString()): void {
    this.db.prepare(`INSERT INTO email_accounts (email, provider, created_at, last_sync_at, last_error, backlog_done)
                     VALUES (?, 'gmail', ?, NULL, NULL, 0) ON CONFLICT(email) DO UPDATE SET last_error = NULL`).run(email, now);
  }

  /** The row and its watermarks go; the events stay (they are their history). */
  removeAccount(email: string): void {
    this.db.prepare('DELETE FROM email_watermarks WHERE email = ?').run(email);
    this.db.prepare('DELETE FROM email_accounts WHERE email = ?').run(email);
  }

  /** Set (or clear) the line shown in red under the account, leaving last_sync_at alone. */
  setAccountError(email: string, error: string | null): void {
    this.db.prepare('UPDATE email_accounts SET last_error = ? WHERE email = ?').run(error, email);
  }

  recordSync(email: string, at: string, error: string | null, backlogDone?: boolean): void {
    if (error) {
      this.db.prepare('UPDATE email_accounts SET last_error = ? WHERE email = ?').run(error, email);
      return;
    }
    this.db.prepare(`UPDATE email_accounts SET last_sync_at = ?, last_error = NULL${backlogDone ? ', backlog_done = 1' : ''} WHERE email = ?`)
      .run(at, email);
  }

  // ── watermarks ──
  getWatermark(email: string, folder: string): Watermark | null {
    const r = this.db.prepare('SELECT uid_validity, last_uid FROM email_watermarks WHERE email = ? AND folder = ?').get(email, folder) as any;
    return r ? { uidValidity: Number(r.uid_validity), lastUid: Number(r.last_uid) } : null;
  }

  setWatermark(email: string, folder: string, wm: Watermark): void {
    this.db.prepare(`INSERT INTO email_watermarks (email, folder, uid_validity, last_uid) VALUES (?, ?, ?, ?)
                     ON CONFLICT(email, folder) DO UPDATE SET uid_validity = excluded.uid_validity, last_uid = excluded.last_uid`)
      .run(email, folder, wm.uidValidity, wm.lastUid);
  }

  // ── applications (read side) ──
  listApps(): AppLite[] {
    return this.db.prepare('SELECT id, company, job_title, current_stage, created_at FROM applications').all() as AppLite[];
  }

  getApp(id: string): AppLite | null {
    return (this.db.prepare('SELECT id, company, job_title, current_stage, created_at FROM applications WHERE id = ?').get(id) as AppLite) ?? null;
  }

  earliestApplicationAt(): string | null {
    const r = this.db.prepare('SELECT MIN(created_at) AS t FROM applications').get() as any;
    return r?.t ?? null;
  }

  // ── events ──
  hasMessage(messageId: string): boolean {
    return !!this.db.prepare('SELECT 1 AS x FROM email_events WHERE message_id = ?').get(messageId);
  }

  /** Idempotent on message_id: a second insert of the same message is ignored. Returns whether it was new. */
  insertEvent(e: NewEvent, now = new Date().toISOString()): string | null {
    const id = randomUUID();
    const res = this.db.prepare(`INSERT INTO email_events (id, email, message_id, from_address, subject, sent_at,
        application_id, kind, confidence, evidence, from_stage, proposed_stage, status, candidates, stage_history_id, created_at, pending_input)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`).run(
      id, e.email, e.messageId, e.fromAddress, e.subject, e.sentAt, e.applicationId, e.kind, e.confidence,
      e.evidence, e.fromStage, e.proposedStage, e.status, JSON.stringify(e.candidates || []), e.stageHistoryId ?? null, now,
      e.pendingInput ? JSON.stringify(e.pendingInput) : null,
    );
    return Number(res?.changes ?? 0) > 0 ? id : null;
  }

  getEvent(id: string): StoredEvent | null {
    const r = this.db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id);
    return r ? toEvent(r) : null;
  }

  listEvents(opts: { status?: EmailEventStatus | 'all'; applicationId?: string } = {}): StoredEvent[] {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.status && opts.status !== 'all') { where.push('e.status = ?'); params.push(opts.status); }
    if (opts.applicationId) { where.push('e.application_id = ?'); params.push(opts.applicationId); }
    const sql = `${EVENT_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY e.sent_at DESC`;
    return this.db.prepare(sql).all(...params).map(toEvent);
  }

  updateEvent(id: string, patch: Partial<Pick<StoredEvent, 'status' | 'applicationId' | 'fromStage' | 'proposedStage' | 'stageHistoryId' | 'kind' | 'confidence' | 'evidence' | 'candidates' | 'pendingInput'>>): void {
    const cols: Record<string, string> = {
      status: 'status', applicationId: 'application_id', fromStage: 'from_stage',
      proposedStage: 'proposed_stage', stageHistoryId: 'stage_history_id',
      kind: 'kind', confidence: 'confidence', evidence: 'evidence',
      candidates: 'candidates', pendingInput: 'pending_input',
    };
    const sets: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cols)) continue;
      sets.push(`${cols[k]} = ?`);
      if (k === 'candidates') params.push(JSON.stringify(v || []));
      else if (k === 'pendingInput') params.push(v ? JSON.stringify(v) : null);
      else params.push(v === undefined ? null : v);
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE email_events SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }

  /** How many emails are stored but still waiting for the model to read them; per account when given. */
  countWaiting(email?: string): number {
    const sql = `SELECT COUNT(*) AS n FROM email_events WHERE status = 'pending' AND pending_input IS NOT NULL${email ? ' AND email = ?' : ''}`;
    const r = (email ? this.db.prepare(sql).get(email) : this.db.prepare(sql).get()) as any;
    return Number(r?.n ?? 0);
  }

  /**
   * Their own addresses: every connected account plus any address in them
   * profile (app_settings 'profile', a JSON object; whichever key holds it).
   * Mail from these is their sent mail, never a company writing back.
   */
  ownAddresses(): string[] {
    const out = this.listAccounts().map((a) => a.email);
    try {
      const r = this.db.prepare(`SELECT value FROM app_settings WHERE key = 'profile'`).get() as any;
      const profile = r?.value ? JSON.parse(r.value) : {};
      if (profile && typeof profile === 'object') {
        for (const v of Object.values(profile)) {
          const m = typeof v === 'string' ? v.match(/[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}/gi) : null;
          if (m) out.push(...m);
        }
      }
    } catch { /* no settings table or unreadable profile: accounts alone */ }
    return normaliseAddresses(out);
  }
}

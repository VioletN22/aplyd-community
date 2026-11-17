// action_items: anything outside Aplyd the user has to do themselves to keep an
// application moving - book a time, verify identity, solve a captcha, answer
// a question, create a portal account, finish a stalled application, or an
// optional extra. Two layers, same split as stats.ts: pure helpers (unit
// tested) and thin SQL functions written against the structural MigrationDb
// handle.
import { randomUUID } from 'crypto';
import { ipcMain } from 'electron';
import type { MigrationDb } from './database';
import { getDatabase } from './database';
import type { ActionItemPriority, TodayActionItem } from '../shared/types';
import { gmailSearchUrl } from './gmail-link';
import type { DetectedAction } from './email/action-detect';
import { dateKey } from '../shared/calendar';

export interface ActionItemRow {
  id: string;
  application_id: string | null;
  kind: string;
  title: string;
  detail: string | null;
  url: string | null;
  email_url: string | null;
  due_at: string | null;
  group_label: string | null;
  priority: ActionItemPriority;
  status: 'open' | 'done' | 'dismissed';
  source: 'agent' | 'email';
  created_at: string;
  updated_at: string;
  done_at: string | null;
  /** The item's own company/role, for an unlinked item that still names one specific employer. */
  company: string | null;
  role: string | null;
}

export interface NewActionItem {
  application_id?: string | null;
  kind: string;
  title: string;
  detail?: string | null;
  url?: string | null;
  email_url?: string | null;
  due_at?: string | null;
  group_label?: string | null;
  priority?: ActionItemPriority;
  status?: 'open' | 'done' | 'dismissed';
  source?: 'agent' | 'email';
  company?: string | null;
  role?: string | null;
}

/** Insert one row and hand back what was stored, ids and timestamps filled in. */
export function createActionItem(db: MigrationDb, input: NewActionItem, now: () => Date = () => new Date()): ActionItemRow {
  const ts = now().toISOString();
  const row: ActionItemRow = {
    id: randomUUID(),
    application_id: input.application_id ?? null,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    url: input.url ?? null,
    email_url: input.email_url ?? null,
    due_at: input.due_at ?? null,
    group_label: input.group_label ?? null,
    priority: input.priority ?? 'normal',
    status: input.status ?? 'open',
    source: input.source ?? 'agent',
    created_at: ts,
    updated_at: ts,
    done_at: null,
    company: input.company ?? null,
    role: input.role ?? null,
  };
  db.prepare(`INSERT INTO action_items
      (id, application_id, kind, title, detail, url, email_url, due_at, group_label, priority, status, source, created_at, updated_at, done_at, company, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.application_id, row.kind, row.title, row.detail, row.url, row.email_url, row.due_at, row.group_label,
    row.priority, row.status, row.source, row.created_at, row.updated_at, row.done_at, row.company, row.role,
  );
  return row;
}

/** Marks one item done; removes it from Today on the next load. */
export function markActionItemDone(db: MigrationDb, id: string, now: () => Date = () => new Date()): void {
  const ts = now().toISOString();
  db.prepare(`UPDATE action_items SET status = 'done', done_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
}

/** Kinds that can no longer be done once their deadline passes: a closed quiz or test cannot be taken. */
export const EXPIRING_KINDS: readonly string[] = ['assessment', 'quiz', 'take_home', 'take-home', 'oa'];

/**
 * Has this due date passed? A bare date (YYYY-MM-DD) lasts the whole of that
 * configured local day; a timestamp passes at that instant. Undated or unreadable: no.
 */
export function deadlinePassed(dueAt: string | null | undefined, now: Date): boolean {
  if (!dueAt) return false;
  const v = dueAt.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v < dateKey(now);
  }
  const t = Date.parse(v);
  return Number.isFinite(t) && t < now.getTime();
}

/**
 * Open assessment-type items whose deadline has passed are dismissed: the quiz
 * or test is closed, so it is not something left to do. Other overdue items
 * (apply, reply, verify) stay, because they can still be done late. Undated
 * assessments stay too: nothing says they have closed.
 */
export function dismissExpiredAssessments(db: MigrationDb, now: () => Date = () => new Date()): number {
  const at = now();
  const marks = EXPIRING_KINDS.map(() => '?').join(', ');
  const open = db.prepare(`SELECT id, due_at FROM action_items WHERE status = 'open' AND kind IN (${marks})`).all(...EXPIRING_KINDS) as { id: string; due_at: string | null }[];
  const expired = open.filter((r) => deadlinePassed(r.due_at, at));
  const ts = at.toISOString();
  const update = db.prepare(`UPDATE action_items SET status = 'dismissed', updated_at = ? WHERE id = ?`);
  for (const r of expired) update.run(ts, r.id);
  return expired.length;
}

/** Kinds that are something happening at a set time, not a job to do: once over, there is nothing left to tick. */
export const EVENT_KINDS: readonly string[] = ['other', 'interview', 'phone_screen', 'meeting', 'call', 'shift'];

/**
 * Pure: is this open item an event or day briefing that is now over? A timed
 * event is over at its end (ends_at, else the end of its day). A day briefing ("Today:
 * Morning call; 2pm meeting; ...") is over once its day has gone. Undated, and
 * date-only events (no time), stay: nothing says when they end.
 */
export function eventIsOver(r: { kind: string; title: string; due_at: string | null; ends_at: string | null }, now: Date): boolean {
  const due = r.due_at?.trim();
  if (!due || (/T/.test(due) && !Number.isFinite(Date.parse(due)))) return false;
  if (/^today\b/i.test(r.title)) {
    const day = /T/.test(due) ? dateKey(new Date(due)) : due.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < dateKey(now);
  }
  if (!EVENT_KINDS.includes(r.kind) || !/T/.test(due)) return false;
  // With no recorded end it lasts the rest of its day, so it never vanishes while still on.
  return deadlinePassed(r.ends_at || dateKey(new Date(due)), now);
}

/** Events and day briefings that are over are dismissed, like closed assessments. */
export function dismissPassedEvents(db: MigrationDb, now: () => Date = () => new Date()): number {
  const at = now();
  const open = db.prepare(`SELECT id, kind, title, due_at, ends_at FROM action_items WHERE status = 'open' AND due_at IS NOT NULL`).all() as { id: string; kind: string; title: string; due_at: string | null; ends_at: string | null }[];
  const over = open.filter((r) => eventIsOver(r, at));
  const update = db.prepare(`UPDATE action_items SET status = 'dismissed', updated_at = ? WHERE id = ?`);
  for (const r of over) update.run(at.toISOString(), r.id);
  return over.length;
}

/** Dismisses one item the user no longer wants (a stale to-do). Not counted as done. */
export function dismissActionItem(db: MigrationDb, id: string, now: () => Date = () => new Date()): void {
  db.prepare(`UPDATE action_items SET status = 'dismissed', updated_at = ? WHERE id = ?`).run(now().toISOString(), id);
}

export interface OpenActionItemRow {
  id: string; application_id: string | null; kind: string; title: string; detail: string | null;
  url: string | null; email_url: string | null; due_at: string | null; ends_at: string | null; group_label: string | null;
  priority: ActionItemPriority; company: string | null; role: string | null;
}

/**
 * Every open action item. company/role: the linked application's, when there
 * is one, else the item's own (set at creation for an unlinked item that
 * still names one employer, e.g. from an email match) - never invented, so a
 * genuinely grouped item (SEEK Pass) keeps neither and falls back to its
 * group_label in the renderer.
 */
export function listOpenActionItems(db: MigrationDb, now: () => Date = () => new Date()): OpenActionItemRow[] {
  dismissExpiredAssessments(db, now);
  dismissPassedEvents(db, now);
  const rows = db.prepare(`SELECT i.id, i.application_id, i.kind, i.title, i.detail, i.url, i.email_url, i.due_at, i.ends_at, i.group_label, i.priority,
      COALESCE(a.company, i.company) AS company, COALESCE(a.job_title, i.role) AS role,
      i.created_at, a.current_stage AS app_stage, a.interview_at AS app_interview_at
    FROM action_items i LEFT JOIN applications a ON a.id = i.application_id
    WHERE i.status = 'open'`).all() as (OpenActionItemRow & ActionItemVisibility)[];
  return rows.filter(isActionItemLive).map(({ created_at: _c, app_stage: _s, app_interview_at: _i, ...r }) => r);
}

export interface ActionItemVisibility {
  kind: string;
  created_at: string;
  app_stage: string | null;
  app_interview_at: string | null;
}

/**
 * Pure: is an open item still worth showing? Not once its application is
 * rejected or withdrawn (nothing left to do for it), and a "book a time" item
 * not once an interview was booked after it came in - Today already shows the
 * interview itself. The row stays open in the table; it is just not shown.
 */
export function isActionItemLive(r: ActionItemVisibility): boolean {
  if (r.app_stage === 'rejected' || r.app_stage === 'withdrawn') return false;
  if (r.kind === 'schedule' && r.app_interview_at) {
    const booked = new Date(r.app_interview_at).getTime();
    const created = new Date(r.created_at).getTime();
    if (Number.isFinite(booked) && Number.isFinite(created) && booked > created) return false;
  }
  return true;
}

/** Pure: OpenActionItemRow (snake_case, straight off the join) to the camelCase shape Today sends the renderer. */
export function toTodayActionItems(rows: OpenActionItemRow[]): TodayActionItem[] {
  return rows.map((r) => ({
    id: r.id, applicationId: r.application_id, kind: r.kind, title: r.title, detail: r.detail,
    company: r.company, role: r.role, groupLabel: r.group_label, dueAt: r.due_at, endsAt: r.ends_at, priority: r.priority,
    url: r.url, emailUrl: r.email_url,
  }));
}

// ── Inbox-sync dedup: grouping instead of duplicating ───────────────────────

export const SEEK_PASS_GROUP_PREFIX = 'SEEK Pass';

/**
 * Pure: fold one more employer into a SEEK Pass group_label, in order,
 * without repeating a name it already has. `current` is the group_label of
 * the existing open row, or null when there isn't one yet.
 */
export function appendEmployerToGroupLabel(current: string | null, employer: string | null, prefix = SEEK_PASS_GROUP_PREFIX): string {
  const body = current ? current.replace(new RegExp(`^${prefix}:?\\s*`), '') : '';
  const names = body.split(',').map((s) => s.trim()).filter(Boolean);
  const name = employer?.trim();
  if (name && !names.includes(name)) names.push(name);
  return names.length ? `${prefix}: ${names.join(', ')}` : prefix;
}

const seekPassDetail = (groupLabel: string): string => {
  const names = groupLabel.replace(new RegExp(`^${SEEK_PASS_GROUP_PREFIX}:?\\s*`), '');
  return names ? `Employers asking for Digital Identity: ${names}` : 'An employer asked for your SEEK Pass Digital Identity.';
};

export interface DetectedEmailContext {
  detected: DetectedAction;
  applicationId: string | null;
  company: string | null;
  role: string | null;
  email: string;
  messageId: string;
  sentAt: string;
}

/**
 * What a newly-seen email implies for action_items: create a row, or for a
 * kind that dedupes, fold into the one open row that already covers it
 * instead of stacking a duplicate.
 *  - schedule: one open row per application. Nothing is created for an email
 *    that never resolved to an application - there is nothing to show it
 *    against yet.
 *  - seek_pass_verify: one open row, ever (application_id is always null,
 *    since it is not about one application); a new employer just grows its
 *    group_label/detail.
 */
export function upsertDetectedActionItem(db: MigrationDb, ctx: DetectedEmailContext, now: () => Date = () => new Date()): void {
  const emailUrl = gmailSearchUrl(ctx.email, ctx.messageId);

  if (ctx.detected.type === 'schedule') {
    if (!ctx.applicationId) return; // no application to show it against
    const existing = db.prepare(`SELECT id FROM action_items WHERE kind = 'schedule' AND application_id = ? AND status = 'open'`)
      .get(ctx.applicationId) as { id: string } | undefined;
    if (existing) return;
    createActionItem(db, {
      application_id: ctx.applicationId, kind: 'schedule', title: 'Book your interview time',
      detail: ctx.company ? `${ctx.company} sent a link to pick a time.` : 'Pick a time from the link in the email.',
      url: ctx.detected.url, email_url: emailUrl, source: 'email',
      // Redundant with the application join today, but keeps the title right
      // even if the application is later unlinked or deleted.
      company: ctx.company, role: ctx.role,
    }, now);
    return;
  }

  // seek_pass_verify: genuinely spans several employers, so - unlike every
  // other kind - company/role are deliberately left null; the group_label is
  // the only place its employers live.
  // An employer we could not name is not written in as "(employer unknown)":
  // the email still counts (it keeps or opens the one row), it just adds no name.
  const existing = db.prepare(`SELECT id, group_label, detail FROM action_items
      WHERE kind = 'verify' AND application_id IS NULL AND status = 'open' AND (group_label = ? OR group_label LIKE ?)`)
    .get(SEEK_PASS_GROUP_PREFIX, `${SEEK_PASS_GROUP_PREFIX}:%`) as { id: string; group_label: string | null; detail: string | null } | undefined;
  if (existing) {
    const groupLabel = appendEmployerToGroupLabel(existing.group_label, ctx.company);
    if (groupLabel === existing.group_label) return;
    db.prepare(`UPDATE action_items SET group_label = ?, detail = ?, updated_at = ? WHERE id = ?`)
      .run(groupLabel, seekPassDetail(groupLabel), now().toISOString(), existing.id);
    return;
  }
  const groupLabel = appendEmployerToGroupLabel(null, ctx.company);
  createActionItem(db, {
    application_id: null, kind: 'verify', title: 'Verify SEEK Pass Digital Identity',
    detail: seekPassDetail(groupLabel),
    url: 'https://app.seekpass.co/digital-identity/start', email_url: emailUrl, group_label: groupLabel, source: 'email',
  }, now);
}

/** The `today:markActionItemDone` and `today:dismissActionItem` IPC channels. Kept out of index.ts so this feature is self-contained. */
export function registerActionItemsIpc(): void {
  ipcMain.handle('today:dismissActionItem', async (_e, id: string) => {
    try { dismissActionItem(getDatabase() as unknown as MigrationDb, id); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('today:markActionItemDone', async (_e, id: string) => {
    try { markActionItemDone(getDatabase() as unknown as MigrationDb, id); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
}

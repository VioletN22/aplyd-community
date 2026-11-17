// Type-only import, erased at compile time so requiring this module is cheap.
// The native better-sqlite3 binding loads lazily in initializeDatabase(), keeping
// it off the app's cold-start critical path so the window can appear immediately.
import type DatabaseType from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  JobApplication,
  Workflow,
  StageHistory,
  GuidanceDoc,
  GuidanceType,
  GuidanceContent,
  ExtractedJobData,
  AnswerBankEntry,
  LockerDocument,
  VoiceNote,
  VoiceNoteKind,
  PortfolioLink,
  CoverLetter,
  STAGES,
  isStage,
} from '../shared/types';
import { emitAppEvent } from './events';

let db: DatabaseType.Database | null = null;

/**
 * The slice of a sqlite handle the schema + migration code actually uses.
 * Structural, not better-sqlite3 specific, so the ladder can be exercised in unit
 * tests against any driver (the tests run it on node:sqlite, since the shipped
 * better-sqlite3 binary is built for Electron's ABI, not plain node).
 */
export interface MigrationDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): any;
  };
}

/**
 * Initialize the SQLite database with all tables and schema
 */
export function initializeDatabase(): void {
  // Idempotent: safe to call from both the deferred startup path and the
  // macOS activate handler without leaking a second connection.
  if (db) return;

  const dbPath = path.join(app.getPath('userData'), 'job-tracker.db');

  // Lazy require: this is where the native binding actually loads.
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const handle = new Database(dbPath);
  try {
    prepareDatabase(handle);
  } catch (e) {
    // Refused or failed: let go of the file so nothing else writes to it.
    try { handle.close(); } catch { /* already closed */ }
    throw e;
  }
  db = handle;

  // Snapshot the migrated database, off the boot path. Kicked off here so every
  // entry point gets one; the promise is memoised, so a caller that wants to
  // report the outcome (index.ts does) just asks for it again.
  void startupBackup();
}

// ── Rolling daily backups ────────────────────────────────────────────────────
// One snapshot per day into userData/backups, newest 7 kept. It runs after the
// migrations (so a snapshot is always of a migrated, readable database) and it is
// fire-and-forget: nothing about it may keep the app from starting, so every
// failure resolves as a result object instead of throwing.

/** How many daily snapshots to keep on disk. */
const BACKUP_KEEP = 7;
const BACKUP_NAME = /^job-tracker-\d{4}-\d{2}-\d{2}\.db$/;

export interface BackupResult {
  ok: boolean;
  /** Where today's snapshot lives (written now, or already there). */
  file?: string;
  /** True when today's snapshot already existed, so nothing was copied. */
  skipped?: boolean;
  /** Snapshots on disk after pruning. */
  kept?: number;
  /** Older snapshots deleted this run. */
  pruned?: number;
  error?: string;
}

let backupRun: Promise<BackupResult> | null = null;

/**
 * Take (or confirm) today's snapshot. Safe to call from anywhere: the work
 * happens once per process and every later caller gets the same result, so the
 * startup path can fire it and the smoketest can await it.
 */
export function startupBackup(): Promise<BackupResult> {
  if (!backupRun) backupRun = runStartupBackup();
  return backupRun;
}

/** Delete all but the newest BACKUP_KEEP snapshots. Names sort chronologically. */
function pruneBackups(dir: string): { kept: number; pruned: number } {
  const files = fs.readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).sort().reverse();
  let pruned = 0;
  for (const stale of files.slice(BACKUP_KEEP)) {
    try { fs.unlinkSync(path.join(dir, stale)); pruned++; } catch { /* next launch retries */ }
  }
  return { kept: Math.min(files.length, BACKUP_KEEP), pruned };
}

async function runStartupBackup(): Promise<BackupResult> {
  try {
    const handle = db;
    if (!handle) return { ok: false, error: 'database not initialized' };
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `job-tracker-${today}.db`);

    if (fs.existsSync(file)) {
      const { kept, pruned } = pruneBackups(dir);
      console.log(`[backup] today's snapshot already exists, ${kept} kept`);
      return { ok: true, file, skipped: true, kept, pruned };
    }

    // better-sqlite3's own online backup: consistent under WAL, and it yields
    // between pages so it does not lock the app out of its own database.
    await handle.backup(file);
    const { kept, pruned } = pruneBackups(dir);
    console.log(`[backup] wrote ${file}, ${kept} kept, ${pruned} pruned`);
    return { ok: true, file, kept, pruned };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn('[backup] failed:', error);
    return { ok: false, error };
  }
}

/**
 * Every table and index, all CREATE ... IF NOT EXISTS, so it is safe to run on
 * an existing database. Exported so the migration tests can build a bare schema
 * and drive the ladder over it.
 */
export function createSchema(db: MigrationDb): void {
  // Create workflows table
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      stages TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  // Create applications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      job_title TEXT NOT NULL,
      location TEXT NOT NULL,
      job_url TEXT NOT NULL,
      job_source TEXT,
      salary_min REAL,
      salary_max REAL,
      equity TEXT,
      benefits TEXT,
      job_description TEXT NOT NULL,
      key_responsibilities TEXT NOT NULL,
      required_skills TEXT NOT NULL,
      nice_to_have_skills TEXT NOT NULL,
      team_info TEXT,
      hiring_timeline TEXT,
      application_deadline TEXT,
      current_stage TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    )
  `);

  // Create stage_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS stage_history (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      entered_at TEXT NOT NULL,
      exited_at TEXT,
      notes TEXT,
      guidance TEXT,
      outcome TEXT,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);

  // Create guidance_docs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS guidance_docs (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      guidance_type TEXT NOT NULL,
      content TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);

  // Create attachments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);

  // Create chat_messages table (per-application AI assistant)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id)
    )
  `);

  // ── Autopilot: learnable answer bank, document locker, voice profile ──────
  db.exec(`
    CREATE TABLE IF NOT EXISTS answer_bank (
      id TEXT PRIMARY KEY,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      context TEXT,
      patterns TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS locker_documents (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      file_path TEXT NOT NULL,
      tags TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_notes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_links (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cover_letters (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      job_url TEXT,
      body TEXT NOT NULL,
      is_final INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Legacy tables (autopilot_jobs, saved_searches, autopilot_needs) that the
  // app no longer reads or writes. They are still created so older databases
  // and the migration ladder stay valid.
  db.exec(`
    CREATE TABLE IF NOT EXISTS autopilot_jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      company TEXT,
      title TEXT,
      state TEXT NOT NULL DEFAULT 'queued',
      fit_score INTEGER,
      fit_reason TEXT,
      source TEXT,
      mode TEXT NOT NULL DEFAULT 'auto',
      filled_count INTEGER NOT NULL DEFAULT 0,
      needs_count INTEGER NOT NULL DEFAULT 0,
      screenshot_path TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id TEXT PRIMARY KEY,
      board TEXT NOT NULL,
      query TEXT NOT NULL,
      location TEXT,
      max_age_minutes INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);
  // Generic key/value settings (master toggle, daily target, schedule, profile JSON).
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS autopilot_needs (
      id TEXT PRIMARY KEY,
      norm_label TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      options_json TEXT,
      hint TEXT,
      job_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      answer TEXT,
      created_at TEXT NOT NULL,
      answered_at TEXT
    )
  `);

  // Create indices for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_applications_company ON applications(company);
    CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(current_stage);
    CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at);
    CREATE INDEX IF NOT EXISTS idx_stage_history_application_id ON stage_history(application_id);
    CREATE INDEX IF NOT EXISTS idx_guidance_docs_application_id ON guidance_docs(application_id);
    CREATE INDEX IF NOT EXISTS idx_guidance_docs_stage ON guidance_docs(stage);
    CREATE INDEX IF NOT EXISTS idx_attachments_application_id ON attachments(application_id);
    CREATE INDEX IF NOT EXISTS idx_autopilot_jobs_state ON autopilot_jobs(state);
    CREATE INDEX IF NOT EXISTS idx_autopilot_needs_status ON autopilot_needs(status);
  `);
}

/**
 * ALTER TABLE ADD COLUMN is the only way to widen an existing table in sqlite,
 * and it throws once the column is there. Swallow exactly that error and nothing
 * else, so a real failure (missing table, bad type) still surfaces.
 */
function addColumn(db: MigrationDb, table: string, col: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  } catch (e: any) {
    if (!/duplicate column name/i.test(String(e?.message))) throw e;
  }
}

/**
 * The numbered migration ladder. Each entry runs at most once, in a transaction,
 * and bumps PRAGMA user_version. This is where anything destructive belongs:
 * before the ladder these ran on EVERY launch, which meant a rewrite of live user
 * data on every single app start.
 */
export const MIGRATIONS: Array<{ v: number; up: (db: MigrationDb) => void }> = [
  {
    // Stamp every application that predates the job_source field as 'LinkedIn'
    // (where they were all sourced from). Rows added later keep whatever source
    // the user picks, they never get forced to LinkedIn.
    v: 1,
    up: (db) => {
      db.exec(`UPDATE applications SET job_source = 'LinkedIn' WHERE job_source IS NULL OR job_source = ''`);
    },
  },
  {
    // The raw posting text (letters are written from this now, not from the
    // 150-word extraction summary) plus the company research cache.
    v: 2,
    up: (db) => {
      addColumn(db, 'applications', 'raw_job_text', 'TEXT');
      db.exec(`CREATE TABLE IF NOT EXISTS company_research (
        company_norm TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',
        fetched_at TEXT NOT NULL
      )`);
    },
  },
  {
    // Purge junk needs captured before the nav/search-field fix (a site's global
    // "Search" box mistaken for a form field). One-time now, was every launch.
    v: 3,
    up: (db) => {
      db.exec(`DELETE FROM autopilot_needs WHERE norm_label='' OR norm_label LIKE '%search%'`);
    },
  },
  {
    // Merge the legacy 'started' stage into 'applied'. Adding a job to the
    // tracker means you have applied, so there is no pre-apply bucket. One-time
    // now, was every launch.
    v: 4,
    up: (db) => {
      // 1. Drop redundant 'started' rows for apps that already have an 'applied' row.
      db.exec(
        `DELETE FROM stage_history
           WHERE stage = 'started'
             AND application_id IN (SELECT application_id FROM stage_history WHERE stage = 'applied')`
      );
      // 2. Rename remaining 'started' history rows to 'applied'.
      db.exec(`UPDATE stage_history SET stage = 'applied' WHERE stage = 'started'`);
      // 3. Update current stage on applications.
      db.exec(`UPDATE applications SET current_stage = 'applied' WHERE current_stage = 'started'`);
      // 4. Strip 'started' out of saved workflow stage lists.
      const workflows = db.prepare(`SELECT id, stages FROM workflows`).all() as {
        id: string;
        stages: string;
      }[];
      const updateStages = db.prepare(`UPDATE workflows SET stages = ? WHERE id = ?`);
      for (const wf of workflows) {
        try {
          const stages: string[] = JSON.parse(wf.stages);
          if (stages.includes('started')) {
            const cleaned = stages.filter((s) => s !== 'started');
            if (!cleaned.includes('applied')) cleaned.unshift('applied');
            updateStages.run(JSON.stringify(cleaned), wf.id);
          }
        } catch {
          /* leave malformed rows untouched */
        }
      }
    },
  },
  {
    // Legacy tables (work_corpus, resumes) that the app no longer reads or
    // writes. The step stays so the ladder is unchanged, and existing rows are
    // never touched.
    v: 5,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS work_corpus (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        org TEXT,
        location TEXT,
        date_start TEXT,
        date_end TEXT,
        bullets TEXT NOT NULL DEFAULT '[]',
        evidence TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS resumes (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        body TEXT NOT NULL,
        label TEXT,
        is_final INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    },
  },
  {
    // Fit scoring (computed at ingest) and lightweight interview tracking.
    v: 6,
    up: (db) => {
      addColumn(db, 'applications', 'fit_score', 'INTEGER');
      addColumn(db, 'applications', 'fit_reason', 'TEXT');
      addColumn(db, 'applications', 'interview_at', 'TEXT');
      addColumn(db, 'applications', 'prep_notes', 'TEXT');
    },
  },
  {
    // Inbox sync: connected mailboxes (the password is in the Keychain, never
    // here), a UID watermark per mailbox folder, and every job email seen with
    // what it did. message_id UNIQUE is what makes a re-run a no-op.
    v: 7,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS email_accounts (
        email TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'gmail',
        created_at TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT,
        backlog_done INTEGER NOT NULL DEFAULT 0
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS email_watermarks (
        email TEXT NOT NULL,
        folder TEXT NOT NULL,
        uid_validity INTEGER NOT NULL,
        last_uid INTEGER NOT NULL,
        PRIMARY KEY (email, folder)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS email_events (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        from_address TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        sent_at TEXT NOT NULL,
        application_id TEXT,
        kind TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        evidence TEXT NOT NULL DEFAULT '',
        from_stage TEXT,
        proposed_stage TEXT,
        status TEXT NOT NULL,
        candidates TEXT NOT NULL DEFAULT '[]',
        stage_history_id TEXT,
        created_at TEXT NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_email_events_status ON email_events(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_email_events_app ON email_events(application_id)`);
    },
  },
  {
    // Wave 2: which locker resume was sent with each application. Nullable and
    // additive: no backfill, it is set on the next draft or by hand.
    v: 8,
    up: (db) => {
      addColumn(db, 'applications', 'resume_doc_id', 'TEXT');
    },
  },
  {
    // Exact office address, when supplied or entered by the user. Existing
    // location strings remain untouched and no address is invented from them.
    v: 9,
    up: (db) => {
      addColumn(db, 'applications', 'workplace_address', 'TEXT');
    },
  },
  {
    // Action items: anything outside Aplyd the user has to do themselves to move an
    // application forward that isn't itself an interview or assessment - book a
    // time, verify identity, solve a captcha, answer a question, create a
    // portal account, finish a stalled application, or an optional extra.
    // application_id is nullable: one item can span several applications (one
    // SEEK Pass verification several employers asked for).
    v: 10,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS action_items (
        id TEXT PRIMARY KEY,
        application_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        url TEXT,
        email_url TEXT,
        due_at TEXT,
        group_label TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        source TEXT NOT NULL DEFAULT 'agent',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        done_at TEXT
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_action_items_app ON action_items(application_id)`);
    },
  },
  {
    // An action item's own company/role, for the (common) case where it names
    // one specific employer but isn't linked to an application row - most
    // items detected from an email, or hand-seeded from a hand-off doc.
    // Without these every unlinked item read as "Several employers", which is
    // only true of a genuinely grouped one (SEEK Pass Digital Identity).
    v: 11,
    up: (db) => {
      addColumn(db, 'action_items', 'company', 'TEXT');
      addColumn(db, 'action_items', 'role', 'TEXT');
    },
  },
  {
    // Inbox sync: an email the model could not read (Claude signed out, at its
    // limit, unreachable) is stored as a 'pending' event instead of being
    // dropped, with what the next run needs to read it without IMAP: JSON
    // { fromName, body } (the first 3000 characters). Cleared once it is read.
    v: 12,
    up: (db) => {
      addColumn(db, 'email_events', 'pending_input', 'TEXT');
    },
  },
  {
    // v9 lived only on the workplace-address branch. Installed inbox-sync
    // builds already reached v12 without it, so catch those databases up.
    v: 13,
    up: (db) => {
      addColumn(db, 'applications', 'workplace_address', 'TEXT');
    },
  },
  {
    v: 14,
    up: (db) => {
      addColumn(db, 'applications', 'interview_minutes', 'INTEGER');
      db.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, started_at TEXT NOT NULL,
        ended_at TEXT, summary TEXT, details_json TEXT
      )`);
    },
  },
  {
    v: 15,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, application_id TEXT, lead_id TEXT,
        channel TEXT NOT NULL, from_account TEXT, to_address TEXT, subject TEXT,
        body TEXT NOT NULL, thread_hint TEXT, status TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT,
        sent_at TEXT, send_evidence TEXT, error TEXT
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_approvals_application ON approvals(application_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_approvals_lead ON approvals(lead_id)');
    },
  },
  {
    v: 16,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY, org TEXT NOT NULL, segment TEXT NOT NULL,
        contact_name TEXT, contact_email TEXT, contact_channel TEXT, website TEXT, demo_url TEXT,
        stage TEXT NOT NULL, next_step TEXT, next_due_at TEXT, value_estimate REAL, notes TEXT,
        do_not_contact INTEGER NOT NULL DEFAULT 0, conflict_flag INTEGER NOT NULL DEFAULT 0,
        source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS lead_events (
        id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT, at TEXT NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(contact_email)');
    },
  },
  {
    // An action item's end, for one that is a span of time rather than a
    // deadline: a rostered shift draws on the calendar from due_at to ends_at.
    v: 17,
    up: (db) => {
      addColumn(db, 'action_items', 'ends_at', 'TEXT');
    },
  },
  {
    // Neutral stored names for outreach. Draft kinds purpl_email and
    // purpl_followup become outreach_email and outreach_followup, and lead
    // segments clubs, local, ai and 3d become group_a to group_d (the Group A
    // to Group D the app already shows, in the same order). Only rows holding
    // an old value change, so a second run changes nothing.
    v: 18,
    up: (db) => {
      // Written out rather than imported, so this step never changes after it ships.
      const kinds: [string, string][] = [['purpl_email', 'outreach_email'], ['purpl_followup', 'outreach_followup']];
      const segments: [string, string][] = [['clubs', 'group_a'], ['local', 'group_b'], ['ai', 'group_c'], ['3d', 'group_d']];
      const kind = db.prepare('UPDATE approvals SET kind = ? WHERE kind = ?');
      for (const [from, to] of kinds) kind.run(to, from);
      const segment = db.prepare('UPDATE leads SET segment = ? WHERE segment = ?');
      for (const [from, to] of segments) segment.run(to, from);
    },
  },
];

/**
 * Everything that happens to a database file when it is opened, in order. The
 * newer-data check comes first, before anything writes to the file: switching
 * to WAL, creating tables and adding columns all change it.
 */
export function prepareDatabase(db: MigrationDb): void {
  refuseNewerData(db);
  db.exec('PRAGMA foreign_keys = ON');
  // Write-ahead logging: readers never block the writer, an interrupted write can
  // no longer leave a half-applied rollback journal behind, and NORMAL sync is the
  // right durability trade for WAL (a power cut can cost the last commit, never
  // the file). This is their live job history, so the file surviving matters more
  // than the last keystroke does.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  createSchema(db);
  runMigrationLadder(db);
}

export function latestSchemaVersion(): number {
  return MIGRATIONS.reduce((m, x) => Math.max(m, x.v), 0);
}

export function newerDataMessage(found: number, latest: number): string {
  return `This data was created by a newer version of Aplyd Community (data format ${found}; this app understands up to ${latest}). `
    + 'Nothing was changed. Install the newest version of Aplyd Community first, then open it again. '
    + "Restoring an older backup also opens in this version, but you lose everything added since that backup's date.";
}

/**
 * A database written by a newer app version must be refused, not opened: this
 * old code does not know the newer columns and would write rows that break the
 * newer schema. Reads only.
 */
export function refuseNewerData(db: MigrationDb): void {
  const found = getSchemaVersion(db);
  const latest = latestSchemaVersion();
  if (found > latest) throw new Error(newerDataMessage(found, latest));
}

export function getSchemaVersion(db: MigrationDb): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

/**
 * Additive column adds (safe every launch) followed by the numbered ladder.
 * Idempotent: running it twice on the same database is a no-op the second time.
 */
export function runMigrationLadder(db: MigrationDb): void {
  refuseNewerData(db);
  // Columns added to tables that already shipped. These stay per-launch because
  // they are pure schema widening, and the catch is narrowed to the one error
  // that means "already applied".
  addColumn(db, 'applications', 'job_source', 'TEXT');
  addColumn(db, 'cover_letters', 'application_id', 'TEXT');
  addColumn(db, 'cover_letters', 'label', 'TEXT');
  addColumn(db, 'autopilot_jobs', 'fit_reason', 'TEXT');
  addColumn(db, 'autopilot_jobs', 'source', 'TEXT');
  addColumn(db, 'autopilot_jobs', 'mode', `TEXT NOT NULL DEFAULT 'auto'`);
  addColumn(db, 'saved_searches', 'max_age_minutes', 'INTEGER NOT NULL DEFAULT 0');

  const from = getSchemaVersion(db);
  for (const m of MIGRATIONS) {
    if (m.v <= from) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.v}`);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }
}

/**
 * Get the database instance
 */
export function getDatabase(): DatabaseType.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  // Idempotent: several quit paths call it. Closing the last connection
  // checkpoints the WAL into job-tracker.db, so the file alone is complete.
  const handle = db;
  db = null;
  if (!handle) return;
  try { handle.close(); } catch (e) { console.warn('[db] close failed:', e instanceof Error ? e.message : e); }
}

// Workflow CRUD operations
//
// Per-company workflows are not used: every application moves along the fixed
// STAGES list. The table and applications.workflow_id stay (workflow_id is NOT
// NULL with a foreign key, and rebuilding the table would be destructive), so
// new rows all point at one shared row carrying STAGES. Nothing reads it.

/** The id of the one workflow row new applications reference. */
export const STANDARD_WORKFLOW_ID = 'standard';

/** Create the shared row on first use; idempotent. Returns its id. */
export function ensureStandardWorkflow(database: MigrationDb = getDatabase()): string {
  database.prepare(
    `INSERT OR IGNORE INTO workflows (id, company, name, stages, is_default, created_at) VALUES (?, '', 'Standard', ?, 0, ?)`
  ).run(STANDARD_WORKFLOW_ID, JSON.stringify(STAGES), new Date().toISOString());
  return STANDARD_WORKFLOW_ID;
}

/**
 * Create a new workflow
 */
export function createWorkflow(
  company: string,
  name: string,
  stages: string[],
  isDefault: boolean
): Workflow {
  const database = getDatabase();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const stagesJson = JSON.stringify(stages);

  const stmt = database.prepare(`
    INSERT INTO workflows (id, company, name, stages, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, company, name, stagesJson, isDefault ? 1 : 0, createdAt);

  return {
    id,
    company,
    name,
    stages,
    is_default: isDefault,
    created_at: createdAt,
  };
}

/**
 * Get a workflow by ID
 */
export function getWorkflow(id: string): Workflow | null {
  const database = getDatabase();
  const stmt = database.prepare('SELECT * FROM workflows WHERE id = ?');
  const row = stmt.get(id) as any;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    company: row.company,
    name: row.name,
    stages: JSON.parse(row.stages),
    is_default: row.is_default === 1,
    created_at: row.created_at,
  };
}

/**
 * Kept for callers from before the fixed stage list (the quick-add branch):
 * every company now gets the shared standard workflow, so nothing creates a
 * per-company row any more.
 */
export function getDefaultWorkflowForCompany(_company: string): Workflow | null {
  return getWorkflow(ensureStandardWorkflow());
}

// Application CRUD operations

/**
 * Create a new application
 */
export function createApplication(
  extractedData: ExtractedJobData,
  workflowId?: string,
  notes: string | null = null
): JobApplication {
  const database = getDatabase();
  // The workflow is unread now; the column only has to satisfy its foreign key.
  if (!workflowId) workflowId = ensureStandardWorkflow(database);
  const id = randomUUID();
  const now = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO applications (
      id, company, job_title, location, workplace_address, job_url, job_source,
      salary_min, salary_max, equity, benefits,
      job_description, key_responsibilities, required_skills, nice_to_have_skills,
      team_info, hiring_timeline, application_deadline,
      current_stage, workflow_id, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    extractedData.company,
    extractedData.job_title,
    extractedData.location,
    extractedData.workplace_address ?? null,
    extractedData.job_url,
    extractedData.job_source ?? null,
    extractedData.salary_min ?? null,
    extractedData.salary_max ?? null,
    extractedData.equity ?? null,
    extractedData.benefits ?? null,
    extractedData.job_description,
    extractedData.key_responsibilities,
    extractedData.required_skills,
    extractedData.nice_to_have_skills,
    extractedData.team_info ?? null,
    extractedData.hiring_timeline ?? null,
    extractedData.application_deadline ?? null,
    'applied',
    workflowId,
    notes,
    now,
    now
  );

  return {
    id,
    company: extractedData.company,
    job_title: extractedData.job_title,
    location: extractedData.location,
    workplace_address: extractedData.workplace_address ?? null,
    job_url: extractedData.job_url,
    job_source: extractedData.job_source ?? null,
    salary_min: extractedData.salary_min,
    salary_max: extractedData.salary_max,
    equity: extractedData.equity,
    benefits: extractedData.benefits,
    job_description: extractedData.job_description,
    key_responsibilities: extractedData.key_responsibilities,
    required_skills: extractedData.required_skills,
    nice_to_have_skills: extractedData.nice_to_have_skills,
    team_info: extractedData.team_info,
    hiring_timeline: extractedData.hiring_timeline,
    application_deadline: extractedData.application_deadline,
    current_stage: 'applied',
    workflow_id: workflowId,
    notes,
    resume_doc_id: null,
    has_letter_draft: false,
    last_email_at: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Get an application by ID
 */
export function getApplication(id: string): JobApplication | null {
  const database = getDatabase();
  const stmt = database.prepare(`SELECT a.*, ${COMPUTED_COLUMNS} FROM applications a WHERE a.id = ?`);
  const row = stmt.get(id) as any;

  if (!row) {
    return null;
  }

  return rowToApplication(row);
}

/**
 * The computed, read-only fields every application fetch carries: a working
 * letter draft exists, and the newest email event linked (and applied) to it.
 * Aliased on `a`, the applications table.
 */
const COMPUTED_COLUMNS = `
      EXISTS(SELECT 1 FROM cover_letters cld WHERE cld.application_id = a.id AND cld.is_final = 0) AS has_letter_draft,
      (SELECT MAX(ee.sent_at) FROM email_events ee WHERE ee.application_id = a.id AND ee.status = 'applied') AS last_email_at`;

/**
 * Get all applications with optional filters
 */
export function getAllApplications(filters?: {
  company?: string;
  search?: string;
  stage?: string;
  dateFrom?: string;
  dateTo?: string;
}): JobApplication[] {
  const database = getDatabase();
  // Every column except raw_job_text: the full posting is often tens of KB and
  // nothing in the list reads it (the detail page fetches it via getApplication),
  // so shipping it across the IPC boundary for every row is pure weight.
  // The EXISTS flag is what the rows and the "Needs letter" filter read.
  let query = `SELECT
      a.id, a.company, a.job_title, a.location, a.workplace_address, a.job_url, a.job_source,
      a.salary_min, a.salary_max, a.equity, a.benefits,
      a.job_description, a.key_responsibilities, a.required_skills,
      a.nice_to_have_skills, a.team_info, a.hiring_timeline,
      a.application_deadline, a.current_stage, a.workflow_id, a.notes,
      a.fit_score, a.fit_reason, a.interview_at, a.interview_minutes, a.prep_notes, a.resume_doc_id,
      a.created_at, a.updated_at,
      EXISTS(SELECT 1 FROM cover_letters cl WHERE cl.application_id = a.id) AS has_letter,${COMPUTED_COLUMNS}
    FROM applications a WHERE 1=1`;
  const params: any[] = [];

  // Fuzzy multi-field search (LIKE is case-insensitive for ASCII in SQLite). Each
  // whitespace-separated term must match somewhere, so a role, company, or keyword works.
  if (filters?.search) {
    const fields = ['company', 'job_title', 'location', 'job_source', 'required_skills', 'nice_to_have_skills', 'key_responsibilities', 'notes', 'job_description'];
    for (const term of filters.search.split(/\s+/).filter(Boolean)) {
      query += ' AND (' + fields.map((f) => `${f} LIKE ?`).join(' OR ') + ')';
      for (let i = 0; i < fields.length; i++) params.push(`%${term}%`);
    }
  }

  // Backward-compatible exact company filter (partial match via LIKE).
  if (filters?.company) {
    query += ' AND company LIKE ?';
    params.push(`%${filters.company}%`);
  }

  if (filters?.stage) {
    query += ' AND current_stage = ?';
    params.push(filters.stage);
  }

  if (filters?.dateFrom) {
    query += ' AND created_at >= ?';
    params.push(filters.dateFrom);
  }

  if (filters?.dateTo) {
    query += ' AND created_at <= ?';
    params.push(filters.dateTo);
  }

  query += ' ORDER BY created_at DESC';

  const stmt = database.prepare(query);
  const rows = stmt.all(...params) as any[];

  return rows.map(rowToApplication);
}

/**
 * Update an application
 */
export function updateApplication(
  id: string,
  updates: Partial<JobApplication>
): JobApplication {
  const database = getDatabase();
  const current = getApplication(id);

  if (!current) {
    throw new Error(`Application with ID ${id} not found`);
  }

  // Computed fields are read-only, and resume_doc_id has its own setter
  // (setApplicationResume), so a stale copy can never clear their pick.
  const {
    has_letter: _hl, has_letter_draft: _hd, last_email_at: _le, resume_doc_id: _rd, raw_job_text: _rt,
    ...writable
  } = updates;
  const stageChanged = writable.current_stage !== undefined && writable.current_stage !== current.current_stage;
  if (stageChanged && !isStage(writable.current_stage)) {
    throw new Error(`Unknown stage "${writable.current_stage}". Stages are: ${STAGES.join(', ')}.`);
  }

  const updated = { ...current, ...writable, updated_at: new Date().toISOString() };

  const stmt = database.prepare(`
    UPDATE applications
    SET company = ?, job_title = ?, location = ?, workplace_address = ?, job_url = ?, job_source = ?,
        salary_min = ?, salary_max = ?, equity = ?, benefits = ?,
        job_description = ?, key_responsibilities = ?, required_skills = ?,
        nice_to_have_skills = ?, team_info = ?, hiring_timeline = ?,
        application_deadline = ?, current_stage = ?, workflow_id = ?,
        notes = ?, fit_score = ?, fit_reason = ?,
        interview_at = ?, interview_minutes = ?, prep_notes = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    updated.company,
    updated.job_title,
    updated.location,
    updated.workplace_address ?? null,
    updated.job_url,
    updated.job_source ?? null,
    updated.salary_min ?? null,
    updated.salary_max ?? null,
    updated.equity ?? null,
    updated.benefits ?? null,
    updated.job_description,
    updated.key_responsibilities,
    updated.required_skills,
    updated.nice_to_have_skills,
    updated.team_info ?? null,
    updated.hiring_timeline ?? null,
    updated.application_deadline ?? null,
    updated.current_stage,
    updated.workflow_id,
    updated.notes ?? null,
    updated.fit_score ?? null,
    updated.fit_reason ?? null,
    updated.interview_at ?? null,
    updated.interview_minutes ?? null,
    updated.prep_notes ?? null,
    updated.updated_at,
    id
  );

  // The one stage-change path: the renderer's stage moves and inbox sync's
  // both land here. Listeners run after the write and can never fail it.
  if (stageChanged) {
    emitAppEvent({ type: 'application:stage', id, from: current.current_stage ?? null, to: updated.current_stage });
  }

  return updated;
}

/** Set (or clear, with null) the resume sent with this application. Their pick; always wins. */
export function setApplicationResume(id: string, docId: string | null): JobApplication {
  const database = getDatabase();
  const res = database.prepare('UPDATE applications SET resume_doc_id = ? WHERE id = ?').run(docId || null, id);
  if (!res.changes) throw new Error(`Application with ID ${id} not found`);
  return getApplication(id)!;
}

/**
 * Record the resume letter hydration picked, only when none is set yet: a
 * manual choice is never overwritten. Leaves updated_at alone (not a touch).
 */
export function setApplicationResumeIfEmpty(id: string, docId: string): boolean {
  if (!id || !docId) return false;
  const res = getDatabase()
    .prepare('UPDATE applications SET resume_doc_id = ? WHERE id = ? AND resume_doc_id IS NULL')
    .run(docId, id);
  return Number(res.changes) > 0;
}

/**
 * Delete an application and all related records
 */
export function deleteApplication(id: string): void {
  const database = getDatabase();

  // Delete all related records first (cascade delete)
  database.prepare('DELETE FROM stage_history WHERE application_id = ?').run(id);
  database.prepare('DELETE FROM guidance_docs WHERE application_id = ?').run(id);
  database.prepare('DELETE FROM attachments WHERE application_id = ?').run(id);
  database.prepare('DELETE FROM chat_messages WHERE application_id = ?').run(id);

  // Then delete the application itself
  database.prepare('DELETE FROM applications WHERE id = ?').run(id);
}

// Chat message CRUD operations

export interface ChatMessageRow {
  id: string;
  application_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export function addChatMessage(
  applicationId: string,
  role: 'user' | 'assistant',
  content: string
): ChatMessageRow {
  const database = getDatabase();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database
    .prepare('INSERT INTO chat_messages (id, application_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, applicationId, role, content, createdAt);
  return { id, application_id: applicationId, role, content, created_at: createdAt };
}

export function getChatMessages(applicationId: string): ChatMessageRow[] {
  const database = getDatabase();
  return database
    .prepare('SELECT * FROM chat_messages WHERE application_id = ? ORDER BY created_at ASC')
    .all(applicationId) as ChatMessageRow[];
}

// Stage History CRUD operations

/**
 * Create a stage history entry
 */
export function createStageHistory(
  applicationId: string,
  stage: string,
  notes: string | null = null,
  guidance: string | null = null
): StageHistory {
  const database = getDatabase();
  const id = randomUUID();
  const enteredAt = new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO stage_history (
      id, application_id, stage, entered_at, exited_at, notes, guidance, outcome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, applicationId, stage, enteredAt, null, notes, guidance, null);

  return {
    id,
    application_id: applicationId,
    stage,
    entered_at: enteredAt,
    exited_at: null,
    notes,
    guidance,
    outcome: null,
  };
}

/** Remove one stage history row (undoing a stage change inbox sync made). */
export function deleteStageHistory(id: string): void {
  getDatabase().prepare('DELETE FROM stage_history WHERE id = ?').run(id);
}

/**
 * Get stage history for an application
 */
export function getStageHistoryForApplication(applicationId: string): StageHistory[] {
  const database = getDatabase();
  const stmt = database.prepare(
    'SELECT * FROM stage_history WHERE application_id = ? ORDER BY entered_at ASC'
  );
  const rows = stmt.all(applicationId) as any[];

  return rows.map(rowToStageHistory);
}

/**
 * Update a stage history entry
 */
export function updateStageHistory(
  id: string,
  updates: Partial<StageHistory>
): StageHistory {
  const database = getDatabase();
  const stmt = database.prepare(
    'SELECT * FROM stage_history WHERE id = ?'
  );
  const row = stmt.get(id) as any;

  if (!row) {
    throw new Error(`Stage history with ID ${id} not found`);
  }

  const current = rowToStageHistory(row);
  const updated = { ...current, ...updates };

  const updateStmt = database.prepare(`
    UPDATE stage_history
    SET stage = ?, entered_at = ?, exited_at = ?, notes = ?, guidance = ?, outcome = ?
    WHERE id = ?
  `);

  updateStmt.run(
    updated.stage,
    updated.entered_at,
    updated.exited_at ?? null,
    updated.notes ?? null,
    updated.guidance ?? null,
    updated.outcome ?? null,
    id
  );

  return updated;
}

// Guidance Docs CRUD operations

/**
 * Create guidance documents for an application and stage
 */
export function createGuidanceDocs(
  applicationId: string,
  stage: string,
  content: GuidanceContent
): GuidanceDoc[] {
  const database = getDatabase();
  const generatedAt = new Date().toISOString();
  const guidanceDocs: GuidanceDoc[] = [];

  const guidanceTypes: GuidanceType[] = [
    'interview_prep',
    'company_research',
    'application_strategy',
    'follow_up_template',
  ];

  const stmt = database.prepare(`
    INSERT INTO guidance_docs (
      id, application_id, stage, guidance_type, content, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const guidanceType of guidanceTypes) {
    const id = randomUUID();
    const contentValue = content[guidanceType];

    if (contentValue) {
      stmt.run(id, applicationId, stage, guidanceType, contentValue, generatedAt);

      guidanceDocs.push({
        id,
        application_id: applicationId,
        stage,
        guidance_type: guidanceType,
        content: contentValue,
        generated_at: generatedAt,
      });
    }
  }

  return guidanceDocs;
}

/**
 * Get guidance docs for an application and stage
 */
export function getGuidanceDocsForApplicationAndStage(
  applicationId: string,
  stage: string
): GuidanceDoc[] {
  const database = getDatabase();
  const stmt = database.prepare(
    'SELECT * FROM guidance_docs WHERE application_id = ? AND stage = ? ORDER BY generated_at DESC'
  );
  const rows = stmt.all(applicationId, stage) as any[];

  return rows.map(rowToGuidanceDoc);
}

/**
 * Get all guidance docs for an application
 */
export function getAllGuidanceDocsForApplication(applicationId: string): GuidanceDoc[] {
  const database = getDatabase();
  const stmt = database.prepare(
    'SELECT * FROM guidance_docs WHERE application_id = ? ORDER BY generated_at DESC'
  );
  const rows = stmt.all(applicationId) as any[];

  return rows.map(rowToGuidanceDoc);
}

// Helper functions for converting database rows to typed objects

function rowToApplication(row: any): JobApplication {
  return {
    id: row.id,
    company: row.company,
    job_title: row.job_title,
    location: row.location,
    workplace_address: row.workplace_address ?? null,
    job_url: row.job_url,
    job_source: row.job_source ?? null,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    equity: row.equity,
    benefits: row.benefits,
    job_description: row.job_description,
    key_responsibilities: row.key_responsibilities,
    required_skills: row.required_skills,
    nice_to_have_skills: row.nice_to_have_skills,
    team_info: row.team_info,
    hiring_timeline: row.hiring_timeline,
    application_deadline: row.application_deadline,
    current_stage: row.current_stage,
    workflow_id: row.workflow_id,
    notes: row.notes,
    raw_job_text: row.raw_job_text ?? null,
    fit_score: row.fit_score ?? null,
    fit_reason: row.fit_reason ?? null,
    interview_at: row.interview_at ?? null,
    interview_minutes: row.interview_minutes ?? null,
    prep_notes: row.prep_notes ?? null,
    resume_doc_id: row.resume_doc_id ?? null,
    has_letter_draft: !!row.has_letter_draft,
    last_email_at: row.last_email_at ?? null,
    // Only the list query joins these, so an absent column stays undefined
    // rather than becoming a false "no letter yet" on a single-row fetch.
    has_letter: row.has_letter == null ? undefined : !!row.has_letter,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToStageHistory(row: any): StageHistory {
  return {
    id: row.id,
    application_id: row.application_id,
    stage: row.stage,
    entered_at: row.entered_at,
    exited_at: row.exited_at,
    notes: row.notes,
    guidance: row.guidance,
    outcome: row.outcome,
  };
}

function rowToGuidanceDoc(row: any): GuidanceDoc {
  return {
    id: row.id,
    application_id: row.application_id,
    stage: row.stage,
    guidance_type: row.guidance_type,
    content: row.content,
    generated_at: row.generated_at,
  };
}

// The `attachments` table (and its index, and the cascade delete above) stays:
// it is user data, even though it holds none. Nothing reads or writes it any
// more, so its three accessors are gone.

// ── Answer bank ──────────────────────────────────────────────────────────────
function rowToAnswer(row: any): AnswerBankEntry {
  return {
    id: row.id,
    fieldKey: row.field_key,
    label: row.label,
    value: row.value,
    context: row.context ?? null,
    patterns: JSON.parse(row.patterns || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAnswerBank(): AnswerBankEntry[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM answer_bank ORDER BY label COLLATE NOCASE').all() as any[]).map(rowToAnswer);
}

export function upsertAnswer(input: Partial<AnswerBankEntry> & { value: string; label: string }): AnswerBankEntry {
  const db = getDatabase();
  const now = new Date().toISOString();
  const patterns = JSON.stringify(input.patterns ?? []);
  const fieldKey = input.fieldKey || input.label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (input.id) {
    db.prepare('UPDATE answer_bank SET field_key=?, label=?, value=?, context=?, patterns=?, updated_at=? WHERE id=?')
      .run(fieldKey, input.label, input.value, input.context ?? null, patterns, now, input.id);
    return rowToAnswer(db.prepare('SELECT * FROM answer_bank WHERE id=?').get(input.id));
  }
  const id = randomUUID();
  db.prepare('INSERT INTO answer_bank (id, field_key, label, value, context, patterns, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, fieldKey, input.label, input.value, input.context ?? null, patterns, now, now);
  return rowToAnswer(db.prepare('SELECT * FROM answer_bank WHERE id=?').get(id));
}

export function deleteAnswer(id: string): void {
  getDatabase().prepare('DELETE FROM answer_bank WHERE id=?').run(id);
}

// ── Document locker ──────────────────────────────────────────────────────────
function rowToDoc(row: any): LockerDocument {
  return {
    id: row.id,
    label: row.label,
    filePath: row.file_path,
    tags: JSON.parse(row.tags || '[]'),
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  };
}

export function getDocuments(): LockerDocument[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM locker_documents ORDER BY created_at DESC').all() as any[]).map(rowToDoc);
}

export function addDocument(label: string, filePath: string, tags: string[], isDefault: boolean): LockerDocument {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();
  // a default replaces any existing default sharing its first tag
  if (isDefault && tags[0]) {
    for (const d of getDocuments()) {
      if (d.isDefault && d.tags[0] === tags[0]) {
        db.prepare('UPDATE locker_documents SET is_default=0 WHERE id=?').run(d.id);
      }
    }
  }
  db.prepare('INSERT INTO locker_documents (id, label, file_path, tags, is_default, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, label, filePath, JSON.stringify(tags), isDefault ? 1 : 0, now);
  return rowToDoc(db.prepare('SELECT * FROM locker_documents WHERE id=?').get(id));
}

// Per-resume "focus" notes (docId -> focus text), used to pick the best variant.
export function getResumeFocus(): Record<string, string> {
  try { const raw = getSetting('resume_focus'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
export function setResumeFocus(docId: string, focus: string): void {
  const m = getResumeFocus();
  if (focus.trim()) m[docId] = focus.trim(); else delete m[docId];
  setSetting('resume_focus', JSON.stringify(m));
}

// Make a document the default for its first tag (e.g. the default resume variant).
export function setDocumentDefault(id: string): void {
  const db = getDatabase();
  const doc = db.prepare('SELECT tags FROM locker_documents WHERE id=?').get(id) as any;
  if (!doc) return;
  const tag0 = (JSON.parse(doc.tags || '[]')[0]) || '';
  for (const d of getDocuments()) {
    if (d.id !== id && d.tags[0] === tag0 && d.isDefault) db.prepare('UPDATE locker_documents SET is_default=0 WHERE id=?').run(d.id);
  }
  db.prepare('UPDATE locker_documents SET is_default=1 WHERE id=?').run(id);
}

export function deleteDocument(id: string): void {
  getDatabase().prepare('DELETE FROM locker_documents WHERE id=?').run(id);
}

// ── Voice profile ────────────────────────────────────────────────────────────
export function getVoiceNotes(): VoiceNote[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM voice_notes ORDER BY created_at DESC').all() as any[]).map((r) => ({
    id: r.id, kind: r.kind as VoiceNoteKind, note: r.note, createdAt: r.created_at,
  }));
}

export function addVoiceNote(kind: VoiceNoteKind, note: string): VoiceNote {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO voice_notes (id, kind, note, created_at) VALUES (?,?,?,?)').run(id, kind, note, now);
  return { id, kind, note, createdAt: now };
}

export function deleteVoiceNote(id: string): void {
  getDatabase().prepare('DELETE FROM voice_notes WHERE id=?').run(id);
}

// ── Portfolio links (Claude can reference / fetch these) ─────────────────────
export function getPortfolioLinks(): PortfolioLink[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM portfolio_links ORDER BY created_at DESC').all() as any[]).map((r) => ({
    id: r.id, label: r.label, url: r.url, createdAt: r.created_at,
  }));
}

export function addPortfolioLink(label: string, url: string): PortfolioLink {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO portfolio_links (id, label, url, created_at) VALUES (?,?,?,?)').run(id, label, url, now);
  return { id, label, url, createdAt: now };
}

export function deletePortfolioLink(id: string): void {
  getDatabase().prepare('DELETE FROM portfolio_links WHERE id=?').run(id);
}

// ── Cover-letter vault ───────────────────────────────────────────────────────
function rowToCover(r: any): CoverLetter {
  return {
    id: r.id, company: r.company, role: r.role, jobUrl: r.job_url, applicationId: r.application_id ?? null,
    label: r.label ?? null, body: r.body, isFinal: r.is_final === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// Vault view: explicitly-saved letters (is_final=1) + standalone ones, NOT the
// per-application auto-draft (is_final=0), which would otherwise be noise.
export function getCoverLetters(): CoverLetter[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM cover_letters WHERE is_final=1 OR application_id IS NULL ORDER BY updated_at DESC').all() as any[]).map(rowToCover);
}

// The working (auto-saved) draft for an application: exactly one, is_final=0.
export function getCoverLetterForApplication(applicationId: string): CoverLetter | null {
  const db = getDatabase();
  const r = db.prepare('SELECT * FROM cover_letters WHERE application_id=? AND is_final=0 ORDER BY updated_at DESC LIMIT 1').get(applicationId);
  return r ? rowToCover(r) : null;
}

// Saved versions you chose to keep for an application (is_final=1), newest first.
export function getSavedCoverLettersForApplication(applicationId: string): CoverLetter[] {
  const db = getDatabase();
  return (db.prepare('SELECT * FROM cover_letters WHERE application_id=? AND is_final=1 ORDER BY updated_at DESC').all(applicationId) as any[]).map(rowToCover);
}

// Upsert the single working DRAFT (is_final=0) for an application.
export function saveCoverLetterForApplication(applicationId: string, input: { company: string; role: string; jobUrl?: string | null; body: string }): CoverLetter {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM cover_letters WHERE application_id=? AND is_final=0 LIMIT 1').get(applicationId) as any;
  if (existing) {
    db.prepare('UPDATE cover_letters SET company=?, role=?, job_url=?, body=?, updated_at=? WHERE id=?')
      .run(input.company, input.role, input.jobUrl ?? null, input.body, now, existing.id);
    return rowToCover(db.prepare('SELECT * FROM cover_letters WHERE id=?').get(existing.id));
  }
  const id = randomUUID();
  db.prepare('INSERT INTO cover_letters (id, company, role, job_url, application_id, label, body, is_final, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)')
    .run(id, input.company, input.role, input.jobUrl ?? null, applicationId, null, input.body, now, now);
  return rowToCover(db.prepare('SELECT * FROM cover_letters WHERE id=?').get(id));
}

// Snapshot a cover letter you LIKE as a kept version (is_final=1) for an application.
export function saveCoverLetterVersion(applicationId: string, input: { company: string; role: string; jobUrl?: string | null; body: string; label?: string | null }): CoverLetter {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare('INSERT INTO cover_letters (id, company, role, job_url, application_id, label, body, is_final, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)')
    .run(id, input.company, input.role, input.jobUrl ?? null, applicationId, input.label ?? null, input.body, now, now);
  return rowToCover(db.prepare('SELECT * FROM cover_letters WHERE id=?').get(id));
}

export function saveCoverLetter(input: Partial<CoverLetter> & { company: string; role: string; body: string }): CoverLetter {
  const db = getDatabase();
  const now = new Date().toISOString();
  if (input.id) {
    db.prepare('UPDATE cover_letters SET company=?, role=?, job_url=?, body=?, is_final=?, updated_at=? WHERE id=?')
      .run(input.company, input.role, input.jobUrl ?? null, input.body, input.isFinal ? 1 : 0, now, input.id);
    return rowToCover(db.prepare('SELECT * FROM cover_letters WHERE id=?').get(input.id));
  }
  const id = randomUUID();
  db.prepare('INSERT INTO cover_letters (id, company, role, job_url, body, is_final, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, input.company, input.role, input.jobUrl ?? null, input.body, input.isFinal ? 1 : 0, now, now);
  return rowToCover(db.prepare('SELECT * FROM cover_letters WHERE id=?').get(id));
}

export function deleteCoverLetter(id: string): void {
  getDatabase().prepare('DELETE FROM cover_letters WHERE id=?').run(id);
}

// ── Key/value settings ───────────────────────────────────────────────────────
export function getSetting(key: string): string | null {
  const r = getDatabase().prepare('SELECT value FROM app_settings WHERE key=?').get(key) as any;
  return r ? r.value : null;
}
export function setSetting(key: string, value: string): void {
  getDatabase().prepare('INSERT INTO app_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

// ── Letter engine: raw postings, research cache, voice profile, exemplars ────

// One canonical key per company, so "Acme Pty Ltd" and "acme pty ltd." share a
// cache row: lowercase, then drop everything that is not a letter or digit.
export function normalizeCompany(company: string): string {
  return (company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface CompanyResearch {
  company: string;
  text: string;
  sources: string[];
  fetchedAt: string;
}

export function getCompanyResearch(company: string): CompanyResearch | null {
  const key = normalizeCompany(company);
  if (!key) return null;
  const r = getDatabase().prepare('SELECT * FROM company_research WHERE company_norm=?').get(key) as any;
  if (!r) return null;
  let sources: string[] = [];
  try { sources = JSON.parse(r.sources || '[]'); } catch { sources = []; }
  return { company: r.company_norm, text: r.text || '', sources, fetchedAt: r.fetched_at };
}

export function saveCompanyResearch(company: string, text: string, sources: string[] = []): void {
  const key = normalizeCompany(company);
  if (!key || !text) return;
  getDatabase().prepare(
    `INSERT INTO company_research (company_norm, text, sources, fetched_at) VALUES (?,?,?,?)
     ON CONFLICT(company_norm) DO UPDATE SET text=excluded.text, sources=excluded.sources, fetched_at=excluded.fetched_at`
  ).run(key, text, JSON.stringify(sources || []), new Date().toISOString());
}

export interface VoiceProfile { follow: string[]; avoid: string[] }

// The distilled writing profile. Letter prompts read this, never the raw notes.
export function getVoiceProfile(): VoiceProfile | null {
  try {
    const raw = getSetting('voice_profile');
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.follow) || !Array.isArray(p.avoid)) return null;
    return { follow: p.follow.map(String), avoid: p.avoid.map(String) };
  } catch { return null; }
}

export function saveVoiceProfile(p: VoiceProfile): void {
  setSetting('voice_profile', JSON.stringify({ follow: p.follow || [], avoid: p.avoid || [] }));
}

// Letters the user chose to keep, newest first. Used as few-shot VOICE examples.
export function getKeptLetterBodies(limit = 3): string[] {
  const n = Math.max(0, Math.min(10, limit));
  if (!n) return [];
  return (getDatabase()
    .prepare('SELECT body FROM cover_letters WHERE is_final=1 AND body IS NOT NULL ORDER BY updated_at DESC LIMIT ?')
    .all(n) as any[])
    .map((r) => String(r.body || '').trim())
    .filter(Boolean);
}

// The full original posting text, stored at ingest so letters are written from
// the real thing rather than the 150-word extraction summary.
export function setRawJobText(id: string, text: string): void {
  const t = String(text || '').trim();
  if (!id || !t) return;
  getDatabase().prepare('UPDATE applications SET raw_job_text=? WHERE id=?').run(t, id);
}

export function getRawJobText(id: string): string | null {
  const r = getDatabase().prepare('SELECT raw_job_text FROM applications WHERE id=?').get(id) as any;
  return r && r.raw_job_text ? String(r.raw_job_text) : null;
}

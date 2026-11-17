import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

// database.ts imports electron for the userData path. Nothing under test touches
// it (the ladder takes a handle), so a stub is enough to make the module load.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import {
  createSchema, runMigrationLadder, getSchemaVersion, MIGRATIONS, prepareDatabase, latestSchemaVersion, newerDataMessage, closeDatabase, ensureStandardWorkflow, STANDARD_WORKFLOW_ID,
  type MigrationDb,
} from '../database';
import { STAGES } from '../../shared/types';

// The shipped better-sqlite3 binary is built against Electron's ABI, so it will
// not dlopen under plain node. node:sqlite is the same engine with the same error
// strings ("duplicate column name: x"), which is all the ladder depends on.
function freshDb(): MigrationDb {
  return new DatabaseSync(':memory:') as unknown as MigrationDb;
}

const LATEST = MIGRATIONS.reduce((m, x) => Math.max(m, x.v), 0);

const columns = (db: MigrationDb, table: string): string[] =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => String(r.name));

const tables = (db: MigrationDb): string[] =>
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r: any) => String(r.name));

describe('migration ladder', () => {
  it('brings a fresh database to the latest version', () => {
    const db = freshDb();
    createSchema(db);
    expect(getSchemaVersion(db)).toBe(0);
    runMigrationLadder(db);
    expect(getSchemaVersion(db)).toBe(LATEST);
    expect(columns(db, 'applications')).toContain('raw_job_text');
    expect(columns(db, 'applications')).toContain('workplace_address');
    expect(columns(db, 'applications')).toContain('interview_minutes');
    expect(tables(db)).toContain('agent_runs');
    expect(tables(db)).toContain('company_research');
    expect(columns(db, 'company_research')).toEqual(['company_norm', 'text', 'sources', 'fetched_at']);
    // v7: inbox sync. No password column anywhere; the Keychain holds it.
    expect(columns(db, 'email_accounts')).toEqual(['email', 'provider', 'created_at', 'last_sync_at', 'last_error', 'backlog_done']);
    expect(columns(db, 'email_watermarks')).toEqual(['email', 'folder', 'uid_validity', 'last_uid']);
    expect(columns(db, 'email_events')).toEqual([
      'id', 'email', 'message_id', 'from_address', 'subject', 'sent_at', 'application_id', 'kind', 'confidence',
      'evidence', 'from_stage', 'proposed_stage', 'status', 'candidates', 'stage_history_id', 'created_at',
      // v12: the sender name and text of an email waiting for the model, cleared once it is read.
      'pending_input',
    ]);
  });

  it('refuses a database written by a newer app version', () => {
    const db = freshDb();
    createSchema(db);
    runMigrationLadder(db);
    db.exec(`PRAGMA user_version = ${LATEST + 5}`);
    expect(() => runMigrationLadder(db)).toThrow(/newer version/i);
  });

  it('leaves a newer database file byte-identical when it refuses to open it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aplyd-newer-'));
    const file = path.join(dir, 'job-tracker.db');
    try {
      // A minimal file from "the future": one unknown table, a rollback journal
      // (not WAL) and a version stamp past anything this build knows.
      const seed = new DatabaseSync(file);
      seed.exec('CREATE TABLE future_things (id TEXT PRIMARY KEY, body TEXT)');
      seed.exec(`INSERT INTO future_things VALUES ('a', 'kept')`);
      seed.exec(`PRAGMA user_version = ${LATEST + 3}`);
      seed.close();
      const before = fs.readFileSync(file);

      const handle = new DatabaseSync(file);
      let message = '';
      try { prepareDatabase(handle as unknown as MigrationDb); } catch (e) { message = (e as Error).message; }
      handle.close();

      expect(message).toMatch(/newer version/i);
      expect(message).toMatch(/Install the newest version of Aplyd Community first/);
      expect(message).toMatch(/lose everything added since that backup's date/);
      expect(fs.readFileSync(file).equals(before)).toBe(true);
      expect(fs.existsSync(`${file}-wal`)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('closeDatabase can be called on every quit path', () => {
    expect(() => { closeDatabase(); closeDatabase(); }).not.toThrow();
  });

  it('opens a current database through the same path', () => {
    const db = freshDb();
    prepareDatabase(db);
    expect(getSchemaVersion(db)).toBe(LATEST);
    expect(latestSchemaVersion()).toBe(LATEST);
    expect(newerDataMessage(LATEST + 1, LATEST)).toContain(`data format ${LATEST + 1}`);
  });

  it('v7 is additive: an existing v6 database keeps every row', () => {
    const db = freshDb();
    createSchema(db);
    runMigrationLadder(db);
    db.exec('DROP TABLE email_events; DROP TABLE email_watermarks; DROP TABLE email_accounts');
    db.exec('PRAGMA user_version = 6');
    db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at)
             VALUES ('w1','Acme','Acme Default','["applied"]',1,'2026-01-01')`);
    runMigrationLadder(db);
    expect(getSchemaVersion(db)).toBe(LATEST);
    expect(tables(db)).toEqual(expect.arrayContaining(['email_accounts', 'email_watermarks', 'email_events']));
    expect(db.prepare(`SELECT COUNT(*) AS n FROM workflows`).get()).toMatchObject({ n: 1 });
  });

  it('v8 is additive: resume_doc_id arrives nullable and existing rows keep their data', () => {
    const db = freshDb();
    createSchema(db);
    runMigrationLadder(db);
    expect(columns(db, 'applications')).toContain('resume_doc_id');
    // Rebuild a v7 shape: a fresh schema never has the column until v8 runs.
    const db7 = freshDb();
    createSchema(db7);
    for (const m of MIGRATIONS.filter((x) => x.v <= 7)) m.up(db7);
    db7.exec('PRAGMA user_version = 7');
    expect(columns(db7, 'applications')).not.toContain('resume_doc_id');
    db7.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at)
              VALUES ('w1','Acme','Acme Default','["applied"]',1,'2026-01-01')`);
    db7.exec(`INSERT INTO applications (id, company, job_title, location, job_url, job_description,
               key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id,
               created_at, updated_at)
             VALUES ('a1','Acme','Engineer','Sydney','','desc','','','','interview','w1','2026-01-01','2026-01-01')`);
    runMigrationLadder(db7);
    expect(getSchemaVersion(db7)).toBe(LATEST);
    expect(db7.prepare(`SELECT resume_doc_id, current_stage, workflow_id FROM applications WHERE id='a1'`).get())
      .toMatchObject({ resume_doc_id: null, current_stage: 'interview', workflow_id: 'w1' });
  });

  it('v9 adds a nullable workplace address without changing existing location data', () => {
    const db = freshDb();
    createSchema(db);
    for (const m of MIGRATIONS.filter((x) => x.v <= 8)) m.up(db);
    db.exec('PRAGMA user_version = 8');
    db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at)
             VALUES ('w1','Acme','Acme Default','["applied"]',1,'2026-01-01')`);
    db.exec(`INSERT INTO applications (id, company, job_title, location, job_url, job_description,
               key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id,
               created_at, updated_at)
             VALUES ('a1','Acme','Engineer','Parramatta NSW','','desc','','','','applied','w1','2026-01-01','2026-01-01')`);
    runMigrationLadder(db);
    expect(db.prepare(`SELECT location, workplace_address FROM applications WHERE id='a1'`).get())
      .toMatchObject({ location: 'Parramatta NSW', workplace_address: null });
    db.prepare(`UPDATE applications SET workplace_address = ? WHERE id = ?`).run('123 Church St, Parramatta NSW 2150', 'a1');
    runMigrationLadder(db);
    expect(db.prepare(`SELECT location, workplace_address FROM applications WHERE id='a1'`).get())
      .toMatchObject({ location: 'Parramatta NSW', workplace_address: '123 Church St, Parramatta NSW 2150' });
  });

  it('catches up an installed v12 database that never received the branch-local v9 address migration', () => {
    const db = freshDb();
    createSchema(db);
    for (const m of MIGRATIONS.filter((x) => x.v <= 12 && x.v !== 9)) m.up(db);
    db.exec('PRAGMA user_version = 12');
    expect(columns(db, 'applications')).not.toContain('workplace_address');
    runMigrationLadder(db);
    expect(columns(db, 'applications')).toContain('workplace_address');
    expect(getSchemaVersion(db)).toBe(LATEST);
    expect(() => runMigrationLadder(db)).not.toThrow();
  });

  it('ensureStandardWorkflow makes one shared row carrying STAGES, idempotently', () => {
    const db = freshDb();
    createSchema(db);
    runMigrationLadder(db);
    expect(ensureStandardWorkflow(db)).toBe(STANDARD_WORKFLOW_ID);
    expect(ensureStandardWorkflow(db)).toBe(STANDARD_WORKFLOW_ID);
    const rows = db.prepare(`SELECT stages FROM workflows`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].stages)).toEqual([...STAGES]);
  });

  it('is idempotent: running schema + ladder twice changes nothing', () => {
    const db = freshDb();
    createSchema(db);
    runMigrationLadder(db);

    db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at)
             VALUES ('w1','Acme','Acme Default','["applied","interview"]',1,'2026-01-01')`);
    db.exec(`INSERT INTO applications (id, company, job_title, location, job_url, job_description,
               key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id,
               created_at, updated_at)
             VALUES ('a1','Acme','Engineer','Sydney','','desc','','','','applied','w1','2026-01-01','2026-01-01')`);
    db.exec(`UPDATE applications SET job_source = NULL WHERE id='a1'`);
    db.exec(`INSERT INTO autopilot_needs (id, norm_label, label, kind, job_count, status, created_at)
             VALUES ('n1','what is your search radius','Search radius','text',1,'open','2026-01-01')`);

    expect(() => { createSchema(db); runMigrationLadder(db); }).not.toThrow();

    expect(getSchemaVersion(db)).toBe(LATEST);
    // v1 already ran, so it must NOT stamp this later row with 'LinkedIn'.
    const app = db.prepare(`SELECT job_source FROM applications WHERE id='a1'`).get() as any;
    expect(app.job_source).toBe(null);
    // v3 already ran, so this later junk need survives (it is not re-purged).
    const needs = db.prepare(`SELECT COUNT(*) AS n FROM autopilot_needs`).get() as any;
    expect(needs.n).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM applications`).get()).toMatchObject({ n: 1 });
  });

  it('runs the one-time cleanups exactly once on a legacy database', () => {
    const db = freshDb();
    createSchema(db);
    db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at)
             VALUES ('w1','Acme','Acme Default','["started","interview"]',1,'2026-01-01')`);
    db.exec(`INSERT INTO applications (id, company, job_title, location, job_url, job_description,
               key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id,
               created_at, updated_at)
             VALUES ('a1','Acme','Engineer','Sydney','','desc','','','','started','w1','2026-01-01','2026-01-01')`);
    db.exec(`INSERT INTO stage_history (id, application_id, stage, entered_at) VALUES ('s1','a1','started','2026-01-01')`);
    db.exec(`INSERT INTO autopilot_needs (id, norm_label, label, kind, job_count, status, created_at)
             VALUES ('n1','','Junk','text',1,'open','2026-01-01')`);
    db.exec(`INSERT INTO autopilot_needs (id, norm_label, label, kind, job_count, status, created_at)
             VALUES ('n2','keep me','Keep me','text',1,'open','2026-01-01')`);

    runMigrationLadder(db);

    expect(db.prepare(`SELECT job_source FROM applications WHERE id='a1'`).get()).toMatchObject({ job_source: 'LinkedIn' });
    expect(db.prepare(`SELECT current_stage FROM applications WHERE id='a1'`).get()).toMatchObject({ current_stage: 'applied' });
    expect(db.prepare(`SELECT stage FROM stage_history WHERE id='s1'`).get()).toMatchObject({ stage: 'applied' });
    expect(JSON.parse((db.prepare(`SELECT stages FROM workflows WHERE id='w1'`).get() as any).stages))
      .toEqual(['applied', 'interview']);
    expect(db.prepare(`SELECT id FROM autopilot_needs ORDER BY id`).all().map((r: any) => r.id)).toEqual(['n2']);
  });

  it('resumes partway: a database already at v1 only runs v2 and up', () => {
    const db = freshDb();
    createSchema(db);
    db.exec('PRAGMA user_version = 1');
    db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at)
             VALUES ('w1','Acme','Acme Default','["applied"]',1,'2026-01-01')`);
    db.exec(`INSERT INTO applications (id, company, job_title, location, job_url, job_description,
               key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id,
               created_at, updated_at)
             VALUES ('a1','Acme','Engineer','Sydney','','desc','','','','applied','w1','2026-01-01','2026-01-01')`);

    runMigrationLadder(db);

    // v1 was skipped, so job_source stays untouched.
    expect(db.prepare(`SELECT job_source FROM applications WHERE id='a1'`).get()).toMatchObject({ job_source: null });
    // v2 onwards still ran.
    expect(getSchemaVersion(db)).toBe(LATEST);
    expect(columns(db, 'applications')).toContain('raw_job_text');
    expect(tables(db)).toContain('company_research');
  });

  it('surfaces real errors instead of swallowing them', () => {
    const db = freshDb();
    // No schema at all: the ALTERs must throw, not be mistaken for "already applied".
    expect(() => runMigrationLadder(db)).toThrow(/no such table/i);
  });

  it('v12 is additive: email events keep every row, and pending_input arrives empty', () => {
    const db = freshDb();
    createSchema(db);
    for (const m of MIGRATIONS.filter((x) => x.v <= 11)) m.up(db);
    db.exec('PRAGMA user_version = 11');
    db.exec(`INSERT INTO email_events (id, email, message_id, sent_at, kind, status, created_at)
             VALUES ('e1', 'me@gmail.com', '<m1@x>', '2026-10-01', 'rejection', 'applied', '2026-10-01')`);
    runMigrationLadder(db);
    expect(getSchemaVersion(db)).toBe(LATEST);
    expect(db.prepare(`SELECT kind, status, pending_input FROM email_events WHERE id = 'e1'`).get())
      .toMatchObject({ kind: 'rejection', status: 'applied', pending_input: null });
  });

  describe('v18: neutral outreach names', () => {
    // A database exactly as v17 left it, with outreach rows under the old names.
    function v17WithOldNames(): MigrationDb {
      const db = freshDb();
      createSchema(db);
      for (const m of MIGRATIONS.filter((x) => x.v <= 17)) m.up(db);
      db.exec('PRAGMA user_version = 17');
      const lead = db.prepare(`INSERT INTO leads (id, org, segment, stage, created_at, updated_at) VALUES (?, ?, ?, 'contacted', '2026-10-01', '2026-10-01')`);
      lead.run('l1', 'One', 'clubs'); lead.run('l2', 'Two', 'local'); lead.run('l3', 'Three', 'ai'); lead.run('l4', 'Four', '3d');
      const draft = db.prepare(`INSERT INTO approvals (id, kind, lead_id, channel, body, status, created_by, created_at) VALUES (?, ?, ?, 'email', 'Hi', 'pending', 'agent', '2026-10-02')`);
      draft.run('d1', 'purpl_email', 'l1'); draft.run('d2', 'purpl_followup', 'l2');
      draft.run('d3', 'platform_bid', null); draft.run('d4', 'reply', null);
      return db;
    }
    const segments = (db: MigrationDb) => db.prepare('SELECT id, segment FROM leads ORDER BY id').all().map((r: any) => [r.id, r.segment]);
    const kinds = (db: MigrationDb) => db.prepare('SELECT id, kind FROM approvals ORDER BY id').all().map((r: any) => [r.id, r.kind]);

    it('rewrites old draft kinds and lead segments, and leaves the rest alone', () => {
      const db = v17WithOldNames();
      runMigrationLadder(db);
      expect(getSchemaVersion(db)).toBe(18);
      expect(segments(db)).toEqual([['l1', 'group_a'], ['l2', 'group_b'], ['l3', 'group_c'], ['l4', 'group_d']]);
      expect(kinds(db)).toEqual([['d1', 'outreach_email'], ['d2', 'outreach_followup'], ['d3', 'platform_bid'], ['d4', 'reply']]);
      expect(db.prepare(`SELECT org, stage FROM leads WHERE id = 'l3'`).get()).toMatchObject({ org: 'Three', stage: 'contacted' });
    });

    it('is idempotent: running the step again changes nothing', () => {
      const db = v17WithOldNames();
      runMigrationLadder(db);
      const before = [segments(db), kinds(db)];
      MIGRATIONS.find((m) => m.v === 18)!.up(db);
      runMigrationLadder(db);
      expect([segments(db), kinds(db)]).toEqual(before);
    });

    it('rolls back as one transaction when the step fails', () => {
      const db = v17WithOldNames();
      db.exec('DROP TABLE leads');
      expect(() => runMigrationLadder(db)).toThrow(/no such table/i);
      expect(getSchemaVersion(db)).toBe(17);
      expect(kinds(db)[0]).toEqual(['d1', 'purpl_email']);
    });

    it('a fresh database reaches v18 and takes the new names', () => {
      const db = freshDb();
      createSchema(db);
      runMigrationLadder(db);
      expect(getSchemaVersion(db)).toBe(18);
      db.exec(`INSERT INTO leads (id, org, segment, stage, created_at, updated_at) VALUES ('n', 'New', 'group_c', 'prospect', '2026-11-01', '2026-11-01')`);
      db.exec(`INSERT INTO approvals (id, kind, lead_id, channel, body, status, created_by, created_at) VALUES ('a', 'outreach_email', 'n', 'email', 'Hi', 'pending', 'agent', '2026-11-01')`);
      runMigrationLadder(db);
      expect(segments(db)).toEqual([['n', 'group_c']]);
      expect(kinds(db)).toEqual([['a', 'outreach_email']]);
    });
  });
});

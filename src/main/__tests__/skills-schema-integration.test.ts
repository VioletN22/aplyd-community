import { it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
import { createSchema, runMigrationLadder, ensureStandardWorkflow, type MigrationDb } from '../database';
import { initializeCommunityData } from '../community-data';

it('runs the installed skill protocol against the real migrated application schema', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aplyd schema with spaces-'));
  try {
    initializeCommunityData(directory);
    const database = new DatabaseSync(path.join(directory, 'job-tracker.db'));
    createSchema(database as unknown as MigrationDb);
    runMigrationLadder(database as unknown as MigrationDb);
    ensureStandardWorkflow(database as unknown as MigrationDb);
    database.close();
    const run = (action: string, input: object = {}) => {
      const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
        [path.join(process.cwd(), 'tools', 'aplyd.py'), action, '--data-dir', directory, '--input', '-'],
        { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000, windowsHide: true });
      expect(result.error, `${action}: failed to launch Python`).toBeUndefined();
      expect(result.status, `${action}: ${result.stderr}`).toBe(0);
      return JSON.parse(result.stdout);
    };
    expect(run('doctor').ok).toBe(true);
    const auth = run('start', { agent: 'codex', target: 1 });
    const job = run('enqueue', { ...auth, company: 'Example Company', title: 'Engineer', url: 'https://example.org/jobs/1', posting: 'Fictional engineering position' });
    const resume = path.join(directory, 'Example Resume.pdf');
    fs.writeFileSync(resume, '%PDF-1.4 synthetic snapshot fixture');
    const identity = { ...auth, job_id: job.id };
    run('prepare', { ...identity, resume_path: resume, resume_focus: 'Engineering' });
    run('begin-submit', identity);
    run('confirm', { ...identity, evidence_text: 'Your application was received. EX-1', evidence_url: 'https://example.org/receipts/1' });
    run('sync', identity); run('sync', identity);
    const read = new DatabaseSync(path.join(directory, 'job-tracker.db'));
    const row = read.prepare('SELECT id, current_stage, resume_doc_id FROM applications').get()!;
    expect(row.current_stage).toBe('applied'); expect(row.resume_doc_id).toBeTruthy();
    expect(read.prepare('SELECT count(*) AS n FROM applications').get()!.n).toBe(1);
    read.close();
    const update = { application_id: row.id, changes: { current_stage: 'interview' }, expected_stage: 'applied', apply: true,
      evidence: { source_id: 'mail:example:invite1', text: 'Interview invitation', observed_at: '2026-11-16T12:00:00Z' } };
    run('application-update', update);
    expect(run('application-update', update).duplicate).toBe(true);
    expect(run('application', { application_id: row.id }).current_stage).toBe('interview');
    run('finish', auth);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}, 30000);

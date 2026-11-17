import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, ipcMain: { handle: () => {} } }));

import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import { companyKey, folderMatches, listPrepFiles, interviewsDirectory } from '../prep-files';

describe('folderMatches', () => {
  it('matches a folder named for the company, ignoring legal suffixes, spacing and brackets', () => {
    expect(folderMatches('FTI Group Pty Ltd', 'FTI Group')).toBe(true);
    expect(folderMatches('ModularWalls', 'Modular Walls')).toBe(true);
    expect(folderMatches('Massive Dynamic (via Harbor Ventures, stealth listing)', 'Massive Dynamic')).toBe(true);
    expect(folderMatches('Nimbus AI', 'Nimbus AI')).toBe(true);
  });
  it('does not match a different company that shares a short word', () => {
    expect(folderMatches('Hooli Retail', 'Hooli Games')).toBe(false);
    expect(folderMatches('Hudl', 'Hudson')).toBe(false);
    expect(companyKey('Pty Ltd')).toBe('');
    expect(folderMatches('Pty Ltd', 'Anything')).toBe(false);
  });
});

describe('listPrepFiles', () => {
  it('lists linked files and the company folder, skips missing files and other companies', () => {
    const db = new DatabaseSync(':memory:') as unknown as MigrationDb;
    createSchema(db);
    runMigrationLadder(db);
    db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at) VALUES ('standard','','Standard','[]',0,'2026-01-01')`);
    db.prepare(`INSERT INTO applications (id, company, job_title, location, job_url, job_source, job_description,
      key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id, created_at, updated_at)
      VALUES ('g', 'Glassons', 'Sales', '', '', null, 'd', '', '', '', 'interview', 'standard', '2026-10-01', '2026-10-01')`).run();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-'));
    fs.mkdirSync(path.join(root, 'Glassons'));
    fs.mkdirSync(path.join(root, 'Hooli'));
    fs.writeFileSync(path.join(root, 'Glassons', 'Glassons-Interview-Prep.pdf'), 'x');
    fs.writeFileSync(path.join(root, 'Glassons', '.DS_Store'), 'x');
    fs.writeFileSync(path.join(root, 'Hooli', 'Hooli-Prep.pdf'), 'x');
    const elsewhere = path.join(root, 'run-notes.pdf');
    fs.writeFileSync(elsewhere, 'x');
    const add = db.prepare(`INSERT INTO attachments (id, application_id, file_name, file_type, file_path, created_at) VALUES (?, 'g', ?, 'prep', ?, '2026-10-20')`);
    add.run('a1', 'run-notes.pdf', elsewhere);
    add.run('a2', 'gone.pdf', path.join(root, 'gone.pdf'));

    const names = listPrepFiles(db, 'g', root).map((f) => f.name).sort();
    expect(names).toEqual(['Glassons-Interview-Prep.pdf', 'run-notes.pdf']);
    expect(listPrepFiles(db, 'missing', root)).toEqual([]);
  });
});

it('keeps automatically discovered prep sheets inside the community userData folder', () => {
  expect(interviewsDirectory()).toBe(path.join('/tmp', 'interview-prep'));
});

import { approvalSnapshot } from '../../shared/approvals';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import { approveAll, decideStoredApproval, listApprovals } from '../approvals';

function database() {
  const db = new DatabaseSync(':memory:') as unknown as MigrationDb;
  createSchema(db);
  runMigrationLadder(db);
  db.prepare(`INSERT INTO approvals (id,kind,channel,body,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`).run('one', 'reply', 'email', 'Hello', 'pending', 'codex', '2026-10-13');
  db.prepare(`INSERT INTO approvals (id,kind,channel,body,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`).run('sent', 'reply', 'email', 'Already sent', 'sent', 'claude', '2026-10-12');
  return db;
}

describe('approval store', () => {
  it('keeps sent rows intact when approving all pending drafts', () => {
    const db = database();
    expect(approveAll(db, listApprovals(db).filter(a => a.status === 'pending').map(a => ({id:a.id, expected:approvalSnapshot(a)})))).toBe(1);
    expect(listApprovals(db).find(a => a.id === 'sent')?.status).toBe('sent');
    expect(approveAll(db, [])).toBe(0);
  });

  it('writes edited content atomically and rejects duplicate decisions', () => {
    const db = database();
    decideStoredApproval(db, 'one', { status: 'approved', body: 'Edited', expected: approvalSnapshot(listApprovals(db).find(a => a.id === 'one')!) });
    expect(listApprovals(db).find(a => a.id === 'one')).toMatchObject({ body: 'Edited', status: 'approved' });
    expect(() => decideStoredApproval(db, 'one', { status: 'skipped' })).toThrow(/no longer pending/);
  });
  it('approves only the drafts shown, leaving a newly inserted draft pending', () => {
    const db = database();
    const shown = listApprovals(db).filter(a => a.status === 'pending').map(a => ({id:a.id, expected:approvalSnapshot(a)}));
    db.prepare(`INSERT INTO approvals (id,kind,channel,body,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?)`).run('new', 'reply', 'email', 'Not reviewed', 'pending', 'codex', '2026-10-13');
    expect(approveAll(db, shown)).toBe(1);
    expect(listApprovals(db).find(a => a.id === 'new')?.status).toBe('pending');
  });

  it('rolls back the whole batch when a reviewed recipient has changed', () => {
    const db = database();
    db.prepare(`INSERT INTO approvals (id,kind,channel,body,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,?)`).run('two', 'reply', 'email', 'Second', 'pending', 'codex', '2026-10-13');
    const shown = listApprovals(db).filter(a => a.status === 'pending').map(a => ({id:a.id, expected:approvalSnapshot(a)}));
    db.prepare('UPDATE approvals SET to_address = ? WHERE id = ?').run('unseen@example.com', 'two');
    expect(() => approveAll(db, shown)).toThrow(/changed/);
    expect(listApprovals(db).filter(a => a.status === 'pending')).toHaveLength(2);
  });

});

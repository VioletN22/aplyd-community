import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import { importLeads, listLeads, saveLead, getLead } from '../leads';
import { parseLeadImport } from '../../shared/lead-import';
import { decideStoredApproval, listApprovals } from '../approvals';
import { approvalSnapshot } from '../../shared/approvals';
const tracker = 'id,segment,org,to,subject,status,sent_at,followup_due,reply,next_step\nb1,3d,Globex Retail,hi@example.com,Hi,sent,2026-10-01,2026-10-06,,<msg>\n';
function database() {
  const db = new DatabaseSync(':memory:') as unknown as MigrationDb;
  createSchema(db); runMigrationLadder(db); return db;
}

describe('lead store', () => {
  it('imports once, keeps message evidence, and preserves later manual edits', () => {
    const db = database();
    const data = parseLeadImport(tracker, 'email,reason,date\n');
    expect(importLeads(db, data)).toMatchObject({ insertedLeads: 1, insertedEvents: 1 });
    const lead = listLeads(db)[0];
    saveLead(db, { ...lead, stage: 'call', next_step: 'Call tomorrow' });
    expect(importLeads(db, data)).toMatchObject({ insertedLeads: 0, insertedEvents: 0 });
    expect(listLeads(db)).toHaveLength(1);
    expect(getLead(db, lead.id)?.lead).toMatchObject({ stage: 'call', next_step: 'Call tomorrow' });
    expect(getLead(db, lead.id)?.events.filter(e => e.kind === 'email_sent')).toHaveLength(1);
  });
  it('enforces 3d conflict at the approval store boundary', () => {
    const db = database();
    importLeads(db, parseLeadImport(tracker, 'email,reason,date\n', ['Globex']));
    db.prepare(`INSERT INTO approvals (id,kind,channel,body,status,created_by,created_at,lead_id)
      VALUES (?,?,?,?,?,?,?,?)`).run('a', 'outreach_email', 'email', 'Hi', 'pending', 'codex', '2026-10-13', listLeads(db)[0].id);
    const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get('a');
    expect(() => decideStoredApproval(db, 'a', { status: 'approved', expected: approvalSnapshot(row) })).toThrow(/conflict/);
    expect(db.prepare('SELECT status FROM approvals WHERE id = ?').get('a').status).toBe('pending');
  });
});

it('rejects an outdated lead edit without overwriting a newer agent update or adding history', () => {
  const db=database();
  const lead=saveLead(db,{org:'Club',segment:'group_a',stage:'prospect'});
  db.prepare("UPDATE leads SET notes='Agent found contact', updated_at='2026-10-14T00:00:00Z' WHERE id=?").run(lead.id);
  const before=db.prepare('SELECT count(*) AS n FROM lead_events').get().n;
  expect(()=>saveLead(db,{...lead,stage:'call'},lead.updated_at)).toThrow(/changed elsewhere/);
  expect(getLead(db,lead.id)?.lead).toMatchObject({stage:'prospect',notes:'Agent found contact'});
  expect(db.prepare('SELECT count(*) AS n FROM lead_events').get().n).toBe(before);
});

describe('older outreach names written after the conversion', () => {
  it('stores a lead saved with an older group name under its current key', () => {
    const db = database();
    expect(saveLead(db, { org: 'Club', segment: 'clubs', stage: 'prospect' }).segment).toBe('group_a');
    expect(listLeads(db)[0].segment).toBe('group_a');
  });
  it('reads an older draft kind as its current kind and stores the current kind on decision', () => {
    const db = database();
    const lead = saveLead(db, { org: 'Club', segment: 'group_b', stage: 'prospect' });
    db.prepare(`INSERT INTO approvals (id,kind,channel,body,status,created_by,created_at,lead_id)
      VALUES (?,?,?,?,?,?,?,?)`).run('old', 'purpl_followup', 'email', 'Hi', 'pending', 'agent', '2026-10-13', lead.id);
    const [listed] = listApprovals(db);
    expect(listed.kind).toBe('outreach_followup');
    decideStoredApproval(db, 'old', { status: 'skipped', expected: approvalSnapshot(listed) });
    expect(db.prepare('SELECT kind, status FROM approvals WHERE id = ?').get('old')).toEqual({ kind: 'outreach_followup', status: 'skipped' });
  });
});

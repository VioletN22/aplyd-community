import { randomUUID } from 'crypto';
import type { MigrationDb } from './database';
import { hasIndustryConflict, segmentFromInput, validateLead, type Lead, type LeadDetail, type LeadEvent } from '../shared/leads';
import type { LeadImport } from '../shared/lead-import';

const FIELDS = ['org', 'segment', 'contact_name', 'contact_email', 'contact_channel', 'website', 'demo_url',
  'stage', 'next_step', 'next_due_at', 'value_estimate', 'notes', 'do_not_contact', 'conflict_flag',
  'source', 'created_at', 'updated_at'] as const;

export function listLeads(db: MigrationDb): Lead[] {
  return db.prepare('SELECT * FROM leads ORDER BY updated_at DESC, org').all() as Lead[];
}
export function getLead(db: MigrationDb, id: string): LeadDetail | null {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Lead | undefined;
  if (!lead) return null;
  const events = db.prepare('SELECT * FROM lead_events WHERE lead_id = ? ORDER BY at DESC, id').all(id) as LeadEvent[];
  return { lead, events };
}
function insertLead(db: MigrationDb, lead: Lead): void {
  db.prepare(`INSERT INTO leads (id,${FIELDS.join(',')}) VALUES (?,${FIELDS.map(() => '?').join(',')})`)
    .run(lead.id, ...FIELDS.map(field => lead[field]));
}
export function saveLead(db: MigrationDb, input: Partial<Lead> & Pick<Lead, 'org' | 'segment' | 'stage'>, expectedUpdatedAt?: string): Lead {
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior = input.id ? getLead(db, input.id)?.lead : undefined;
    if (expectedUpdatedAt !== undefined && prior?.updated_at !== expectedUpdatedAt) {
      throw new Error('This lead changed elsewhere. Reload the latest version before saving.');
    }
    const at = new Date(Math.max(Date.now(), (Date.parse(prior?.updated_at || '') || 0) + 1)).toISOString();
    const lead: Lead = {
      id: input.id || randomUUID(), contact_name: null,
      contact_email: null, contact_channel: null, website: null, demo_url: null, next_step: null,
      next_due_at: null, value_estimate: null, notes: null, do_not_contact: 0, conflict_flag: 0,
      source: 'manual', created_at: at, ...prior, ...input, updated_at: at,
    };
    // An older name for a group (from a stale caller) is stored under its current key.
    lead.segment = segmentFromInput(lead.segment) ?? lead.segment;
    validateLead(lead);
    if (lead.value_estimate !== null && (!Number.isFinite(lead.value_estimate) || lead.value_estimate < 0)) {
      throw new Error('Value estimate must be a positive amount or blank.');
    }
    if (lead.next_due_at && !Number.isFinite(Date.parse(lead.next_due_at))) throw new Error('Choose a valid next due date.');
    if (hasIndustryConflict([lead.org, lead.website, lead.notes].filter(Boolean).join(' '))) lead.conflict_flag = 1;
    if (prior) db.prepare(`UPDATE leads SET ${FIELDS.map(field => `${field} = ?`).join(',')} WHERE id = ?`)
      .run(...FIELDS.map(field => lead[field]), lead.id);
    else insertLead(db, lead);
    if (!prior || prior.stage !== lead.stage) {
      db.prepare('INSERT INTO lead_events (id,lead_id,kind,detail,at) VALUES (?,?,?,?,?)')
        .run(randomUUID(), lead.id, 'stage', `${prior?.stage || 'new'} → ${lead.stage}`, at);
    }
    if (lead.stage === 'call' && (prior?.stage !== 'call' || prior.next_due_at !== lead.next_due_at)) {
      db.prepare('INSERT INTO lead_events (id,lead_id,kind,detail,at) VALUES (?,?,?,?,?)')
        .run(randomUUID(), lead.id, 'call', lead.next_step || 'Call booked', lead.next_due_at || at);
    }
    db.exec('COMMIT');
    return lead;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export interface ImportResult { insertedLeads: number; insertedEvents: number; skipped: number; problems: string[] }
/** Caller owns its backup. This function only writes to the explicit supplied DB. */
export function importLeads(db: MigrationDb, data: LeadImport): ImportResult {
  let insertedLeads = 0;
  let insertedEvents = 0;
  const identities = new Map<string, string>();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const lead of data.leads) {
      validateLead(lead);
      const existing = db.prepare('SELECT id FROM leads WHERE id = ? OR (contact_email IS NOT NULL AND lower(contact_email) = lower(?)) LIMIT 1')
        .get(lead.id, lead.contact_email) as { id: string } | undefined;
      identities.set(lead.id, existing?.id ?? lead.id);
      if (existing) {
        // Import may strengthen safety flags, but never rewrites a user's later edits.
        db.prepare('UPDATE leads SET do_not_contact = MAX(do_not_contact, ?), conflict_flag = MAX(conflict_flag, ?) WHERE id = ?')
          .run(lead.do_not_contact, lead.conflict_flag, existing.id);
      } else { insertLead(db, lead); insertedLeads++; }
    }
    for (const event of data.events) {
      const result = db.prepare('INSERT OR IGNORE INTO lead_events (id,lead_id,kind,detail,at) VALUES (?,?,?,?,?)')
        .run(event.id, identities.get(event.lead_id) ?? event.lead_id, event.kind, event.detail, event.at);
      insertedEvents += Number(result.changes);
    }
    db.exec('COMMIT');
    return { insertedLeads, insertedEvents, skipped: data.skipped, problems: data.problems ?? [] };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

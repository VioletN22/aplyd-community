import { ACCEPTED_SEGMENT_VALUES, hasIndustryConflict, segmentFromInput, type Lead, type LeadEvent } from './leads';

/** Small RFC4180 reader: preserves commas, escaped quotes and newlines in quoted fields. */
export function readCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { record.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      record.push(field); records.push(record); record = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quote.');
  if (field || record.length) { record.push(field); records.push(record); }
  const headings = records.shift()?.map(value => value.trim().replace(/^\uFEFF/, '')) ?? [];
  return records.filter(row => row.some(value => value.trim())).map(row =>
    Object.fromEntries(headings.map((key, index) => [key, row[index] ?? ''])),
  );
}

export interface LeadImport {
  leads: Lead[];
  events: LeadEvent[];
  skipped: number;
  /** One plain message per row that was skipped for a reason the user can fix. */
  problems: string[];
}
export function parseLeadImport(trackerCsv: string, suppressionCsv: string, blockedTerms: readonly string[] = []): LeadImport {
  const suppression = readCsv(suppressionCsv);
  const suppressed = new Set(suppression.map(row => row.email?.trim().toLowerCase()).filter(Boolean));
  const leads = new Map<string, Lead>();
  const events = new Map<string, LeadEvent>();
  let skipped = 0;
  const problems: string[] = [];
  readCsv(trackerCsv).forEach((row, index) => {
    if (row.status !== 'sent' || !row.sent_at || !Number.isFinite(Date.parse(row.sent_at)) || !row.org?.trim()) { skipped++; return; }
    const segment = segmentFromInput(row.segment);
    if (!segment) {
      skipped++;
      const shown = (row.segment ?? '').trim();
      const what = shown ? `the segment "${shown}" is not one Aplyd knows` : 'the segment is empty';
      problems.push(`Row ${index + 1} (${row.org.trim()}): ${what}. Use ${ACCEPTED_SEGMENT_VALUES}.`);
      return;
    }
    const email = (row.to || '').trim().toLowerCase();
    const identity = email || row.org.trim().toLowerCase();
    const id = `tracker:${identity}`;
    if (!leads.has(id)) {
      leads.set(id, {
        id, org: row.org.trim(), segment, contact_name: null,
        contact_email: row.to || null, contact_channel: 'email', website: null, demo_url: null,
        stage: 'contacted', next_step: null, next_due_at: row.followup_due || null, value_estimate: null,
        notes: ['Imported from CSV.', row.reply ? `Tracker note: ${row.reply}` : ''].filter(Boolean).join('\n'),
        do_not_contact: suppressed.has(email) ? 1 : 0,
        conflict_flag: hasIndustryConflict([row.org, row.subject, row.reply, row.next_step].join(' '), blockedTerms) || row.conflict_flag === '1' ? 1 : 0,
        source: 'outreach/tracker.csv', created_at: row.sent_at, updated_at: row.sent_at,
      });
    }
    const messageId = /<[^>]+>/.exec(row.next_step || '')?.[0] ?? null;
    const eventId = `tracker-send:${messageId || `${row.id}:${row.sent_at}`}`;
    events.set(eventId, {
      id: eventId, lead_id: id, kind: 'email_sent', at: row.sent_at,
      detail: JSON.stringify({ subject: row.subject, to: row.to, messageId, trackerId: row.id }),
    });
  });
  for (const row of suppression) {
    const email = row.email?.trim().toLowerCase();
    if (!email || leads.has(`tracker:${email}`)) continue;
    const id = `tracker:${email}`;
    leads.set(id, {
      id, org: row.email, segment: 'group_b', contact_name: null, contact_email: row.email,
      contact_channel: 'email', website: null, demo_url: null, stage: 'prospect', next_step: null,
      next_due_at: null, value_estimate: null, notes: row.reason || 'Suppressed contact',
      do_not_contact: 1, conflict_flag: 0, source: 'outreach/suppression.csv',
      created_at: row.date || '1970-01-01', updated_at: row.date || '1970-01-01',
    });
  }
  return { leads: [...leads.values()], events: [...events.values()], skipped, problems };
}

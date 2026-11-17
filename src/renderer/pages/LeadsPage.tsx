import { CALENDAR_ZONE } from '../../shared/calendar';
import React, { useCallback, useEffect, useState } from 'react';
import { LEAD_SEGMENTS, LEAD_STAGES, LEAD_STAGE_HELP, SEGMENT_LABELS, leadDueState, type Lead } from '../../shared/leads';
import { LeadDetailPage } from './LeadDetailPage';
import { displayLocale } from '../../shared/locale';

/** "Mon 19 Oct, 11:40 pm" (or the bare day for a date-only due), the configured calendar timezone. */
function formatDue(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00Z`).toLocaleDateString(displayLocale(), { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleString(displayLocale(), { timeZone: CALENDAR_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function DueCell({ lead }: { lead: Lead }) {
  const state = leadDueState(lead);
  if (!state) return <span className="lead-due">{lead.stage === 'contacted' ? 'No follow-up set' : formatDue(lead.next_due_at)}</span>;
  return <span className={`lead-due ${state}`}>{formatDue(lead.next_due_at)}<small>{state === 'overdue' ? 'Follow-up overdue' : 'Follow up if no reply'}</small></span>;
}

export function LeadsPage({ initialLeadId, onClearSelection }: { initialLeadId?: string | null; onClearSelection: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string | null | undefined>(initialLeadId || undefined);
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await window.electronAPI.leads.list();
      if (!result.ok) throw new Error(result.error || 'Could not load leads.');
      setLeads(result.data || []);
    } catch (error) { setError(String(error)); }
  }, []);
  useEffect(() => { void load(); return window.electronAPI.cockpit.onChanged(() => void load()); }, [load]);
  useEffect(() => { if (initialLeadId) setSelected(initialLeadId); }, [initialLeadId]);

  const importTracker = async () => {
    setImporting(true);
    try {
      const result = await window.electronAPI.leads.importTracker();
      if (!result.ok || !result.data) throw new Error(result.error || 'Import failed.');
      const problems = result.data.problems ?? [];
      const listed = problems.slice(0, 5).join(' ');
      const more = problems.length > 5 ? ` ${problems.length - 5} more rows have a problem like these.` : '';
      setNotice(`Imported ${result.data.insertedLeads} leads and ${result.data.insertedEvents} sends. ${result.data.skipped} rows skipped.${listed ? ' ' + listed + more : ''}`);
      await load();
    } catch (error) { setError(String(error)); }
    finally { setImporting(false); }
  };
  if (selected !== undefined) return <LeadDetailPage id={selected} onBack={() => { setSelected(undefined); onClearSelection(); void load(); }}/>
  const visible = leads.filter(lead => (!segment || lead.segment === segment) && (!stage || lead.stage === stage) &&
    [lead.org, lead.contact_name, lead.contact_email, lead.notes].join(' ').toLowerCase().includes(search.toLowerCase()));

  return <div className="leads-page">
    <div className="home-toolbar"><h1><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" fill="var(--purple)" /><path d="M3.5 7.25L12 12l8.5-4.75 M12 12v9.5" fill="none" stroke="#fff" strokeWidth={1.4} /></svg>Outreach</h1>
      <button className="btn" disabled={importing} onClick={() => void importTracker()}>{importing ? 'Importing…' : 'Import outreach tracker'}</button>
      <button className="btn" onClick={() => setSelected(null)}>New lead</button>
    </div>
    <p className="cockpit-empty">Confirmed sends from tracker.csv and suppression.csv. Repeat imports preserve your changes; only confirmed sends are imported.</p>
    <ul className="lead-legend" aria-label="Stage key">
      {(['prospect', 'contacted', 'replied', 'won', 'lost'] as const).map(value => <li key={value}><span className={`cockpit-chip lead-stage ${value}`}>{value}</span>{LEAD_STAGE_HELP[value]}</li>)}
    </ul>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="today-error">{error}</p>}
    <div className="lead-filters">
      <input aria-label="Search leads" placeholder="Search organisations or contacts" value={search} onChange={event => setSearch(event.target.value)}/>
      <select aria-label="Segment" value={segment} onChange={event => setSegment(event.target.value)}><option value="">All segments</option>{LEAD_SEGMENTS.map(value => <option value={value} key={value}>{SEGMENT_LABELS[value]}</option>)}</select>
      <select aria-label="Stage" value={stage} onChange={event => setStage(event.target.value)}><option value="">All stages</option>{LEAD_STAGES.map(value => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="lead-table"><div className="lead-list-header"><span>Organisation</span><span>Segment</span><span>Stage</span><span>Next step</span><span>Due</span></div>
      {visible.map(lead => <button className="lead-list-row" key={lead.id} onClick={() => setSelected(lead.id)}>
        <span><strong>{lead.org}</strong>{!!lead.do_not_contact && <small>Do not contact</small>}{!!lead.conflict_flag && <small>Industry conflict</small>}</span>
        <span>{SEGMENT_LABELS[lead.segment]}</span><span className={`cockpit-chip lead-stage ${lead.stage}`} title={LEAD_STAGE_HELP[lead.stage as keyof typeof LEAD_STAGE_HELP]}>{lead.stage}</span><span>{lead.next_step || ''}</span><DueCell lead={lead}/>
      </button>)}
    </div>
    {!visible.length && <p className="cockpit-empty">No matching leads.</p>}
  </div>;
}

import { CALENDAR_ZONE } from '../../shared/calendar';
import React, { useEffect, useRef, useState } from 'react';
import { LEAD_SEGMENTS, LEAD_STAGES, SEGMENT_LABELS, type Lead, type LeadDetail } from '../../shared/leads';
import { ApprovalHistory } from '../components/ApprovalHistory';

export function LeadDetailPage({ id, onBack }: { id: string | null; onBack: () => void }) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [draft, setDraft] = useState<Partial<Lead>>({ org: '', segment: 'group_a', stage: 'prospect' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const dirty = useRef(false);
  const baseUpdatedAt = useRef<string | undefined>(undefined);
  const [externalUpdate, setExternalUpdate] = useState(false);
  const edit = (value: Partial<Lead>) => { dirty.current = true; setDraft(value); };

  useEffect(() => {
    if (!id) return;
    let active = true;
    let sequence = 0;
    dirty.current = false;
    baseUpdatedAt.current = undefined;
    setExternalUpdate(false);
    const load = async () => {
      const request = ++sequence;
      try {
        const result = await window.electronAPI.leads.get(id);
        if (!active || request !== sequence) return;
        if (!result.ok || !result.data) throw new Error(result.error || 'Lead not found.');
        setDetail(result.data);
        setError('');
        if (!dirty.current) {
          setDraft(result.data.lead);
          baseUpdatedAt.current = result.data.lead.updated_at;
          setExternalUpdate(false);
        } else if (baseUpdatedAt.current !== result.data.lead.updated_at) {
          setExternalUpdate(true);
        }
      } catch (error) {
        if (active && request === sequence) setError(String(error));
      }
    };
    void load();
    const off = window.electronAPI.cockpit.onChanged(() => void load());
    return () => { active = false; off(); };
  }, [id]);

  const reload = () => {
    if (!detail) return;
    setDraft(detail.lead);
    baseUpdatedAt.current = detail.lead.updated_at;
    dirty.current = false;
    setExternalUpdate(false);
    setError('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await window.electronAPI.leads.save({ ...draft, org: draft.org || '', segment: draft.segment || 'group_a', stage: draft.stage || 'prospect' }, id ? baseUpdatedAt.current : undefined);
      if (!result.ok) throw new Error(result.error || 'Could not save lead.');
      onBack();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const field = (key: keyof Lead, label: string, type = 'text') => <label key={key}>{label}
    <input type={type} value={String(draft[key] ?? '')} onChange={event => edit({ ...draft, [key]: event.target.value || null })}/>
  </label>;

  return <div className="lead-detail">
    <button className="btn btn-link" onClick={onBack}>← Back to outreach</button>
    <h1>{id ? detail?.lead.org || 'Lead' : 'New lead'}</h1>
    {error && <p role="alert" className="today-error">{error}</p>}
    {externalUpdate && <div className="lead-warning" role="status">
      This lead changed elsewhere. Your unsaved edits are still shown; history is current. Reload the latest version before saving.
      <button type="button" className="btn" onClick={reload}>Reload latest and discard my edits</button>
    </div>}
    {!!draft.do_not_contact && <p className="lead-warning">Do not contact. Approvals are blocked.</p>}
    {!!draft.conflict_flag && <p className="lead-warning">Outreach is blocked for this flagged conflict.</p>}
    <div className="lead-detail-grid"><form onSubmit={save} className="lead-form">
      {field('org', 'Organisation')}
      <label>Segment<select value={draft.segment} onChange={event => edit({ ...draft, segment: event.target.value })}>
        {LEAD_SEGMENTS.map(segment => <option key={segment} value={segment}>{SEGMENT_LABELS[segment]}</option>)}
      </select></label>
      <label>Stage<select value={draft.stage} onChange={event => edit({ ...draft, stage: event.target.value })}>
        {LEAD_STAGES.map(stage => <option key={stage}>{stage}</option>)}
      </select></label>
      {field('contact_name', 'Contact name')}{field('contact_email', 'Contact email', 'email')}
      {field('contact_channel', 'Contact channel')}{field('website', 'Website', 'url')}{field('demo_url', 'Demo URL', 'url')}
      {field('next_step', 'Next step')}
      <label>Next due date<input type="date" value={draft.next_due_at?.slice(0,10) || ''} onChange={event => edit({ ...draft, next_due_at: event.target.value ? event.target.value + (draft.next_due_at?.includes('T') ? draft.next_due_at.slice(10,16) : '') : null })}/></label>
      <label>Time (optional, {CALENDAR_ZONE})<input type="time" value={draft.next_due_at?.slice(11,16) || ''} disabled={!draft.next_due_at} onChange={event => edit({ ...draft, next_due_at: draft.next_due_at!.slice(0,10) + (event.target.value ? `T${event.target.value}` : '') })}/></label>
      <label>Value estimate<input type="number" min="0" step="any" value={draft.value_estimate ?? ''} onChange={event => edit({ ...draft, value_estimate: event.target.value === '' ? null : Number(event.target.value) })}/></label>
      <label>Notes<textarea rows={5} value={draft.notes || ''} onChange={event => edit({ ...draft, notes: event.target.value || null })}/></label>
      <label className="lead-checkbox"><input type="checkbox" checked={!!draft.do_not_contact} onChange={event => edit({ ...draft, do_not_contact: Number(event.target.checked) })}/>Do not contact</label>
      <label className="lead-checkbox"><input type="checkbox" checked={!!draft.conflict_flag} onChange={event => edit({ ...draft, conflict_flag: Number(event.target.checked) })}/>Industry conflict</label>
      <button className="btn" disabled={busy || externalUpdate || (!!id && !detail) || !draft.org?.trim()}>{busy ? 'Saving…' : 'Save lead'}</button>
    </form><div>
      <h2>History</h2>
      {detail?.events.length ? detail.events.map(event => <div className="lead-event" key={event.id}>
        <strong>{event.kind.replace(/_/g, ' ')}</strong><time>{event.at}</time>
        <p>{event.detail}</p>
      </div>) : <p className="cockpit-empty">No history yet.</p>}
      {id && <ApprovalHistory leadId={id}/>}
    </div></div>
  </div>;
}

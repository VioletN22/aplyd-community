import React, { useEffect, useState } from 'react';
import { SYSTEM_CALENDAR_ZONE, validateCalendarPreferences, type CalendarPreferences, type RecurringCommitment } from '../../shared/calendar';
import { useCalendarPreferences } from '../hooks/useCalendarPreferences';
const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const timeLabel = (hour: number) => `${Math.floor(hour).toString().padStart(2,'0')}:${Math.round((hour % 1) * 60).toString().padStart(2,'0')}`;
const hourOf = (value: string) => { const [h,m] = value.split(':').map(Number); return h + m / 60; };
export function CalendarPreferencesEditor() {
  const saved = useCalendarPreferences();
  const [draft, setDraft] = useState<CalendarPreferences>(saved);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(saved); }, [saved]);
  const edit = (index: number, update: Partial<RecurringCommitment>) => setDraft(current => ({...current, recurring:current.recurring.map((row,i) => i === index ? {...row,...update} : row)}));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage(''); setBusy(true);
    try {
      const result = await window.electronAPI.calendar.savePreferences(validateCalendarPreferences(draft));
      if (!result.ok) throw new Error(result.error || 'Could not save calendar preferences.');
      setMessage('Calendar preferences saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save calendar preferences.'); }
    finally { setBusy(false); }
  };
  return <form className="lead-form" onSubmit={save}>
    <h4>Local calendar preferences</h4>
    <label>Timezone (IANA name)<input value={draft.timeZone} placeholder={SYSTEM_CALENDAR_ZONE} onChange={event => setDraft({...draft,timeZone:event.target.value})}/></label>
    <button className="btn" type="button" onClick={() => setDraft({...draft,timeZone:SYSTEM_CALENDAR_ZONE})}>Use system timezone</button>
    <p>Recurring commitments appear in your local calendar. Start with none, or add your own weekly schedule.</p>
    {draft.recurring.map((row,index) => <fieldset key={row.slug}>
      <legend>Commitment {index + 1}</legend>
      <label>Title<input required maxLength={200} value={row.title} onChange={event => edit(index,{title:event.target.value})}/></label>
      <label>Weekday<select value={row.weekday} onChange={event => edit(index,{weekday:Number(event.target.value)})}>{days.map((day,i) => <option key={day} value={i}>{day}</option>)}</select></label>
      <label>Start<input required type="time" value={timeLabel(row.startHour)} onChange={event => edit(index,{startHour:hourOf(event.target.value)})}/></label>
      <label>End<input required type="time" value={timeLabel(row.endHour)} onChange={event => edit(index,{endHour:hourOf(event.target.value)})}/></label>
      <label>Last day (optional)<input type="date" value={row.until || ''} onChange={event => edit(index,{until:event.target.value || undefined})}/></label>
      <label>Skip dates (comma separated)<input placeholder="YYYY-MM-DD, YYYY-MM-DD" value={(row.skip || []).join(', ')} onChange={event => edit(index,{skip:event.target.value ? event.target.value.split(',').map(day => day.trim()) : []})}/></label>
      <button className="btn" type="button" onClick={() => setDraft({...draft,recurring:draft.recurring.filter((_,i) => i !== index)})}>Remove commitment</button>
    </fieldset>)}
    <div className="approval-actions">
      <button className="btn" type="button" disabled={draft.recurring.length >= 100} onClick={() => setDraft({...draft,recurring:[...draft.recurring,{slug:crypto.randomUUID(),title:'',weekday:1,startHour:9,endHour:10}]})}>Add weekly commitment</button>
      <button className="btn" disabled={busy}>Save calendar preferences</button>
    </div>
    {message && <p role="status">{message}</p>}
  </form>;
}

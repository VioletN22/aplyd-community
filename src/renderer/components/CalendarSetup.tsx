import { CalendarPreferencesEditor } from './CalendarPreferencesEditor';
import React, { useCallback, useEffect, useState } from 'react';
import type { CalendarStatus } from '../../shared/google-calendar';
import { displayLocale } from '../../shared/locale';

export function CalendarSetup() {
  const [status,setStatus] = useState<CalendarStatus | null>(null);
  const [clientId,setClientId] = useState('');
  const [secret,setSecret] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await window.electronAPI.calendar.status();
    if (result.ok && result.data) setStatus(result.data);
    else setError(result.error || 'Could not read Calendar status.');
  },[]);
  useEffect(() => { void load(); return window.electronAPI.calendar.onChanged(() => void load()); },[load]);
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await window.electronAPI.calendar.connect(clientId.trim(),secret.trim());
      if (!result.ok) throw new Error(result.error || 'Could not connect Calendar.');
      setSecret(''); setClientId(''); await load();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    const result = await window.electronAPI.calendar.disconnect();
    if (!result.ok) setError(result.error || 'Could not disconnect Calendar.');
    else { setError(''); await load(); }
  };
  return <section className="calendar-setup">
    <h3>Calendar</h3>
    <CalendarPreferencesEditor/>
    <p>{status?.connecting ? 'Waiting for Google sign-in…' : status?.connected ? 'Connected to Google Calendar' : 'Not connected'}</p>
    <p className="cockpit-empty">{status?.syncing ? 'Syncing…' : status?.lastSync ? `Last sync: ${new Date(status.lastSync).toLocaleString(displayLocale())}` : 'Your local calendar works before you connect.'}</p>
    {(error || status?.error) && <p role="alert" className="today-error">{error || status?.error}</p>}
    {status?.connected ? <div className="approval-actions">
      <button className="btn" disabled={status.syncing} onClick={() => { void window.electronAPI.calendar.sync().then(load); }}>Sync now</button>
      <button className="btn" onClick={() => void disconnect()}>Disconnect</button>
    </div> : <form onSubmit={connect} className="lead-form">
      <label>Desktop OAuth client ID<input value={clientId} autoComplete="off" onChange={event => setClientId(event.target.value)}/></label>
      <label>Client secret<input type="password" value={secret} autoComplete="off" onChange={event => setSecret(event.target.value)}/></label>
      <button className="btn" disabled={busy || !clientId.trim() || !secret.trim()}>Connect</button>
      {status?.connecting && <button type="button" className="btn" onClick={() => void disconnect()}>Cancel sign-in</button>}
    </form>}
    <details className="calendar-help"><summary>One-time Google setup · for your review</summary>
      <ol>
        <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, create a project named <strong>Aplyd</strong>.</li>
        <li>Enable <strong>Google Calendar API</strong> in APIs &amp; Services → Library.</li>
        <li>Open Google Auth Platform (OAuth consent screen). Choose <strong>External</strong>, enter the app name and your contact email, and add yourself as a test user.</li>
        <li>In Audience, publish the app to <strong>Production</strong>. External apps left in Testing generally receive refresh tokens that expire after seven days. A personal unverified app may show a warning when you sign in.</li>
        <li>Create an OAuth client under Clients / Credentials. Choose <strong>Desktop app</strong>. Paste its client ID and secret above.</li>
        <li>Click Connect and sign in yourself with your Google account.</li>
      </ol>
      <p>Permissions: read calendars and events, manage calendar events, and create app calendars. The additional <code>calendar.app.created</code> scope is required to create the dedicated Aplyd calendar; events + readonly alone cannot create it.</p>
      <p>Aplyd writes its interviews, deadlines, lead calls and follow-ups only to its dedicated Aplyd Community calendar. Your primary calendar appears read-only. Credentials and the refresh token are encrypted locally using your operating system’s protected storage. Disconnect removes local credentials and leaves existing calendar events in Google.</p>
      <p><a href="https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert" target="_blank" rel="noreferrer">Google calendar creation permissions</a> · <a href="https://developers.google.com/identity/protocols/oauth2/native-app" target="_blank" rel="noreferrer">Desktop OAuth guide</a></p>
    </details>
  </section>;
}

import React, { useEffect, useState } from 'react';

type Target = 'codex' | 'claude' | 'both';
type Result<T> = { ok: boolean; data?: T; error?: string };
type Plan = { dry_run: boolean; plan: { destination: string; action: string; version: string; files: number }[]; next?: string };
type Status = { dataDir: string; pythonVersion: string; installerAvailable: boolean };
interface SkillsApi {
  status(): Promise<Result<Status>>;
  preview(target: Target, update: boolean): Promise<Result<Plan>>;
  install(target: Target, update: boolean): Promise<Result<Plan>>;
}

export function SkillsSetup(): React.ReactElement {
  const api = (window as unknown as { electronAPI?: { skills?: SkillsApi } }).electronAPI?.skills;
  const [target, setTarget] = useState<Target>('both');
  const [update, setUpdate] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (api) api.status().then(result => {
      if (!active) return;
      if (result.ok && result.data) setStatus(result.data);
      else setError(result.error || 'Could not check skill setup.');
    }).catch(() => { if (active) setError('Could not check skill setup.'); });
    return () => { active = false; };
  }, [api]);

  const perform = async (install: boolean) => {
    if (!api) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = install ? await api.install(target, update) : await api.preview(target, update);
      if (!result.ok || !result.data) throw new Error(result.error || 'Skill setup failed.');
      if (install) {
        setPlan(null);
        setMessage('Skills installed. Refresh skill discovery or restart your agent, then ask it to use aplyd-daily-applications, aplyd-email-pass, or aplyd-application-update. To remove them later, delete those three folders from your agent\'s skills folder.');
      } else setPlan(result.data);
    } catch (e) { setPlan(null); setError(e instanceof Error ? e.message : 'Skill setup failed.'); }
    finally { setBusy(false); }
  };
  const clearPreview = () => { setPlan(null); setError(''); setMessage(''); };

  return <section style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 20, marginTop: 24 }}>
    <h3 style={{ margin: '0 0 8px' }}>Claude Code and Codex skills</h3>
    <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
      Add email reconciliation, application updates and a resumable application workflow to your own agent session.
      Python 3.10+ is required. Your agent needs its own browser or mail connection for those actions.
    </p>
    {status && <p style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
      Community data directory: <code>{status.dataDir}</code><br />
      Python {status.pythonVersion}{!status.installerAvailable && ' · Installer missing from this build'}
    </p>}
    {!api ? <p>Skill installation is available in the desktop app.</p> : <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Install for{' '}<select aria-label="Agent for skills" value={target} disabled={busy} onChange={e => { setTarget(e.target.value as Target); clearPreview(); }}>
          <option value="both">Codex and Claude Code</option>
          <option value="codex">Codex</option>
          <option value="claude">Claude Code</option>
        </select></label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={update} disabled={busy} onChange={e => { setUpdate(e.target.checked); clearPreview(); }} /> Update an existing managed installation</label>
        <button className="btn" disabled={busy || status?.installerAvailable === false} onClick={() => void perform(false)}>{busy ? 'Checking…' : 'Preview destinations'}</button>
      </div>
      {plan && <div style={{ marginTop: 14 }}>
        <p style={{ fontSize: 12 }}>These skill folders will be {update ? 'updated' : 'created'}. Existing local edits are protected.</p>
        <ul style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{plan.plan.map(row => <li key={row.destination}>{row.destination}</li>)}</ul>
        <button className="btn btn-accent" disabled={busy} onClick={() => void perform(true)}>{update ? 'Update skills' : 'Install skills'}</button>
      </div>}
    </>}
    {error && <p role="alert" style={{ color: 'var(--accent)', fontSize: 12, overflowWrap: 'anywhere' }}>{error}</p>}
    {message && <p role="status" style={{ fontSize: 12, lineHeight: 1.6 }}>{message}</p>}
  </section>;
}

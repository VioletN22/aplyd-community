import React, { useEffect, useState } from 'react';
import { DEFAULT_ANTHROPIC_MODEL, type AIProviderName, type AIStatus } from '../../shared/ai-types';

export function AIProviderSection() {
  const [provider, setProvider] = useState<AIProviderName>('none');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    window.electronAPI.ai.status().then(result => {
      if (result.data) { setStatus(result.data); setProvider(result.data.provider); setModel(result.data.model); }
      else setMessage(result.error || 'Could not load AI settings.');
    }).catch(() => setMessage('Could not load AI settings.'));
    window.electronAPI.system.getInfo().then(result => setDirectory(result.data?.dataDirectory || '')).catch(() => {});
  }, []);
  async function action(kind: 'save' | 'test' | 'remove') {
    setBusy(true); setMessage('');
    try {
      const result = kind === 'test' ? await window.electronAPI.ai.test() : await window.electronAPI.ai.configure({ provider, model, ...(apiKey ? { apiKey } : {}), ...(kind === 'remove' ? { removeApiKey: true } : {}) });
      setApiKey('');
      if (!result.ok || !result.data) throw new Error(result.error || 'Provider operation failed');
      setStatus(result.data); setMessage(result.data.message); setDirty(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Provider operation failed'); }
    finally { setBusy(false); }
  }
  const field: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: 9, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6 };
  return <>
    <section style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 24 }}>
      <h3>Optional AI provider</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '12px 0' }}>Applications, notes and stages work without AI. AI requests send the relevant job, profile, resume or email text to your selected provider. Provider usage limits and charges apply.</p>
      <label>Provider
        <select style={field} value={provider} disabled={busy} onChange={e => { setProvider(e.target.value as AIProviderName); setModel(''); setDirty(true); }}>
          <option value="none">None: manual tracking</option>
          <option value="anthropic">Claude: Anthropic API key</option>
          <option value="codex">Codex: existing CLI login</option>
        </select>
      </label>
      {provider !== 'none' && <label style={{ display: 'block', marginTop: 14 }}>Model ID (optional)
        <input style={field} value={model} disabled={busy} placeholder={provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : 'Codex default model'} onChange={e => { setModel(e.target.value); setDirty(true); }} />
      </label>}
      {provider === 'anthropic' && <>
        <label style={{ display: 'block', marginTop: 14 }}>Anthropic API key
          <input style={field} type="password" value={apiKey} disabled={busy} autoComplete="off" spellCheck={false} placeholder={status?.hasApiKey ? 'Saved securely; enter to replace' : 'Paste your API key'} onChange={e => { setApiKey(e.target.value); setDirty(true); }} />
        </label>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Stored with your operating system’s encrypted storage. Anthropic API billing is separate from a Claude subscription. Claude Code skills run in your own Claude Code session.</p>
      </>}
      {provider === 'codex' && <>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>Sign in once with <code>codex login</code> in Terminal or PowerShell. Then save your choice here and test the connection. Aplyd uses your own Codex account.</p>
        <details style={{ fontSize: 12, marginTop: 8 }}><summary>Which Codex version works?</summary><p>This app supports Codex 0.169.0, including its prereleases. Check with <code>codex --version</code>. If you use another version, keep it for your usual work; you can use the Aplyd skills there, or choose an Anthropic API key for AI inside this app.</p></details>
      </>}
      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => action('save')}>{busy ? 'Working…' : 'Save provider'}</button>
        <button disabled={busy || dirty || provider === 'none'} onClick={() => action('test')}>Test connection (uses AI)</button>
        {provider === 'anthropic' && status?.hasApiKey && <button disabled={busy} onClick={() => action('remove')}>Remove saved key</button>}
        <button onClick={() => { window.electronAPI.ai.cancelAll().then(() => setMessage('Running and queued AI requests cancelled.')).catch(() => setMessage('Cancellation failed.')); }}>Cancel AI requests</button>
      </div>
      <p role="status" style={{ marginTop: 12, fontSize: 13 }}>{message || status?.message || 'Loading provider settings…'}</p>
      {dirty && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Save changes before testing.</p>}
    </section>
    <section style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 24 }}>
      <h3>Local data</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '12px 0' }}>Use this data directory with the optional Aplyd agent skills. Skills run in your own Codex or Claude Code session.</p>
      <code style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 12 }}>{directory || 'Loading…'}</code>
      <button style={{ marginTop: 12 }} disabled={!directory} onClick={() => navigator.clipboard.writeText(directory).then(() => setMessage('Data directory copied.')).catch(() => setMessage('Could not copy the directory.'))}>Copy data directory</button>
    </section>
  </>;
}

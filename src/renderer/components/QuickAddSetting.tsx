import React, { useEffect, useState } from 'react';
import { formatAccelerator, quickAddApi, QuickAddShortcut } from '../lib/quickAdd';

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '24px',
  marginBottom: '32px',
};
const field: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontSize: 12.5,
  fontFamily: 'inherit',
};
const hint: React.CSSProperties = { fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0 0' };

/** The global quick-add shortcut: what it is, whether it registered, and a way to change it. */
export const QuickAddSetting: React.FC = () => {
  const [current, setCurrent] = useState<QuickAddShortcut | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = async () => {
    const api = quickAddApi();
    if (!api) return;
    try {
      const res = await api.getShortcut();
      if (res?.ok && res.data) { setCurrent(res.data); setDraft(res.data.shortcut); }
    } catch { /* leave the section as it was */ }
  };
  useEffect(() => { load(); }, []);

  if (!quickAddApi()) return null;

  const save = async () => {
    const api = quickAddApi();
    const accel = draft.trim();
    if (!api || !accel) return;
    setSaving(true); setSaveError('');
    try {
      const res = await api.setShortcut(accel);
      if (!res?.ok) throw new Error(res?.error || 'That shortcut did not save.');
      await load();
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={card}>
      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px' }}>Quick add</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px' }}>
        Copy a job ad or link anywhere, then press this to add it.
      </p>

      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <kbd
            title={current?.shortcut || undefined}
            style={{
              fontFamily: 'inherit', fontSize: 15, letterSpacing: 'normal', color: 'var(--ink)',
              border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', background: 'var(--panel)',
            }}
          >
            {current?.shortcut ? formatAccelerator(current.shortcut) : 'Not set'}
          </kbd>
          <button className="btn btn-ghost" onClick={() => { setEditing(true); setSaveError(''); }}>Change</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="Control+Command+J"
            spellCheck={false}
            style={field}
          />
          <span style={{ fontSize: 13, color: 'var(--muted)', minWidth: 48 }}>{formatAccelerator(draft)}</span>
          <button className="btn btn-accent" onClick={save} disabled={saving || !draft.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button className="btn btn-ghost" onClick={() => { setEditing(false); setDraft(current?.shortcut || ''); }}>Cancel</button>
        </div>
      )}

      {editing && <p style={hint}>Write it the Electron way: Control, Command, Alt, Shift and a key, joined with +.</p>}
      {current?.error && <p style={{ ...hint, color: 'var(--accent)' }}>{current.error}</p>}
      {saveError && <p style={{ ...hint, color: 'var(--accent)' }}>{saveError}</p>}
    </div>
  );
};

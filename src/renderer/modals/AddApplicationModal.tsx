import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Link2, FileText, AlertCircle, Check, Loader } from 'lucide-react';
import { Dropdown } from '../components/Dropdown';
import { JOB_SOURCES, BatchAddProgress } from '../../shared/types';
import { splitAddItems, bareUrl } from '../../shared/add-input';

// "Not specified" first so the field is optional and resettable, then the
// shared list of job sites.
const SOURCE_OPTIONS = [
  { value: '', label: 'Not specified' },
  ...JOB_SOURCES.map((s) => ({ value: s, label: s })),
];

/** Remembered between sessions: does an add also kick off the letter. */
const AUTO_GENERATE_KEY = 'aplyd.autoGenerateOnAdd';

// The slice of the preload surface this modal uses, named here so the calls stay
// typed (the renderer is not part of the main tsconfig program).
type IpcResult<T = void> = Promise<{ ok: boolean; data?: T; error?: string }>;
interface AppsApi {
  addFromText(opts: { text: string; autoGenerate?: boolean; jobSource?: string | null }): IpcResult<{ applicationId: string }>;
  addBatch(items: string[], jobSource?: string | null): IpcResult;
  onBatchProgress(cb: (p: BatchAddProgress) => void): () => void;
}
interface AddApi {
  apps: AppsApi;
  quickAddApplication(company: string, jobTitle: string, jobSource: string | null): Promise<{ success: boolean; application?: { id: string }; error?: string }>;
  selectFile(): Promise<{ filePath: string; content: string; note?: string } | null>;
}
const api = (): AddApi => (window as unknown as { electronAPI: AddApi }).electronAPI;

interface AddApplicationModalProps {
  onClose: () => void;
  /** A single add succeeded: open that application. */
  onCreated: (applicationId: string) => void;
  /** Anything landed in the database: refresh the list behind the modal. */
  onChanged?: () => void;
}

type RowStatus = 'queued' | 'working' | 'done' | 'error';
interface BatchRow { label: string; status: RowStatus; detail?: string }

/** A short, honest name for a queued item before we know the company. */
function itemLabel(item: string): string {
  const url = bareUrl(item);
  if (url) {
    try {
      const u = new URL(url);
      return u.host.replace(/^www\./, '') + (u.pathname && u.pathname !== '/' ? u.pathname.slice(0, 40) : '');
    } catch { return url.slice(0, 60); }
  }
  const firstLine = item.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || item;
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
}

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, letterSpacing: 'normal', textTransform: 'none',
  color: 'var(--muted)', marginBottom: 6,
};
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8,
  border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer',
};
const accentBtn: React.CSSProperties = {
  ...btn, background: 'var(--accent,#f23a17)', color: '#fff', borderColor: 'var(--accent,#f23a17)',
};

export const AddApplicationModal: React.FC<AddApplicationModalProps> = ({ onClose, onCreated, onChanged }) => {
  // The paste box is the default: it is the way in for a real posting or a link.
  const [mode, setMode] = useState<'paste' | 'quick'>('paste');
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobSource, setJobSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [autoGenerate, setAutoGenerate] = useState<boolean>(() => localStorage.getItem(AUTO_GENERATE_KEY) === '1');
  // Detection is a guess about their paste, so the user can always overrule it.
  const [forceSingle, setForceSingle] = useState(false);
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // Set the moment the user closes: a reply that arrives afterwards must not yank them
  // to a detail page the user did not ask to be on.
  const closed = useRef(false);

  const items = useMemo(() => splitAddItems(text), [text]);
  const isBatch = !forceSingle && items.length >= 2;
  const batchRunning = !!rows && rows.some((r) => r.status === 'queued' || r.status === 'working');

  // Reset on mount as well as set on unmount: StrictMode mounts twice in dev, and
  // a flag left true there would swallow every "land on the new application".
  useEffect(() => {
    closed.current = false;
    return () => { closed.current = true; };
  }, []);

  // Esc closes, Cmd+Enter (or Ctrl+Enter) submits, from anywhere in the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (mode === 'paste') textRef.current?.focus(); }, [mode]);

  // Elapsed seconds while a single extraction runs, so it never looks frozen.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Batch news. Registered for the life of the modal: the run itself lives in the
  // main process, so these rows fill in even if the user went to make a coffee.
  useEffect(() => {
    const off = api().apps.onBatchProgress((p: BatchAddProgress) => {
      setRows((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        if (!next[p.index]) return prev;
        if (p.status === 'working') next[p.index] = { ...next[p.index], status: 'working' };
        if (p.status === 'done') next[p.index] = { label: p.company ? `${p.company}${p.role ? ' · ' + p.role : ''}` : next[p.index].label, status: 'done' };
        if (p.status === 'error') next[p.index] = { ...next[p.index], status: 'error', detail: p.error };
        return next;
      });
      // The list behind the modal watches the same event and refreshes itself,
      // so there is nothing to tell it from here.
    });
    return () => { try { off(); } catch { /* already gone */ } };
  }, []);

  const close = () => { closed.current = true; onClose(); };

  const toggleAutoGenerate = (on: boolean) => {
    setAutoGenerate(on);
    localStorage.setItem(AUTO_GENERATE_KEY, on ? '1' : '0');
  };

  const upload = async () => {
    try {
      setError(null);
      // selectFile() resolves to { filePath, content }: keep the text, not the
      // object (the object renders as [object Object] and breaks the trim below).
      const result = await api().selectFile();
      if (result && result.content) setText(result.content);
      else if (result && result.note) setError(result.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const addOne = async () => {
    const body = text.trim();
    if (!body) { setError('Paste the posting, or a link to it.'); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await api().apps.addFromText({ text: body, autoGenerate, jobSource: jobSource || null });
      if (!res.ok || !res.data) { setError(res.error || 'Could not add that one.'); return; }
      onChanged?.();
      if (!closed.current) onCreated(res.data.applicationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that one.');
    } finally {
      setBusy(false);
    }
  };

  const addMany = async () => {
    setError(null);
    setRows(items.map((it) => ({ label: itemLabel(it), status: 'queued' as RowStatus })));
    const res = await api().apps.addBatch(items, jobSource || null);
    if (!res.ok) { setError(res.error || 'Could not start that batch.'); setRows(null); }
  };

  const quickAdd = async () => {
    if (!company.trim() || !jobTitle.trim()) { setError('Company and role, both please.'); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await api().quickAddApplication(company.trim(), jobTitle.trim(), jobSource || null);
      if (!res.success || !res.application) { setError(res.error || 'Could not add that one.'); return; }
      onChanged?.();
      if (!closed.current) onCreated(res.application.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that one.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (busy) return;
    if (mode === 'quick') { quickAdd(); return; }
    if (batchRunning) return;
    if (isBatch) { addMany(); return; }
    addOne();
  };

  const submitLabel = mode === 'quick'
    ? (busy ? 'Adding…' : 'Add application')
    : isBatch
      ? `Add ${items.length} applications`
      : (busy ? `Reading the posting… ${elapsed}s` : 'Add application');

  const tab = (id: 'paste' | 'quick', text_: string) => (
    <button
      onClick={() => { setMode(id); setError(null); }}
      className={`navlink ${mode === id ? 'active' : ''}`}
      style={{
        flex: 1, textAlign: 'center', padding: '12px 16px', marginBottom: 0,
        borderBottom: mode === id ? '2px solid var(--accent)' : 'none',
      }}
    >
      {text_}
    </button>
  );

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="modal">
        <div className="modal-header">
          <h1 className="modal-title">Add application</h1>
          <button onClick={close} className="modal-close" style={{ padding: 0 }} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', padding: '0 24px' }}>
          {tab('paste', 'Paste posting or URL')}
          {tab('quick', 'Just company + role')}
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.5,
              padding: '10px 12px', borderRadius: 8, marginBottom: 16,
              border: '1px solid var(--accent,#f23a17)', background: 'rgba(242,58,23,.07)', color: 'var(--ink)',
            }}>
              <AlertCircle size={14} style={{ color: 'var(--accent,#f23a17)', flex: 'none', marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {mode === 'quick' ? (
            <form onSubmit={(e) => { e.preventDefault(); quickAdd(); }}>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Company</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Example Org"
                  autoFocus
                  style={{ width: '100%', padding: '8px 0', borderBottom: '1px solid var(--ink)', backgroundColor: 'transparent', fontSize: 14 }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={label}>Role</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g. Frontend Engineer"
                  style={{ width: '100%', padding: '8px 0', borderBottom: '1px solid var(--ink)', backgroundColor: 'transparent', fontSize: 14 }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={label}>
                  Job source <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--faint)' }}>· optional</span>
                </label>
                <Dropdown value={jobSource} options={SOURCE_OPTIONS} onChange={setJobSource} placeholder="Where did you find it?" />
              </div>

              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
                This logs the row now, with no posting attached. Paste the posting on its page when you have it: letters and the fit score need the real thing.
              </p>

              <div className="modal-footer">
                <button type="button" onClick={close} style={{ ...btn, flex: 1, marginRight: 8 }}>Cancel</button>
                <button type="submit" style={{ ...accentBtn, flex: 1 }} disabled={busy}>{submitLabel}</button>
              </div>
            </form>
          ) : (
            <div>
              <div style={{ marginBottom: 12 }}>
                <label style={label}>Posting or link</label>
                <textarea
                  ref={textRef}
                  value={text}
                  onChange={(e) => { setText(e.target.value); setForceSingle(false); }}
                  autoFocus
                  placeholder={'Paste the whole posting, or a link to it.\nSeveral links, one per line, add them all.'}
                  style={{
                    width: '100%', height: 220, padding: 12, borderRadius: 8,
                    backgroundColor: 'var(--panel)', border: '1px solid var(--line)',
                    fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, resize: 'vertical', color: 'var(--ink)',
                  }}
                />
              </div>

              {/* what we think this paste is, and the way out if we are wrong */}
              {items.length >= 2 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
                  <Link2 size={12} style={{ flex: 'none' }} />
                  <span>{forceSingle ? 'Adding as one posting.' : `${items.length} separate postings detected.`}</span>
                  <button
                    onClick={() => setForceSingle((v) => !v)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--accent,#f23a17)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '2px 4px', borderRadius: 6 }}
                  >
                    {forceSingle ? `Add as ${items.length} instead` : 'Add as one instead'}
                  </button>
                </div>
              )}

              {/* per-item progress, filled in from the main process as they land */}
              {rows && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                  {rows.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                      padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)',
                      opacity: r.status === 'queued' ? 0.55 : 1,
                    }}>
                      {r.status === 'done'
                        ? <Check size={13} style={{ color: '#1f9d55', flex: 'none' }} />
                        : r.status === 'error'
                          ? <AlertCircle size={13} style={{ color: 'var(--accent,#f23a17)', flex: 'none' }} />
                          : <Loader size={13} style={{ color: 'var(--muted)', flex: 'none', opacity: r.status === 'working' ? 1 : 0.5 }} />}
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                      <span style={{ fontSize: 11, color: r.status === 'error' ? 'var(--accent,#f23a17)' : 'var(--muted)', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.status === 'queued' ? 'waiting' : r.status === 'working' ? 'reading…' : r.status === 'done' ? 'added' : (r.detail || 'failed')}
                      </span>
                    </div>
                  ))}
                  {batchRunning && (
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                      Keeps going if you close this. Rows appear in your list as they land.
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <button type="button" onClick={upload} style={{ ...btn, fontSize: 11, letterSpacing: 'normal', textTransform: 'none', color: 'var(--muted)' }}>
                  <FileText size={12} /> Upload file
                </button>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <Dropdown value={jobSource} options={SOURCE_OPTIONS} onChange={setJobSource} placeholder="Job source (optional)" />
                </div>
              </div>

              <label
                title={isBatch ? 'Batches skip this: letters are drafted one at a time from the application page.' : 'Starts the letter as soon as the application lands, on its page.'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', cursor: isBatch ? 'default' : 'pointer', userSelect: 'none', marginBottom: 20 }}
              >
                <input
                  type="checkbox"
                  checked={autoGenerate && !isBatch}
                  disabled={isBatch}
                  onChange={(e) => toggleAutoGenerate(e.target.checked)}
                  style={{ margin: 0, accentColor: 'var(--accent,#f23a17)' }}
                />
                Generate letter on add{isBatch ? ' (single adds only)' : ''}
              </label>

              <div className="modal-footer">
                <button type="button" onClick={close} style={{ ...btn, flex: 1, marginRight: 8 }}>
                  {batchRunning ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  style={{ ...accentBtn, flex: 1 }}
                  disabled={busy || batchRunning || !text.trim()}
                >
                  {submitLabel}
                </button>
              </div>
              <p style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'right', margin: '8px 0 0' }}>Cmd + Enter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, FileText } from 'lucide-react';
import type { JobApplication } from '../../shared/types';
import { Markdown } from './Markdown';
import { usePrepTask } from '../hooks/usePrepStatus';
import { PREP_STAGES } from '../lib/stages';
import { displayLocale } from '../../shared/locale';

const sectionLabel: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  color: 'var(--accent)',
  margin: 0,
};

const prepApi = () => window.electronAPI?.prep;

interface PrepFile { path: string; name: string; kind: string; modifiedAt: string; linked: boolean }

/** Show the section at all: an interview-ish stage, or a sheet already written. */
export const showsInterviewPrep = (app: JobApplication): boolean =>
  PREP_STAGES.includes(app.current_stage) || !!(app.prep_notes && app.prep_notes.trim());

/**
 * The one-page prep sheet in applications.prep_notes: what the company does,
 * likely questions, matching stories. Written in the background when the
 * application reaches phone screen or interview; Regenerate rebuilds it. Edit
 * turns it into plain text for their own additions.
 */
export const InterviewPrep: React.FC<{
  application: JobApplication;
  onChanged: (changes: Partial<JobApplication>) => void;
  /** Reload the application from the database (after a background rebuild). */
  onReload: () => void;
}> = ({ application, onChanged, onReload }) => {
  const notes = application.prep_notes || '';
  const [open, setOpen] = useState(() => PREP_STAGES.includes(application.current_stage));
  // Prep sheets saved as files (community-data/interview-prep/<Company>, or linked by hand).
  const [files, setFiles] = useState<PrepFile[] | null>(null);
  useEffect(() => {
    let active = true;
    setFiles(null);
    prepApi()?.files?.(application.id).then((r: { ok: boolean; data?: PrepFile[] }) => {
      if (!active) return;
      const list = r.ok ? r.data ?? [] : [];
      setFiles(list);
      if (list.length) setOpen(true);
    }).catch(() => { if (active) setFiles([]); });
    return () => { active = false; };
  }, [application.id]);
  const openFile = async (f: PrepFile) => {
    const r = await prepApi()?.openFile?.(application.id, f.path);
    if (r && !r.ok) setError(r.error || 'Could not open that file.');
  };
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const live = usePrepTask(application.id, 'interview_prep');
  const running = asking || live?.state === 'running' || live?.state === 'queued';

  // A background rebuild (from email sync or a stage move) finished: pull it in.
  const lastState = useRef(live?.state);
  useEffect(() => {
    if (live?.state === 'done' && lastState.current !== 'done') onReload();
    if (live?.state === 'error' && lastState.current !== 'error') setError(live.message || 'Could not write the prep sheet.');
    lastState.current = live?.state;
  }, [live?.state]);

  const regenerate = async () => {
    const api = prepApi();
    if (!api || running) return;
    setAsking(true); setError(''); setOpen(true); setEditing(false);
    try {
      const res = await api.regenerateInterviewPrep(application.id);
      if (!res.ok) throw new Error(res.error || 'Could not write the prep sheet.');
      if (res.data) onChanged({ prep_notes: res.data.prep_notes ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  const saveEdit = async (value: string) => {
    setEditing(false);
    const next = value.trim() ? value : null;
    if (next === (application.prep_notes ?? null)) return;
    onChanged({ prep_notes: next });
    try {
      const res = await window.electronAPI.db.updateApplication(application.id, { prep_notes: next });
      if (!res.ok) setError(res.error || 'Not saved');
    } catch {
      setError('Not saved');
    }
  };

  if (!showsInterviewPrep(application) && !(files && files.length)) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 10 : 0 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)' }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <p style={sectionLabel}>Interview prep</p>
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {running && <span style={{ fontSize: 'var(--fs-2)', color: 'var(--muted)' }}>Writing the prep sheet...</span>}
          {open && notes && !running && !editing && (
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
          )}
          <button className="btn" onClick={regenerate} disabled={running}>
            <RotateCcw size={12} /> {notes ? 'Regenerate' : files && files.length ? 'Write a short version' : 'Write prep sheet'}
          </button>
        </div>
      </div>

      {open && (
        <div>
          {files && files.length > 0 && (
            <div className="prep-files">
              {files.map((f) => (
                <button key={f.path} type="button" className="prep-file" onClick={() => void openFile(f)} title={f.path}>
                  <FileText size={15} aria-hidden />
                  <span className="prep-file-name">{f.name}</span>
                  <span className="prep-file-meta">{f.kind}, {new Date(f.modifiedAt).toLocaleDateString(displayLocale(), { day: 'numeric', month: 'short' })}</span>
                  <span className="prep-file-open">Open</span>
                </button>
              ))}
            </div>
          )}
          {running && <div className="aplyd-bar" style={{ marginBottom: 10 }} />}
          {error && <p style={{ fontSize: 'var(--fs-2)', color: 'var(--accent)', margin: '0 0 10px' }}>{error}</p>}
          {editing ? (
            <textarea
              autoFocus
              defaultValue={notes}
              onBlur={(e) => saveEdit(e.currentTarget.value)}
              rows={14}
              style={{
                width: '100%', padding: 12, backgroundColor: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 8, fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit', lineHeight: 1.6,
                resize: 'vertical', outline: 'none',
              }}
            />
          ) : notes ? (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink)', border: '1px solid var(--line)', padding: '16px 18px' }}>
              <Markdown text={notes} />
            </div>
          ) : !running && files && files.length > 0 ? null : !running ? (
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
              No prep sheet yet. I can write one: what the company does, likely questions, and stories from your resumes that answer them.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

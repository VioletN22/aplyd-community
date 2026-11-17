import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { JobApplication, LockerDocument } from '../../shared/types';

const lockerApi = () => window.electronAPI?.autopilot;
const applicationsApi = () => window.electronAPI?.applications;

/** Locker files tagged resume; every file when none are tagged. */
const resumesOf = (docs: LockerDocument[]): LockerDocument[] => {
  const tagged = docs.filter((d) => d.tags.includes('resume'));
  return tagged.length ? tagged : docs;
};

/**
 * "Sent: <resume>" under the title, with a small menu to change it. The pick
 * feeds the "What's working" by-resume table.
 */
export const ResumeSent: React.FC<{
  application: JobApplication;
  onChanged: (app: Partial<JobApplication>) => void;
}> = ({ application, onChanged }) => {
  const [resumes, setResumes] = useState<LockerDocument[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = lockerApi();
    if (!api) return;
    api.getDocuments().then((d) => setResumes(resumesOf(d || []))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const current = application.resume_doc_id ?? null;
  const currentLabel = current ? (resumes.find((r) => r.id === current)?.label ?? 'A removed resume') : 'Not set';

  const pick = async (docId: string | null) => {
    setOpen(false);
    if (docId === current) return;
    const api = applicationsApi();
    if (!api) return;
    setSaving(true); setError('');
    onChanged({ resume_doc_id: docId });
    try {
      const res = await api.setResume(application.id, docId);
      if (!res.ok) throw new Error(res.error || 'Not saved');
    } catch (e) {
      onChanged({ resume_doc_id: current });
      setError(e instanceof Error ? e.message : 'Not saved');
    } finally {
      setSaving(false);
    }
  };

  const options: { id: string | null; label: string }[] = [
    ...resumes.map((r) => ({ id: r.id as string | null, label: r.label })),
    { id: null, label: 'Not set' },
  ];

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Which resume went with this application"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none',
          fontSize: 13, letterSpacing: 0, textTransform: 'none', color: 'var(--muted)', cursor: 'pointer',
        }}
      >
        <span>Sent:</span>
        <span style={{ color: current ? 'var(--ink)' : 'var(--muted)' }}>{currentLabel}</span>
        <ChevronDown size={12} style={{ opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {saving && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Saving...</span>}
      {error && <span style={{ fontSize: 11, color: 'var(--accent)' }}>{error}</span>}

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: 220, zIndex: 50,
            background: 'var(--bg)', border: '1px solid var(--ink)', boxShadow: '0 8px 24px rgba(17,17,16,0.18)',
          }}
        >
          {options.map((o) => (
            <button
              key={o.id ?? 'none'}
              type="button"
              onClick={() => pick(o.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)',
                fontSize: 13, letterSpacing: 0, textTransform: 'none', textAlign: 'left',
                color: o.id ? 'var(--ink)' : 'var(--muted)', fontWeight: o.id === current ? 600 : 400, cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--panel)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.id === current && <Check size={12} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

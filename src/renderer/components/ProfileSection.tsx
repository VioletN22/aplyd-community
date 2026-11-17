import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileText, Link2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { LockerDocument, PortfolioLink, VoiceNote } from '../../shared/types';
import { Dialog } from './Dialog';

// ── Profile: the material every letter and answer is built from ──────────────
// This section is the only place these four stores can be edited, so it stays deliberately plain: read what is there, change it, save on blur.

// The slice of the preload surface (src/main/preload.ts) this page calls, named
// here so the section stays typed without reaching for `any`.
interface ProfileApi {
  get(): Promise<Record<string, string>>;
  set(profile: Record<string, string>): Promise<{ ok: boolean }>;
  seed(): Promise<Record<string, string>>;
}
interface LockerApi {
  getDocuments(): Promise<LockerDocument[]>;
  pickDocument(): Promise<string | null>;
  // Refuses a path that was not chosen through the picker, so it answers the
  // { ok, data?, error? } envelope rather than throwing at the page.
  addDocument(label: string, filePath: string, tags: string[], isDefault: boolean): Promise<{ ok: boolean; data?: LockerDocument; error?: string }>;
  deleteDocument(id: string): Promise<{ ok: boolean }>;
  setDocumentDefault(id: string): Promise<{ ok: boolean }>;
  getVoiceNotes(): Promise<VoiceNote[]>;
  deleteVoiceNote(id: string): Promise<{ ok: boolean }>;
  getPortfolioLinks(): Promise<PortfolioLink[]>;
  addPortfolioLink(label: string, url: string): Promise<PortfolioLink>;
  deletePortfolioLink(id: string): Promise<{ ok: boolean }>;
}
interface ProfileWindow {
  electronAPI: { profile: ProfileApi; autopilot: LockerApi };
}
const profileApi = (): ProfileApi => (window as unknown as ProfileWindow).electronAPI.profile;
const lockerApi = (): LockerApi => (window as unknown as ProfileWindow).electronAPI.autopilot;

// Shown even when empty, because a blank row is the prompt to fill it in.
// Anything else already in the profile is appended after these.
const KNOWN_FIELDS = [
  'Full name',
  'Preferred name',
  'Email',
  'Phone',
  'Location',
  'Current title',
  'Portfolio',
  'LinkedIn',
  'GitHub',
  'Salary expectation',
  'Notice period',
  'Work authorization',
];

const VOICE_KIND_LABEL: Record<VoiceNote['kind'], string> = {
  like: 'keep',
  dislike: 'avoid',
  style: 'style',
};

const microLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--muted)',
  margin: 0,
};
const field: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontSize: 12.5,
  fontFamily: 'inherit',
};
const hintText: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--muted)',
  lineHeight: 1.5,
  margin: '8px 0 0',
};
const listBox: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' };
const listRow = (first: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderTop: first ? 'none' : '1px solid var(--line)',
});
const chip: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--muted)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '2px 6px',
  flex: 'none',
};
const errLine: React.CSSProperties = { fontSize: 11.5, color: 'var(--accent)', margin: '8px 0 0' };
const emptyLine: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', margin: 0 };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const baseName = (p: string): string => p.split(/[\\/]/).pop() || p;

type PendingDelete = { kind: 'document' | 'voice' | 'link'; id: string; name: string };

const SubHead: React.FC<{ label: string; right?: React.ReactNode }> = ({ label, right }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
    <p style={microLabel}>{label}</p>
    {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>}
  </div>
);

export const ProfileSection: React.FC = () => {
  // identity
  const [values, setValues] = useState<Record<string, string>>({});
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const savedRef = useRef<Record<string, string>>({});   // last persisted profile
  const [savedField, setSavedField] = useState('');
  const [profileError, setProfileError] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedNote, setSeedNote] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // locker, voice, portfolio
  const [documents, setDocuments] = useState<LockerDocument[]>([]);
  const [picking, setPicking] = useState(false);
  const [docError, setDocError] = useState('');
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [noteError, setNoteError] = useState('');
  const [links, setLinks] = useState<PortfolioLink[]>([]);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const applyProfile = (p: Record<string, string>) => {
    savedRef.current = p;
    setValues({ ...p });
    setExtraKeys(Object.keys(p).filter((k) => !KNOWN_FIELDS.includes(k)));
  };

  const loadProfile = useCallback(async () => {
    try {
      applyProfile(await profileApi().get());
      setProfileError('');
    } catch (e) {
      setProfileError('Could not load your profile: ' + errText(e));
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await lockerApi().getDocuments());
      setDocError('');
    } catch (e) {
      setDocError('Could not load your documents: ' + errText(e));
    }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      setNotes(await lockerApi().getVoiceNotes());
      setNoteError('');
    } catch (e) {
      setNoteError('Could not load your voice notes: ' + errText(e));
    }
  }, []);

  const loadLinks = useCallback(async () => {
    try {
      setLinks(await lockerApi().getPortfolioLinks());
      setLinkError('');
    } catch (e) {
      setLinkError('Could not load your links: ' + errText(e));
    }
  }, []);

  useEffect(() => {
    loadProfile();
    loadDocuments();
    loadNotes();
    loadLinks();
  }, [loadProfile, loadDocuments, loadNotes, loadLinks]);

  // One field at a time, written against the last persisted object rather than
  // React state, so a blur can never save a stale copy of the rest.
  const commitField = async (key: string, raw: string) => {
    const value = raw.trim();
    const current = savedRef.current;
    setValues((v) => ({ ...v, [key]: value }));
    if ((current[key] || '') === value) return;
    const next: Record<string, string> = { ...current };
    if (value) next[key] = value;
    else delete next[key];
    savedRef.current = next;
    try {
      await profileApi().set(next);
      setProfileError('');
      setSavedField(key);
      window.setTimeout(() => setSavedField((k) => (k === key ? '' : k)), 1600);
    } catch (e) {
      setProfileError('Could not save ' + key + ': ' + errText(e));
    }
  };

  const addField = async () => {
    const key = newKey.trim();
    if (!key) return;
    if (!KNOWN_FIELDS.includes(key) && !extraKeys.includes(key)) setExtraKeys((prev) => [...prev, key]);
    const value = newValue;
    setNewKey('');
    setNewValue('');
    await commitField(key, value);
  };

  // Reads the default resume and saved answers, fills only the blanks.
  const seedProfile = async () => {
    setSeeding(true);
    setSeedNote('');
    try {
      const merged = await profileApi().seed();
      if (Object.keys(merged).length > 0) {
        applyProfile(merged);
        setSeedNote('Filled the blank fields from your resume. Existing answers were left alone.');
      } else {
        setSeedNote('Nothing to fill from yet. Add a default resume below, then try again.');
      }
    } catch (e) {
      setSeedNote('Could not read your resume: ' + errText(e));
    } finally {
      setSeeding(false);
    }
  };

  const chooseFile = async () => {
    setPicking(true);
    setDocError('');
    try {
      const filePath = await lockerApi().pickDocument();
      if (!filePath) return;
      const label = baseName(filePath).replace(/\.[^.]+$/, '');
      const hasDefaultResume = documents.some((d) => d.isDefault && d.tags.includes('resume'));
      const added = await lockerApi().addDocument(label, filePath, ['resume'], !hasDefaultResume);
      if (!added.ok) { setDocError('Could not add that file: ' + (added.error || 'unknown error')); return; }
      await loadDocuments();
    } catch (e) {
      setDocError('Could not add that file: ' + errText(e));
    } finally {
      setPicking(false);
    }
  };

  const makeDefault = async (id: string) => {
    try {
      await lockerApi().setDocumentDefault(id);
      await loadDocuments();
    } catch (e) {
      setDocError('Could not set that default: ' + errText(e));
    }
  };

  const addLink = async () => {
    const label = linkLabel.trim();
    const url = linkUrl.trim();
    if (!label || !url) {
      setLinkError('A link needs both a label and a URL.');
      return;
    }
    try {
      await lockerApi().addPortfolioLink(label, url);
      setLinkLabel('');
      setLinkUrl('');
      setLinkError('');
      await loadLinks();
    } catch (e) {
      setLinkError('Could not add that link: ' + errText(e));
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      if (target.kind === 'document') {
        await lockerApi().deleteDocument(target.id);
        await loadDocuments();
      } else if (target.kind === 'voice') {
        await lockerApi().deleteVoiceNote(target.id);
        await loadNotes();
      } else {
        await lockerApi().deletePortfolioLink(target.id);
        await loadLinks();
      }
    } catch (e) {
      const message = 'Could not delete that: ' + errText(e);
      if (target.kind === 'document') setDocError(message);
      else if (target.kind === 'voice') setNoteError(message);
      else setLinkError(message);
    }
  };

  const deleteCopy: Record<PendingDelete['kind'], { title: string; message: (name: string) => string }> = {
    document: {
      title: 'Remove this document?',
      message: (name) => `"${name}" leaves the locker. The file itself stays where it is on disk.`,
    },
    voice: {
      title: 'Delete this rule?',
      message: (name) => `"${name}" stops steering how letters are written.`,
    },
    link: {
      title: 'Delete this link?',
      message: (name) => `"${name}" leaves your portfolio, so letters stop referencing it.`,
    },
  };

  const identityRow = (key: string) => {
    const id = 'profile-' + key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return (
    <div key={key} style={{ display: 'grid', gridTemplateColumns: '148px 1fr', gap: 10, alignItems: 'center' }}>
      <label htmlFor={id} style={{ ...microLabel, fontSize: 10 }}>
        {key}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          value={values[key] || ''}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
          onBlur={(e) => commitField(key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={{ ...field, paddingRight: savedField === key ? 30 : 10 }}
        />
        {savedField === key && (
          <Check
            size={13}
            style={{ position: 'absolute', right: 9, top: 9, color: 'var(--success)', pointerEvents: 'none' }}
          />
        )}
      </div>
    </div>
    );
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: '24px',
        marginBottom: '32px',
      }}
    >
      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', margin: '0 0 4px' }}>Profile</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 22px', maxWidth: '58ch' }}>
        What the letters and the assistant read about you. Nothing here is sent anywhere on its own.
      </p>

      {/* 1. Identity */}
      <div style={{ marginBottom: 26 }}>
        <SubHead
          label="Identity"
          right={
            <button onClick={seedProfile} disabled={seeding} className="btn btn-ghost">
              <Sparkles size={13} /> {seeding ? 'Reading resume…' : 'Fill from resume'}
            </button>
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {KNOWN_FIELDS.map(identityRow)}
          {extraKeys.map(identityRow)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '148px 1fr auto', gap: 10, marginTop: 12 }}>
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Field name"
            style={{ ...field, fontSize: 12 }}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addField();
            }}
            placeholder="Answer"
            style={field}
          />
          <button onClick={addField} disabled={!newKey.trim()} className="btn">
            <Plus size={13} /> Add field
          </button>
        </div>

        <p style={hintText}>Name, email and phone appear in every letter sign-off.</p>
        {seedNote && <p style={{ ...hintText, color: 'var(--ink)' }}>{seedNote}</p>}
        {profileError && <p style={errLine}>{profileError}</p>}
      </div>

      {/* 2. Resume document */}
      <div style={{ marginBottom: 26 }}>
        <SubHead
          label="Resume document"
          right={
            <button onClick={chooseFile} disabled={picking} className="btn">
              <FileText size={13} /> {picking ? 'Choosing…' : 'Choose file'}
            </button>
          }
        />
        {documents.length === 0 ? (
          <p style={emptyLine}>No document yet. Choose a file to set your default resume.</p>
        ) : (
          <div style={listBox}>
            {documents.map((doc, i) => {
              const isDefaultResume = doc.isDefault && doc.tags.includes('resume');
              return (
                <div key={doc.id} style={listRow(i === 0)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{doc.label}</div>
                    <div
                      title={doc.filePath}
                      style={{
                        fontSize: 11,
                        color: 'var(--faint)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {baseName(doc.filePath)}
                    </div>
                  </div>
                  {doc.isDefault ? (
                    <span style={{ ...chip, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                      {isDefaultResume ? 'default resume' : 'default'}
                    </span>
                  ) : (
                    <button onClick={() => makeDefault(doc.id)} className="btn btn-ghost" style={{ flex: 'none' }}>
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => setPendingDelete({ kind: 'document', id: doc.id, name: doc.label })}
                    title="Remove from the locker"
                    className="btn btn-ghost"
                    style={{ flex: 'none' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p style={hintText}>Every resume grounds letters, the assistant and the fit score; the default is the fallback.</p>
        {docError && <p style={errLine}>{docError}</p>}
      </div>

      {/* 3. Voice notes */}
      <div style={{ marginBottom: 26 }}>
        <SubHead label="Voice notes" right={<span style={{ fontSize: 11, color: 'var(--faint)' }}>{notes.length}</span>} />
        {notes.length === 0 ? (
          <p style={emptyLine}>No rules yet.</p>
        ) : (
          <div style={listBox}>
            {notes.map((note, i) => (
              <div key={note.id} style={{ ...listRow(i === 0), alignItems: 'flex-start' }}>
                <span style={{ ...chip, marginTop: 2 }}>{VOICE_KIND_LABEL[note.kind]}</span>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>
                  {note.note}
                </div>
                <button
                  onClick={() => setPendingDelete({ kind: 'voice', id: note.id, name: note.note.slice(0, 60) })}
                  title="Delete this rule"
                  className="btn btn-ghost"
                  style={{ flex: 'none' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p style={hintText}>
          Distilled into the writing style profile that steers letters. Add rules from the letter refine box with
          Remember ticked.
        </p>
        {noteError && <p style={errLine}>{noteError}</p>}
      </div>

      {/* 4. Portfolio links */}
      <div>
        <SubHead label="Portfolio links" />
        {links.length === 0 ? (
          <p style={emptyLine}>No links yet.</p>
        ) : (
          <div style={listBox}>
            {links.map((link, i) => (
              <div key={link.id} style={listRow(i === 0)}>
                <Link2 size={13} style={{ color: 'var(--muted)', flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{link.label}</div>
                  <div
                    title={link.url}
                    style={{
                      fontSize: 11,
                      color: 'var(--faint)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {link.url}
                  </div>
                </div>
                <button
                  onClick={() => setPendingDelete({ kind: 'link', id: link.id, name: link.label })}
                  title="Delete this link"
                  className="btn btn-ghost"
                  style={{ flex: 'none' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '148px 1fr auto', gap: 10, marginTop: 12 }}>
          <input
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Label"
            style={{ ...field, fontSize: 12 }}
          />
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addLink();
            }}
            placeholder="https://"
            style={field}
          />
          <button onClick={addLink} disabled={!linkLabel.trim() || !linkUrl.trim()} className="btn">
            <Plus size={13} /> Add link
          </button>
        </div>
        <p style={hintText}>Letters can reference these, so keep them to work you want read.</p>
        {linkError && <p style={errLine}>{linkError}</p>}
      </div>

      <Dialog
        isOpen={pendingDelete !== null}
        title={pendingDelete ? deleteCopy[pendingDelete.kind].title : ''}
        message={pendingDelete ? deleteCopy[pendingDelete.kind].message(pendingDelete.name) : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        confirmText="Delete"
        cancelText="Keep"
        isDangerous
      />
    </div>
  );
};

import {ApprovalHistory} from '../components/ApprovalHistory';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, MapPin, DollarSign, Calendar, ChevronDown, ChevronRight, FileText, Sparkles, Copy, Check, RotateCcw, Send, Save, FolderOpen, Trash2, Download, X } from 'lucide-react';
import { JobApplication, StageHistory, jobSourceOptions, PLACEHOLDER_DESCRIPTION_PREFIX, ASSESSMENT_TODO_STAGES } from '../../shared/types';
import { Dropdown } from '../components/Dropdown';
import { StatusBadge } from '../components/StatusBadge';
import { AssistantSection } from '../components/AssistantSection';
import { ApplicationEmails } from '../components/ApplicationEmails';
import { ResumeSent } from '../components/ResumeSent';
import { InterviewPrep, showsInterviewPrep } from '../components/InterviewPrep';
import { stageLabel, stageOptions } from '../lib/stages';
import { locationCities, isRegionalAu, genericLocationLabel } from '../../shared/location';

/** The location pills: the metros it names, else Regional, else a generic city label. */
const locationPills = (location: string | null | undefined): string[] => {
  const cities = locationCities(location);
  if (cities.length > 0) return cities;
  if (isRegionalAu(location)) return ['Regional'];
  const generic = genericLocationLabel(location);
  return generic ? [generic] : [];
};
import { Pie, stagePie, stageColor } from '../components/Pie';
import { displayLocale } from '../../shared/locale';

// "Not specified" first so the source is clearable, then the shared list.
const sourceOptions = (current: string | null) => [
  { value: '', label: 'Not specified' },
  ...jobSourceOptions(current).map((s) => ({ value: s, label: s })),
];

// The fit half of the preload surface (src/main/preload.ts), named here so the
// rescore call stays typed even though another renderer module declares
// window.electronAPI as any.
type IpcResult<T = void> = Promise<{ ok: boolean; data?: T; error?: string }>;
interface FitApi {
  recompute(applicationId: string): IpcResult<{ score: number; reason: string }>;
}
const fitApi = (): FitApi => window.electronAPI.fit;

// Attaching the posting to a row that was quick-added (company + role only).
interface AppsApi {
  setRawText(applicationId: string, text: string): IpcResult;
}
const appsApi = (): AppsApi => (window as unknown as { electronAPI: { apps: AppsApi } }).electronAPI.apps;

/**
 * A row with no posting behind it: quick-added, still carrying the placeholder
 * description. Nothing may be generated from one of these, because there is
 * nothing to generate from.
 */
function needsPosting(application: JobApplication): boolean {
  const raw = String(application.raw_job_text || '').trim();
  const description = String(application.job_description || '').trim();
  return !raw && description.startsWith(PLACEHOLDER_DESCRIPTION_PREFIX);
}

/**
 * What `<input type="datetime-local">` wants: `YYYY-MM-DDTHH:mm`, local, no zone.
 * Stored values are already in that shape (we write the picker's own value back),
 * so this only has real work to do for anything that arrived as a full ISO stamp.
 */
function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface DetailPageProps {
  applicationId: string | null;
  onBack: () => void;
  /** Where Back goes, in words ("Back to Dashboard"). Defaults to plain "Back". */
  backLabel?: string;
  /** Scroll to this part once the page has loaded (Today's "Drafts ready"). */
  focus?: 'letter';
}

// The forward path through STAGES; rejected and withdrawn are exits, not steps.
const PIPELINE: string[] = ['applied', 'phone_screen', 'interview', 'offer'];

const sectionLabel: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  color: 'var(--accent)',
  paddingBottom: '6px',
  borderBottom: '1px solid var(--line)',
  marginBottom: '12px',
};

export const DetailPage: React.FC<DetailPageProps> = ({ applicationId, onBack, backLabel = 'Back', focus }) => {
  const [application, setApplication] = useState<JobApplication | null>(null);
  const [stageHistory, setStageHistory] = useState<StageHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [rescoring, setRescoring] = useState(false);

  // Which application the page has actually finished loading once. A reload of
  // the SAME application (after a stage move, after attaching a posting) must
  // not flip `loading`: that unmounts the letter and assistant sections and throws
  // away an in-progress draft or an unsaved edit.
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    if (applicationId) loadData();
  }, [applicationId]);

  useEffect(() => window.electronAPI.cockpit.onChanged(() => { void loadData(); }), [applicationId]);

  const loadData = async () => {
    if (!applicationId) return;
    if (loadedId.current !== applicationId) setLoading(true);
    setError(null);
    try {
      const appRes = await window.electronAPI.db.getApplication(applicationId);
      const app = appRes.ok ? appRes.data : null;
      if (!app) {
        setError(appRes.ok ? 'Application not found' : (appRes.error || 'Failed to load application'));
        setLoading(false);
        return;
      }
      setApplication(app);

      // Pre-select the natural next stage: applied, phone screen, interview, offer.
      const idx = PIPELINE.indexOf(app.current_stage);
      setSelectedStage(idx >= 0 && idx < PIPELINE.length - 1 ? PIPELINE[idx + 1] : '');

      const historyRes = await window.electronAPI.db.getStageHistory(applicationId);
      setStageHistory(historyRes.ok ? (historyRes.data || []) : []);
      loadedId.current = applicationId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application');
    } finally {
      setLoading(false);
    }
  };

  // One move, wherever it was asked for: the header badge (one click) and the
  // sidebar control (pick, then confirm) both end up here.
  const moveToStage = async (stage: string) => {
    if (!applicationId || !stage || stage === application?.current_stage) return;
    setIsTransitioning(true);
    try {
      const moved = await window.electronAPI.db.createStageHistory(applicationId, stage);
      if (!moved.ok) throw new Error(moved.error || 'Failed to move stage');
      const saved = await window.electronAPI.db.updateApplication(applicationId, { current_stage: stage });
      if (!saved.ok) throw new Error(saved.error || 'Failed to move stage');
      setSelectedStage('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move stage');
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleStageMove = () => moveToStage(selectedStage);

  // Arrived from "Drafts ready": bring the letter into view once it is on screen.
  useEffect(() => {
    if (loading || focus !== 'letter') return;
    const t = window.setTimeout(() => {
      document.getElementById('cover-letter')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [loading, focus, applicationId]);

  const patchApplication = (changes: Partial<JobApplication>) =>
    setApplication((cur) => (cur ? { ...cur, ...changes } : cur));

  // interview_at is stored exactly as the picker hands it over (`YYYY-MM-DDTHH:mm`,
  // local, no timezone), so it round-trips into the input without drifting an hour.
  const handleInterviewChange = async (value: string) => {
    if (!applicationId || !application) return;
    const next = value || null;
    if (next === (application.interview_at ?? null)) return;
    setApplication({ ...application, interview_at: next });
    try {
      const res = await window.electronAPI.db.updateApplication(applicationId, { interview_at: next });
      if (!res.ok) console.warn('[detail] interview date not saved:', res.error);
    } catch {
      /* non-fatal: the next load shows the stored truth */
    }
  };

  const handleNotesBlur = async (newNotes: string) => {
    if (!applicationId || !application || newNotes === application.notes) return;
    try {
      const res = await window.electronAPI.db.updateApplication(applicationId, { notes: newNotes });
      if (!res.ok) { console.warn('[detail] notes not saved:', res.error); return; }
      setApplication({ ...application, notes: newNotes });
    } catch {
      /* non-fatal */
    }
  };

  const handleLocationBlur = async (field: 'location' | 'workplace_address', value: string) => {
    if (!applicationId || !application) return;
    const next = value.trim();
    if (next === (application[field] ?? '')) return;
    try {
      const res = await window.electronAPI.db.updateApplication(applicationId, { [field]: field === 'location' ? next : (next || null) });
      if (!res.ok) throw new Error(res.error || 'Could not save location');
      setApplication(res.data || { ...application, [field]: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save location');
    }
  };

  const handleSourceChange = async (newSource: string) => {
    if (!applicationId || !application) return;
    const value = newSource || null;
    if (value === application.job_source) return;
    // Optimistic: the dropdown reflects the choice immediately.
    setApplication({ ...application, job_source: value });
    try {
      const res = await window.electronAPI.db.updateApplication(applicationId, { job_source: value });
      if (!res.ok) console.warn('[detail] source not saved:', res.error);
    } catch {
      /* non-fatal: revert handled on next load */
    }
  };

  // Fit is scored once at ingest. This rescores on demand, which is what the user
  // wants after a resume variant has changed since the row was added.
  const recomputeFit = async () => {
    if (!applicationId || rescoring) return;
    setRescoring(true);
    try {
      const res = await fitApi().recompute(applicationId);
      if (res.ok) {
        const appRes = await window.electronAPI.db.getApplication(applicationId);
        if (appRes.ok && appRes.data) setApplication(appRes.data);
      }
    } catch {
      /* non-fatal: the old score stays on screen */
    } finally {
      setRescoring(false);
    }
  };

  const formatDate = (d: string | null): string => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString(displayLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return d;
    }
  };

  const formatSalary = (min: number | null, max: number | null): string | null => {
    if (!min && !max) return null;
    const f = (n: number) => `$${Math.round(n / 1000)}k`;
    if (min && max) return `${f(min)} to ${f(max)}`;
    return f((min || max)!);
  };

  if (loading) {
    return (
      <div style={{ padding: '32px' }}>
        <p style={{ fontSize: '13px', color: 'var(--muted)' }}>Loading…</p>
      </div>
    );
  }

  if (error || !application) {
    return (
      <div style={{ padding: '32px' }}>
        <button onClick={onBack} className="navlink" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <ArrowLeft size={14} /> {backLabel === 'Back' ? 'Back to Applications' : backLabel}
        </button>
        <p style={{ fontSize: '13px', color: 'var(--accent)' }}>{error || 'Application not found'}</p>
      </div>
    );
  }

  const nextStages = stageOptions(application.current_stage).filter((st) => st !== application.current_stage);
  const assessmentToDo = ASSESSMENT_TODO_STAGES.includes(application.current_stage);
  // The header badge lists every stage, current one included (even a legacy
  // value) so it can show where it is now. Same component the list rows use.
  const allStages = stageOptions(application.current_stage);
  const salary = formatSalary(application.salary_min, application.salary_max);
  const bullets = (text: string) =>
    text
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);

  const FUNNEL = ['applied', 'assessment', 'assessed', 'phone_screen', 'interview', 'offer'];
  const funnelIndex = FUNNEL.indexOf(application.current_stage);
  const legacyStage = !FUNNEL.includes(application.current_stage) && !['rejected', 'withdrawn'].includes(application.current_stage);

  return (
    <div className="page wide detail-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={14} /> {backLabel}</button>

      {/* Header: the project, where it is in the funnel, and the facts that matter */}
      <div className="proj-head">
        <Pie value={stagePie(application.current_stage)} color={stageColor(application.current_stage)} size={28} />
        <div style={{ minWidth: 0 }}>
          <h1>{application.job_title}</h1>
          <p className="proj-sub">
            {application.company}{application.location ? `, ${application.location}` : ''}.
            {application.job_source ? ` Found on ${application.job_source}.` : ''}
          </p>
        </div>
      </div>

      <div className="stagebar" role="group" aria-label="Move to stage">
        {FUNNEL.map((st, i) => (
          <button
            key={st}
            type="button"
            className={`sb ${st === application.current_stage ? 'on' : funnelIndex > i ? 'past' : ''}`}
            aria-pressed={st === application.current_stage}
            disabled={isTransitioning}
            onClick={() => st !== application.current_stage && moveToStage(st)}
            title={st === 'assessed' && assessmentToDo ? 'Mark the assessment done' : `Move to ${stageLabel(st)}`}
          >
            {stageLabel(st)}
          </button>
        ))}
        <span className="sb-gap" />
        {(['rejected', 'withdrawn'] as const).map((st) => (
          <button
            key={st}
            type="button"
            className={`sb closer ${st === application.current_stage ? 'on' : ''}`}
            aria-pressed={st === application.current_stage}
            disabled={isTransitioning}
            onClick={() => st !== application.current_stage && moveToStage(st)}
          >
            {stageLabel(st)}
          </button>
        ))}
        {legacyStage && <StatusBadge value={application.current_stage} options={allStages} onChange={moveToStage} dense />}
        {isTransitioning && <span className="proj-soft">Moving…</span>}
      </div>

      <div className="proj-meta">
        {application.fit_score != null && <span className="pill you" title={application.fit_reason ?? undefined}>Fit {application.fit_score} of 10</span>}
        <button className="btn btn-quiet proj-rescore" onClick={recomputeFit} disabled={rescoring} title="Rescore this posting against your best-fit resume">
          {rescoring ? 'Rescoring…' : application.fit_score != null ? 'Rescore' : 'Score the fit'}
        </button>
        {salary && <span className="pill">{salary}</span>}
        {application.application_deadline && <span className="flag">Due {formatDate(application.application_deadline)}</span>}
        {locationPills(application.location).map((place) => <span key={place} className="pill">{place}</span>)}
        {application.workplace_address && <span className="proj-soft" title="Full workplace address"><MapPin size={13} /> {application.workplace_address}</span>}
        <span className="proj-resume"><ResumeSent application={application} onChanged={patchApplication} /></span>
      </div>

      {application.fit_reason && (
        <div className="proj-notes"><b>Why it fits.</b> {application.fit_reason}</div>
      )}

      {/* Two-column layout */}
      <div className="detail-grid">
        {/* Left: content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', minWidth: 0 }}>
          {/* Interview prep sheet: at the top once there is an interview to prepare for */}
          <ApprovalHistory applicationId={application.id}/>
          {/* Shows itself only for an interview stage, a written sheet, or saved prep files. */}
          {(
            <InterviewPrep application={application} onChanged={patchApplication} onReload={loadData} />
          )}

          {/* About (clean summary) */}
          <div>
            <p style={sectionLabel}>About the role</p>
            <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--ink)' }}>
              {application.job_description.startsWith(PLACEHOLDER_DESCRIPTION_PREFIX)
                ? 'Add the posting when you have it. Connect AI in Settings to extract the details.'
                : application.job_description.length > 600 && !showDescription
                ? application.job_description.slice(0, 600) + '…'
                : application.job_description}
            </p>
            {application.job_description.length > 600 && (
              <button
                onClick={() => setShowDescription(!showDescription)}
                style={{
                  marginTop: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  letterSpacing: 'normal',
                  textTransform: 'none',
                  color: 'var(--muted)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {showDescription ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {showDescription ? 'Show less' : 'Show full description'}
              </button>
            )}
          </div>

          {/* Skills, compact two-column */}
          {(application.required_skills || application.key_responsibilities) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: application.required_skills && application.key_responsibilities ? '1fr 1fr' : '1fr',
                border: '1px solid var(--line)',
              }}
            >
              {[
                { label: 'Required skills', text: application.required_skills },
                { label: 'Responsibilities', text: application.key_responsibilities },
              ]
                .filter((col) => col.text)
                .map((col, colIdx) => (
                  <div
                    key={col.label}
                    style={{
                      padding: '20px',
                      borderLeft: colIdx === 1 ? '1px solid var(--line)' : 'none',
                    }}
                  >
                    <p style={sectionLabel}>{col.label}</p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {bullets(col.text).slice(0, 6).map((s, i) => (
                        <li
                          key={i}
                          style={{
                            position: 'relative',
                            paddingLeft: '18px',
                            marginBottom: '10px',
                            fontSize: '13px',
                            lineHeight: 1.55,
                            color: 'var(--ink)',
                          }}
                        >
                          <span
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              color: 'var(--accent)',
                              fontWeight: 600,
                            }}
                          >
                            •
                          </span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}

          {/* The assistant sits above the letter: it is what the user reaches for while
              a form is open, so it must be readable without scrolling past a draft. */}
          <AssistantSection application={application} />

          {/* Cover letter: full context + live company research, refine + copy */}
          <div id="cover-letter" style={{ scrollMarginTop: 16 }}>
            <CoverLetterSection application={application} onUpdated={loadData} />
          </div>
        </div>

        {/* Right: sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {/* History */}
          <div>
            <p style={sectionLabel}>History</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {stageHistory.length === 0 && (
                <p style={{ fontSize: '13px', color: 'var(--muted)' }}>No history yet.</p>
              )}
              {stageHistory.map((entry) => (
                <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{stageLabel(entry.stage)}</span>
                  <span style={{ color: 'var(--muted)' }}>{formatDate(entry.entered_at)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Emails linked to this application (hidden when there are none) */}
          <ApplicationEmails applicationId={application.id} />

          {/* Interview */}
          <div>
            <p style={sectionLabel}>Interview</p>
            <input
              type="datetime-local"
              value={toDateTimeLocal(application.interview_at)}
              onChange={(e) => handleInterviewChange(e.currentTarget.value)}
              style={{
                width: '100%',
                padding: '9px 10px',
                backgroundColor: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                fontSize: '13px',
                color: 'var(--ink)',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <label style={{display:'block',fontSize:12,marginTop:8}}>Duration (minutes)
              <input type="number" min="5" max="480" step="5" defaultValue={application.interview_minutes??30}
                key={`duration-${application.id}-${application.interview_minutes}`}
                onBlur={async e=>{const minutes=Number(e.currentTarget.value);if(!Number.isFinite(minutes)||minutes<5||minutes>480){setError('Choose a duration from 5 to 480 minutes.');return;}const res=await window.electronAPI.db.updateApplication(application.id,{interview_minutes:minutes});if(res.ok&&res.data)setApplication(res.data);else setError(res.error||'Could not save duration.');}}
                style={{width:76,marginLeft:8,padding:5,border:'1px solid var(--line)',borderRadius:4}}/>
            </label>
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '6px' }}>
              Set this and the row shows the date on the list.
            </p>
          </div>

          {/* Location and optional street address */}
          <div>
            <p style={sectionLabel}>Workplace location</p>
            <input
              key={`location-${application.id}`}
              type="text"
              defaultValue={application.location}
              onBlur={(e) => handleLocationBlur('location', e.currentTarget.value)}
              placeholder="City or suburb from the posting"
              aria-label="Workplace location"
              style={{ width: '100%', padding: '9px 10px', backgroundColor: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', fontSize: '13px', color: 'var(--ink)', fontFamily: 'inherit' }}
            />
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '12px 0 6px' }}>Full workplace address, if known</p>
            <input
              key={`address-${application.id}`}
              type="text"
              defaultValue={application.workplace_address || ''}
              onBlur={(e) => handleLocationBlur('workplace_address', e.currentTarget.value)}
              placeholder="Street address from the posting"
              aria-label="Full workplace address"
              style={{ width: '100%', padding: '9px 10px', backgroundColor: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', fontSize: '13px', color: 'var(--ink)', fontFamily: 'inherit' }}
            />
          </div>

          {/* Source */}
          <div>
            <p style={sectionLabel}>Source</p>
            <Dropdown
              value={application.job_source || ''}
              options={sourceOptions(application.job_source)}
              onChange={handleSourceChange}
              placeholder="Where did you find it?"
            />
          </div>

          {/* Notes */}
          <div>
            <p style={sectionLabel}>Notes</p>
            <textarea
              defaultValue={application.notes || ''}
              onBlur={(e) => handleNotesBlur(e.currentTarget.value)}
              placeholder="Your notes…"
              rows={5}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'var(--panel)',
                border: '1px solid var(--line)',
                fontSize: '13px',
                color: 'var(--ink)',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Cover letter, in the application's own page ──────────────────────────────
// Generate uses EVERYTHING aplyd knows about you (resume / portfolio / facts /
// learned voice) + LIVE research on the company (their site, values, this year's
// direction) + this job posting, matched to your resume. Refine it with plain
// feedback in real time; copy the whole thing with one button. Saved per app.
const cl = () => window.electronAPI.coverLetter;

// Provider and model are configured together in Settings.
const ModelChips: React.FC = () => {
  const [label, setLabel] = useState('AI: configure in Settings');
  useEffect(() => {
    window.electronAPI.ai.status().then(result => {
      if (result.data) setLabel(result.data.provider === 'none' ? 'AI off · Settings to connect' : `${result.data.provider} · ${result.data.model || 'default model'} · edit in Settings`);
    }).catch(() => {});
  }, []);
  return <span style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</span>;
};

const CoverLetterSection: React.FC<{ application: JobApplication; onUpdated?: () => void }> = ({ application, onUpdated }) => {
  const role = application.job_title;
  const company = application.company;
  const jobText = [application.job_description, application.key_responsibilities, application.required_skills]
    .filter(Boolean).join('\n\n');
  // No posting means no letter: there is nothing to write from but a placeholder.
  const postingMissing = needsPosting(application);

  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'' | 'generating' | 'refining' | 'saving' | 'posting'>('');
  const [posting, setPosting] = useState('');
  const [postingError, setPostingError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');        // status line (researching / writing…)
  const [aiNote, setAiNote] = useState('');     // the assistant's message TO you (questions etc.)
  const [sources, setSources] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // The draft's own state machine. `note` used to carry progress AND failure,
  // which meant a timeout looked like a status line and quietly scrolled away.
  // Now a failure is a state, with the reason the main process actually gave.
  const [genStatus, setGenStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [genError, setGenError] = useState('');
  const [genErrorAfter, setGenErrorAfter] = useState(0);   // seconds spent before it failed
  const [streaming, setStreaming] = useState(false);
  // Off by default: feedback is a one-off edit unless the user says otherwise. Ticking
  // this turns it into a rule every future letter has to follow.
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    cl().getForApp(application.id).then((d: any) => { if (d && d.body) { setBody(d.body); setOpen(true); } }).catch(() => {});
  }, [application.id]);

  // elapsed-seconds ticker while working, so it never looks frozen. startedAt is
  // the same clock the error block quotes ("gave up after 41s").
  const working = busy !== '';
  const startedAt = useRef(0);
  const secondsSoFar = () => (startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0);
  useEffect(() => {
    if (!working) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [working]);

  // live staged status from the main process (research → writing → done).
  // A draft can also start WITHOUT this page asking for it ("generate letter on
  // add" fires as the application is created), so when the news is about a run
  // this page did not start, the section follows along: it shows the working
  // state, then loads the finished letter instead of waiting for a reload.
  const startedHere = useRef(false);
  // The draft is written straight into the textarea as it arrives, so the first
  // chunk of a run clears whatever was there. Tracked on a ref because the
  // deltas land far faster than a re-render.
  const streamOpen = useRef(false);
  useEffect(() => {
    const off = cl().onProgress((p: any) => {
      if (p.applicationId !== application.id) return;
      if (p.stage === 'stream') {
        const delta = String(p.delta || '');
        if (!delta) return;
        if (!streamOpen.current) {
          streamOpen.current = true;
          setStreaming(true);
          setOpen(true);
          setBody('');
          setGenStatus('working');
          if (!startedHere.current) setBusy((b) => (b ? b : 'generating'));
        }
        setBody((b) => b + delta);
        return;
      }
      if (p.stage === 'done') {
        streamOpen.current = false;
        setStreaming(false);
        if (startedHere.current) return;
        setBusy('');
        setGenStatus('idle');
        cl().getForApp(application.id)
          .then((d: any) => { if (d && d.body) { setBody(d.body); setOpen(true); setNote('Drafted when this application landed. Refine it, or copy it.'); } })
          .catch(() => {});
        return;
      }
      if (p.stage === 'error') {
        streamOpen.current = false;
        setStreaming(false);
        if (startedHere.current) return;
        setBusy('');
        setNote('');
        setGenError(p.message || 'The draft did not finish.');
        setGenErrorAfter(secondsSoFar());
        setGenStatus('error');
        setOpen(true);
        return;
      }
      if (!p.message) return;
      setNote(p.message);
      if (!startedHere.current) { setOpen(true); setBusy((b) => (b ? b : 'generating')); setGenStatus('working'); }
    });
    return () => { try { off && off(); } catch { /* ignore */ } };
  }, [application.id]);

  const save = (text: string) => { cl().saveForApp({ applicationId: application.id, company, role, jobUrl: application.job_url, body: text }).catch(() => {}); };

  // Whatever the main process said, said back to them word for word: a timeout and
  // a real failure read differently and the user needs to know which one they got.
  const failedAction = useRef<'generate' | 'refine'>('generate');
  const fail = (reason: string, action: 'generate' | 'refine') => {
    failedAction.current = action;
    setNote('');
    setGenError(reason);
    setGenErrorAfter(secondsSoFar());
    setGenStatus('error');
  };

  const generate = async () => {
    startedHere.current = true;
    streamOpen.current = false;
    setBusy('generating'); setGenStatus('working'); setGenError(''); setOpen(true); setSources([]); setAiNote('');
    setNote('Starting, researching ' + company + ' and cross-checking against this listing…');
    try {
      const res = await cl().generate({ applicationId: application.id, company, role, jobText, jobUrl: application.job_url, location: application.location });
      if (res.error) { fail(res.error, 'generate'); return; }
      setBody(res.body || '');
      setSources(res.sources || []);
      setAiNote(res.note || '');
      setGenStatus('idle');
      setNote(res.researched
        ? 'Drafted using the sources below (it ignores anything that doesn’t match this listing). Check they’re the right company, then refine or copy.'
        : 'Drafted from your profile + the posting (couldn’t fetch company research this time, so no company-specific claims were invented).');
    } catch (e: any) { fail('Could not generate: ' + String(e?.message || e), 'generate'); }
    finally { setBusy(''); startedHere.current = false; streamOpen.current = false; setStreaming(false); }
  };

  const refine = async () => {
    if (!feedback.trim() || working) return;
    setBusy('refining'); setGenStatus('working'); setGenError(''); setAiNote(''); setNote('Applying your feedback…');
    try {
      const res = await cl().refine({ applicationId: application.id, company, role, body, feedback: feedback.trim(), remember, jobUrl: application.job_url });
      if (res.error) { fail(res.error, 'refine'); return; }
      setBody(res.body || body); setFeedback(''); setAiNote(res.note || '');
      setGenStatus('idle');
      setNote(remember ? 'Updated, and saved as a style rule for future letters.' : 'Updated. Keep refining, or copy it.');
      setRemember(false);
    } catch (e: any) { fail('Could not refine: ' + String(e?.message || e), 'refine'); }
    finally { setBusy(''); }
  };

  // What the error block offers: the same action that just failed.
  const retry = () => { if (failedAction.current === 'refine' && feedback.trim()) refine(); else generate(); };

  const copy = async () => { try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ } };

  // Attach the posting to a quick-added row: saves the raw text (which is what
  // letters are written from) and fills the summary fields on the same row.
  const addPosting = async () => {
    const text = posting.trim();
    if (!text) { setPostingError('Paste the posting text first.'); return; }
    setBusy('posting'); setPostingError('');
    try {
      const res = await appsApi().setRawText(application.id, text);
      if (!res.ok) { setPostingError(res.error || 'Could not save that posting.'); return; }
      setPosting('');
      onUpdated?.();
    } catch (e: any) {
      setPostingError('Could not save that posting: ' + String(e?.message || e));
    } finally { setBusy(''); }
  };

  // saved versions + PDF folder
  const [versions, setVersions] = useState<any[]>([]);
  const [dir, setDir] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const loadVersions = () => cl().getVersions(application.id).then(setVersions).catch(() => {});
  useEffect(() => { loadVersions(); cl().getDir().then(setDir).catch(() => {}); }, [application.id]);

  const saveVersion = async () => {
    if (!body.trim()) return;
    setBusy('saving'); setSaveMsg('');
    try {
      const res = await cl().saveVersion({ applicationId: application.id, company, role, jobUrl: application.job_url, body });
      await loadVersions();
      setSaveMsg(res.pdfPath ? ('Saved to aplyd + PDF: ' + res.pdfPath) : 'Saved to aplyd (PDF failed, check the folder).');
    } catch { setSaveMsg('Could not save. Try again.'); }
    finally { setBusy(''); }
  };
  const loadVersion = (v: any) => { setBody(v.body); save(v.body); setNote('Loaded a saved version. Edit, refine, or copy.'); };
  const deleteVersion = async (id: string) => { await cl().deleteVersion(id).catch(() => {}); loadVersions(); };
  const changeDir = async () => { const r = await cl().setDir().catch(() => null); if (r?.dir) setDir(r.dir); };

  // The ask-for-the-posting state replaces the letter UI only while there is no
  // letter to replace: a row from before this rule still shows its old draft.
  const noPosting = postingMissing && !body.trim();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <FileText size={14} style={{ color: 'var(--accent)' }} />
        <p style={{ ...sectionLabel, margin: 0 }}>Cover letter</p>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ModelChips />
          {noPosting ? (
            <span style={{ fontSize: 'var(--fs-2)', color: 'var(--muted)' }}>Paste the posting first</span>
          ) : !open ? (
            <button onClick={generate} disabled={working} className="btn btn-accent">
              <Sparkles size={13} /> {working ? 'Working…' : 'Generate cover letter'}
            </button>
          ) : null}
        </div>
      </div>

      {noPosting ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            This one was added with just the company and role, so there is no posting to write from. Paste it here (or a link to it) and I will read the details onto this application.
          </p>
          <textarea
            value={posting}
            onChange={(e) => setPosting(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addPosting(); } }}
            disabled={busy === 'posting'}
            placeholder="Paste the job posting here…"
            style={{ width: '100%', minHeight: 140, resize: 'vertical', padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 12.5, lineHeight: 1.6, fontFamily: 'inherit' }}
          />
          {postingError && (
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--accent)', lineHeight: 1.5 }}>{postingError}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={addPosting} disabled={busy === 'posting' || !posting.trim()} className="btn btn-accent">
              <FileText size={13} /> {busy === 'posting' ? 'Reading the posting…' : 'Add posting'}
            </button>
            {busy === 'posting' && <span style={{ fontSize: 'var(--fs-2)', color: 'var(--muted)' }}>{elapsed}s</span>}
          </div>
        </div>
      ) : !open ? (
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          I’ll pull everything I know about you (resume, portfolio, your voice), research {company} on the web (what they do, their values, where they’re heading this year), match it to what this role wants, and draft a letter you can refine and copy.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {note && (
            <div style={{ fontSize: 'var(--fs-2)', color: working ? 'var(--accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {working && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 6, background: 'var(--accent)', animation: 'pulse 1s ease-in-out infinite' }} />}
              <span>{note}</span>
              {working && <span style={{ opacity: 0.7 }}>· {elapsed}s</span>}
            </div>
          )}
          {working && <div className="aplyd-bar" />}

          {/* The draft failed. Not a status line that scrolls away: the reason the
              main process gave, verbatim, how long it ran, and the way back. */}
          {genStatus === 'error' && (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'none', letterSpacing: 'normal', color: 'var(--accent)' }}>
                {failedAction.current === 'refine' ? 'Refine failed' : 'Draft failed'}
              </div>
              <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.55, color: 'var(--ink)' }}>{genError}</div>
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--muted)' }}>Gave up after {genErrorAfter}s.</div>
              <div>
                <button onClick={retry} disabled={working} className="btn btn-accent">
                  <RotateCcw size={13} /> Try again
                </button>
              </div>
            </div>
          )}

          {/* the assistant's message TO you (questions / heads-up), kept OUT of the letter */}
          {aiNote && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--info-line)', background: 'var(--info-tint)' }}>
              <Sparkles size={14} style={{ color: 'var(--info)', flex: 'none', marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'none', letterSpacing: 'normal', color: 'var(--info)', marginBottom: 3 }}>Note from your assistant</div>
                <div style={{ color: 'var(--ink)' }}>{aiNote}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 5 }}>Answer in the “Tell me what to change” box below (e.g. type your phone number) and hit Refine.</div>
              </div>
              <button onClick={() => setAiNote('')} title="Dismiss" className="btn btn-link" style={{ color: 'var(--muted)' }}><X size={12} /></button>
            </div>
          )}

          {/* the exact pages the research read, so you can verify the right company */}
          {sources.length > 0 && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>Researched from:</span>
              {sources.map((s, i) => {
                let host = s; try { host = new URL(s).host.replace(/^www\./, ''); } catch { /* keep */ }
                return <span key={i} title={s} style={{ padding: '2px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg)' }}>{host}</span>;
              })}
              <span style={{ opacity: 0.8 }}>· not the right company? hit Regenerate</span>
            </div>
          )}

          {/* The draft lands here line by line as it is written. Read-only while
              that is happening, because anything typed would be overwritten by
              the next chunk. */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => !streaming && body && save(body)}
            readOnly={streaming}
            placeholder={working ? '' : 'Your cover letter will appear here…'}
            style={{ width: '100%', minHeight: 260, resize: 'vertical', padding: 14, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 13, lineHeight: 1.65, fontFamily: 'inherit', opacity: working && !streaming ? 0.6 : 1 }}
          />
          {streaming && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Writing it now, you can edit once it finishes.</div>
          )}

          {/* refine row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { if (e.metaKey || e.ctrlKey) e.preventDefault(); refine(); } }}
                disabled={working || !body}
                placeholder="Tell me what to change (e.g. ‘shorter, lead with the React work, warmer tone’), Enter to send…"
                style={{ flex: 1, padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 'var(--fs-2)' }}
              />
              <button onClick={refine} disabled={working || !body || !feedback.trim()} className="btn">
                <Send size={13} /> {busy === 'refining' ? 'Refining…' : 'Refine'}
              </button>
            </div>
            <label
              title="Off: this change applies to this letter only. On: it becomes a style rule for every future letter."
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}
            >
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={working}
                style={{ margin: 0, accentColor: 'var(--accent)' }}
              />
              Remember as a style rule
            </label>
          </div>

          {/* action bar: primary (copy) on the left, secondary grouped on the right */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 2 }}>
            <button onClick={copy} disabled={!body} className="btn btn-accent">
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy letter</>}
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={saveVersion} disabled={working || !body} title="Keep this version: saves to aplyd AND as a labelled PDF in your folder" className="btn">
                <Save size={13} /> {busy === 'saving' ? 'Saving…' : 'Save version + PDF'}
              </button>
              <button
                onClick={generate}
                disabled={working || postingMissing}
                title={postingMissing ? 'Paste the posting on this page first: there is nothing to write from yet.' : 'Draft a fresh letter'}
                className="btn btn-ghost"
              >
                <RotateCcw size={13} /> {busy === 'generating' ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </div>

          {saveMsg && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink)', display: 'flex', gap: 6, alignItems: 'flex-start', background: 'var(--success-tint)', border: '1px solid var(--success-line)', borderRadius: 'var(--radius)', padding: '7px 10px' }}>
              <Check size={13} style={{ color: 'var(--success)', flex: 'none', marginTop: 1 }} />
              <span style={{ wordBreak: 'break-all' }}>{saveMsg}</span>
            </div>
          )}

          {/* saved versions */}
          {versions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ ...sectionLabel, margin: '2px 0 2px' }}>Saved versions ({versions.length})</p>
              {versions.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg)' }}>
                  <FileText size={12} style={{ color: 'var(--accent)', flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label || (company + ' - ' + role)}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(v.updatedAt).toLocaleDateString(displayLocale())}</span>
                  <button onClick={() => loadVersion(v)} title="Load this version into the editor" className="btn btn-link"><Download size={12} /> Load</button>
                  <button onClick={() => deleteVersion(v.id)} title="Delete this saved version" className="btn btn-link" style={{ color: 'var(--muted)' }}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}

          {/* quiet settings footer: where PDFs go + microcopy */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-1)', color: 'var(--muted)' }}>
              <FolderOpen size={12} style={{ flex: 'none' }} />
              <span>PDF folder</span>
              <span title={dir} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{dir || '…'}</span>
              <button onClick={changeDir} className="btn btn-link">Change</button>
              <button onClick={() => cl().openFolder()} className="btn btn-link">Open</button>
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Draft auto-saves here · “Save version + PDF” keeps a copy in aplyd and writes a labelled PDF · feedback teaches your voice.</span>
          </div>
        </div>
      )}
    </div>
  );
};

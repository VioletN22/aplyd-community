import React, { useState } from 'react';
import { MapPin, DollarSign, Calendar, Trash2 } from 'lucide-react';
import { JobApplication, hasUpcomingInterview, isQuiet, quietDays } from '../../shared/types';
import { Dialog } from './Dialog';
import { StatusBadge } from './StatusBadge';
import { stageLabel } from '../lib/stages';
import { FLAG_TONE, fitTone, stageTone } from '../lib/chipColors';
import { FlagChip, LocationChip, SourceChip } from './Chips';
import { usePrepRunning } from '../hooks/usePrepStatus';
import { isRegionalAu, locationCities, genericLocationLabel } from '../../shared/location';
import { Pie, stagePie, stageColor } from './Pie';
import { displayLocale } from '../../shared/locale';

export type ListDensity = 'compact' | 'comfortable';

interface ApplicationCardProps {
  application: JobApplication;
  onClick: (id: string) => void;
  onDelete?: (id: string) => void;
  stages?: string[]; // selectable stages for this app (incl. rejected/withdrawn)
  onChangeStage?: (id: string, stage: string) => void;
  /** compact = the ~44px triage row (default); comfortable = the tall card. */
  density?: ListDensity;
}

// "12 Aug": the day it was applied, in the shortest form that still reads.
const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(displayLocale(), { day: 'numeric', month: 'short' });
};

// "3w": how long ago, in the largest unit that stays honest.
const relativeAge = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
};

/** Background letter prep: drafting now, or a working draft waiting to be read. */
const DraftTag: React.FC<{ application: JobApplication }> = ({ application }) => {
  const drafting = usePrepRunning(application.id, 'letter');
  if (drafting) return <FlagChip tone={FLAG_TONE.drafting} title="Writing a working draft in the background">Drafting...</FlagChip>;
  if (application.has_letter_draft) return <FlagChip tone={FLAG_TONE.draftReady} title="A working cover-letter draft is ready to review">Draft ready</FlagChip>;
  return null;
};

/** Presence dot: filled when the document exists, hollow when it does not. */
const PresenceDot: React.FC<{ on: boolean; title: string }> = ({ on, title }) => (
  <span
    title={title}
    role="img"
    aria-label={title}
    style={{
      width: 7,
      height: 7,
      borderRadius: '50%',
      flex: 'none',
      display: 'inline-block',
      border: '1px solid var(--muted)',
      backgroundColor: on ? 'var(--muted)' : 'transparent',
    }}
  />
);

const ApplicationCardBase: React.FC<ApplicationCardProps> = ({ application, onClick, onDelete, stages, onChangeStage, density = 'compact' }) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const sc = stageTone(application.current_stage);
  const cities = locationCities(application.location);
  // Chips for the location: the metro it names, Regional (elsewhere in Australia),
  // or a generic label (the city) for anywhere else, so no posting goes untagged.
  const generic = genericLocationLabel(application.location);
  const places: string[] = cities.length > 0
    ? cities
    : isRegionalAu(application.location)
      ? ['Regional']
      : generic ? [generic] : [];

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(displayLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateString;
    }
  };

  const formatSalary = (min: number | null, max: number | null): string => {
    if (!min && !max) return '';
    const minK = min ? `$${Math.round(min / 1000)}k` : '';
    const maxK = max ? `$${Math.round(max / 1000)}k` : '';
    if (minK && maxK) return `${minK} - ${maxK}`;
    return minK || maxK;
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteDialog(false);
    onDelete?.(application.id);
  };

  // display:contents keeps the wrapper out of the row's flex layout while still
  // catching the clicks, so Cancel does not fall through and open the application.
  const deleteDialog = (
    <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
      <Dialog
        isOpen={showDeleteDialog}
        title={`Delete application for ${application.job_title}?`}
        message={`This will remove "${application.job_title}" at ${application.company} and all associated data.`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteDialog(false)}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
      />
    </span>
  );

  const fitChip = application.fit_score != null && (
    <span
      title={application.fit_reason ?? undefined}
      style={{
        flex: 'none',
        width: '20px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: fitTone(application.fit_score).bg,
        color: fitTone(application.fit_score).fg,
      }}
    >
      {application.fit_score}
    </span>
  );

  // ── Compact: one table row, 20+ to a screen ─────────────────────────────────
  if (density === 'compact') {
    const applied = shortDate(application.created_at);
    const age = relativeAge(application.created_at);
    const quiet = isQuiet(application);
    const interviewSoon = hasUpcomingInterview(application);
    const fit = application.fit_score;

    return (
      <div
        className="jrow"
        role="row"
        tabIndex={0}
        onClick={() => onClick(application.id)}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(application.id); } }}
      >
        <span className="jrow-co" title={application.company}>
          <Pie value={stagePie(application.current_stage)} color={stageColor(application.current_stage)} size={18} />
          <span>{application.company}</span>
        </span>

        <span className="jrow-role" title={application.job_title}>{application.job_title}</span>

        <span style={{ minWidth: 0, display: 'flex' }}>
          {onChangeStage && stages && stages.length > 0 ? (
            <StatusBadge dense value={application.current_stage} options={stages} onChange={(st) => onChangeStage(application.id, st)} />
          ) : (
            <span className="pill" style={{ backgroundColor: sc.bg, color: sc.fg }}>{stageLabel(application.current_stage)}</span>
          )}
        </span>

        <span className={`jrow-fit ${fit != null && fit < 6 ? 'lo' : ''}`} title={application.fit_reason ?? undefined}>
          {fit != null ? <><span className="tr"><i style={{ width: `${fit * 10}%` }} /></span>{fit}</> : <span className="jrow-soft" title="Not scored yet">·</span>}
        </span>

        <span className="jrow-tags">
          {interviewSoon && (
            <FlagChip tone={FLAG_TONE.interview} icon={<Calendar size={11} aria-hidden />} title={`Interview ${new Date(application.interview_at as string).toLocaleString(displayLocale())}`}>
              Interview {shortDate(application.interview_at)}
            </FlagChip>
          )}
          <DraftTag application={application} />
          {quiet && <FlagChip tone={FLAG_TONE.noResponse} title={`Nothing for ${quietDays(application)} days`}>No response</FlagChip>}
        </span>

        <span style={{ minWidth: 0, display: 'flex' }}><SourceChip source={application.job_source} /></span>

        <span className="jrow-soft" title={application.location || undefined}>
          {places.length > 0 ? places.join(', ') : application.location || ''}
        </span>

        <span className="jrow-soft" title={`Applied ${formatDate(application.created_at)}${age ? `, ${age === 'today' ? 'today' : `${age} ago`}` : ''}`}>{applied}</span>

        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {onDelete && (
            <button className="jrow-del" onClick={handleDelete} title="Delete application" aria-label={`Delete ${application.job_title} at ${application.company}`}>
              <Trash2 size={14} />
            </button>
          )}
        </span>

        {deleteDialog}
      </div>
    );
  }

  // ── Comfortable: the original card, kept for when the user wants the detail ───────
  return (
    <div
      style={{
        borderBottom: '1px solid var(--line)',
        paddingBottom: '16px',
        marginBottom: '16px',
        cursor: 'pointer',
        position: 'relative',
        paddingRight: '32px',
      }}
      onClick={() => onClick(application.id)}
      onMouseEnter={(e) => {
        const btn = e.currentTarget.querySelector<HTMLButtonElement>('button[data-row-delete]');
        if (btn) btn.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        const btn = e.currentTarget.querySelector<HTMLButtonElement>('button[data-row-delete]');
        if (btn) btn.style.opacity = '0.3';
      }}
    >
      {/* Delete button */}
      {onDelete && (
        <button
          data-row-delete
          onClick={handleDelete}
          style={{
            position: 'absolute',
            top: '0',
            right: '0',
            padding: '4px 8px',
            backgroundColor: 'transparent',
            color: 'var(--muted)',
            border: 'none',
            cursor: 'pointer',
            opacity: 0.3,
            transition: 'opacity 0.2s',
          }}
          title="Delete application"
        >
          <Trash2 size={16} />
        </button>
      )}

      {/* Stage selector + source, side by side as matching badges */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
        {onChangeStage && stages && stages.length > 0 ? (
          <StatusBadge
            value={application.current_stage}
            options={stages}
            onChange={(s) => onChangeStage(application.id, s)}
          />
        ) : (
          <div
            style={{
              display: 'inline-block', padding: '4px 8px', backgroundColor: sc.bg, color: sc.fg,
              fontSize: '12px', borderRadius: '10px', fontWeight: 600, marginBottom: '8px',
            }}
          >
            {stageLabel(application.current_stage)}
          </div>
        )}

        {application.job_source && (
          <span style={{ marginBottom: '8px', display: 'inline-flex', alignSelf: 'center' }}><SourceChip source={application.job_source} /></span>
        )}

        {places.map((p) => <span key={p} style={{ marginBottom: '8px', display: 'inline-flex', alignSelf: 'center' }}><LocationChip place={p} title={`Location: ${application.location}`} /></span>)}

        {/* Fit against their best-fit resume: a bare number, accent once it is strong */}
        {application.fit_score != null && (
          <span style={{ marginLeft: 'auto', marginBottom: '8px', display: 'inline-flex' }}>{fitChip}</span>
        )}
      </div>

      {/* Title */}
      <h3
        style={{
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--ink)',
          marginTop: '8px',
          marginBottom: '4px',
          paddingRight: '24px',
        }}
      >
        {application.job_title}
      </h3>

      {/* Company */}
      <p
        style={{
          fontSize: '13px',
          color: 'var(--muted)',
          marginBottom: '12px',
        }}
      >
        {application.company}
      </p>

      {/* Applied date, letter presence, interview, quiet */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--muted)', marginBottom: '10px' }}>
        <span title={`Applied ${formatDate(application.created_at)}`}>
          Applied {shortDate(application.created_at)}{relativeAge(application.created_at) ? ` (${relativeAge(application.created_at)})` : ''}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <PresenceDot on={!!application.has_letter} title={application.has_letter ? 'Cover letter drafted' : 'No cover letter yet'} />
        </span>
        {hasUpcomingInterview(application) && (
          <FlagChip
            tone={FLAG_TONE.interview}
            icon={<Calendar size={11} aria-hidden />}
            title={`Interview ${new Date(application.interview_at as string).toLocaleString(displayLocale())}`}
          >
            {shortDate(application.interview_at)}
          </FlagChip>
        )}
        <DraftTag application={application} />
        {isQuiet(application) && <FlagChip tone={FLAG_TONE.noResponse} title={`Nothing for ${quietDays(application)} days`}>No response</FlagChip>}
      </div>

      {/* Location */}
      {application.location && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)', marginBottom: '8px' }}>
          <MapPin size={14} />
          <span>{application.location}</span>
        </div>
      )}

      {/* Salary */}
      {(application.salary_min || application.salary_max) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)', marginBottom: '8px' }}>
          <DollarSign size={14} />
          <span>{formatSalary(application.salary_min, application.salary_max)}</span>
        </div>
      )}

      {/* Application deadline */}
      {application.application_deadline && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)' }}>
          <Calendar size={14} />
          <span>{formatDate(application.application_deadline)}</span>
        </div>
      )}

      {deleteDialog}
    </div>
  );
};

// The list re-renders on every keystroke of the search box. Rows only change when
// their own application does, so memoizing them keeps a 68-row list instant.
// Requires stable callback + stages identities from ListPage, which it provides.
export const ApplicationCard = React.memo(ApplicationCardBase);

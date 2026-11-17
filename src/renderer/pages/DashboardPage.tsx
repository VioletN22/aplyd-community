import React, { useState, useEffect, useMemo } from 'react';
import { JobApplication, TodayActionItem, isQuiet } from '../../shared/types';
import { useApplications } from '../hooks/useApplications';
import { InboxBanner } from '../components/InboxBanner';
import { WhatsWorking } from '../components/WhatsWorking';
import type { Filters } from '../components/FilterBar';
import { stageLabel, stageOptions } from '../lib/stages';
import { TONES } from '../lib/chipColors';
import { interviewWhen } from '../lib/today';
import { computeNeedsYou, shortWhen, type NeedEntry } from '../lib/needsYou';

interface DashboardStats {
  total: number;
  byStage: Record<string, number>;
  recentApplications: number;
  /** The one-line triage strip: what is out, what came back, what needs a nudge. */
  applied: number;
  rejected: number;
  interviewsSet: number;
  quiet: number;
}

const sectionLabel: React.CSSProperties = {
  fontSize: '12px',
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--muted)',
  marginBottom: '8px',
};

// Bars follow the fixed stage order (then the known custom stages); a legacy
// stage sorts to the end.
const STAGE_RANK: Record<string, number> = Object.fromEntries(stageOptions().map((st, i) => [st, i]));

// One colour per kind of stage: talking (green), being tested (amber), sent
// (blue), over or silent (grey). Unknown stages read as grey too.
const STAGE_BAR: Record<string, string> = {
  applied: TONES.blue.dot,
  phone_screen: TONES.green.dot,
  interview: TONES.green.dot,
  offer: TONES.green.fg,
  assessment: TONES.amber.dot,
  take_home: TONES.amber.dot,
  oa: TONES.amber.dot,
  // Light amber: the same family as Assessment, done.
  assessed: '#fcd34d',
  no_response: TONES.grey.dot,
  rejected: TONES.grey.dot,
  withdrawn: TONES.grey.dot,
};
const barColour = (stage: string) => STAGE_BAR[stage] ?? TONES.grey.dot;

/** Square-root width so a stage with 3 rows is still a visible bar next to one with 300. */
const barWidth = (count: number, max: number) => (count > 0 ? Math.max(2, Math.sqrt(count / max) * 100) : 0);

/** A large clickable count (or line) in the "Needs you" row. */
const NeedCard: React.FC<{
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  /** A second, smaller line under the detail. */
  extra?: React.ReactNode;
  tone: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}> = ({ label, value, detail, extra, tone, active, onClick, title }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: '1 1 200px',
        minWidth: 0,
        textAlign: 'left',
        padding: '16px 20px 18px',
        border: '1px solid var(--line)',
        borderTop: `3px solid ${active ? tone : 'var(--line)'}`,
        backgroundColor: hover ? 'var(--panel)' : 'var(--bg)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'var(--ink)',
        // Buttons are uppercase and tracked app-wide; these read as content.
        textTransform: 'none',
        letterSpacing: 'normal',
        transition: 'background-color 120ms',
      }}
    >
      <p style={sectionLabel}>{label}</p>
      <div style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.1, color: active ? 'var(--ink)' : 'var(--faint)' }}>{value}</div>
      {detail && (
        <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {detail}
        </div>
      )}
      {extra && (
        <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {extra}
        </div>
      )}
    </button>
  );
};

/** One row of "Applications by stage": a button that opens the list filtered to it. */
const StageRow: React.FC<{ stage: string; count: number; total: number; max: number; onClick: () => void }> = ({
  stage,
  count,
  total,
  max,
  onClick,
}) => {
  const [hover, setHover] = useState(false);
  const label = stage === 'no_response' ? 'No response' : stageLabel(stage);
  const share = total > 0 ? (count / total) * 100 : 0;
  const pct = share > 0 && share < 1 ? '<1' : String(Math.round(share));
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${label.toLowerCase()} applications`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        width: 'calc(100% + 16px)',
        padding: '6px 8px',
        margin: '0 -8px',
        border: 'none',
        backgroundColor: hover ? 'var(--panel)' : 'transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        textTransform: 'none',
        letterSpacing: 'normal',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ width: '150px', flexShrink: 0, fontSize: '13px', color: 'var(--ink)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flex: 1, height: '8px', backgroundColor: 'var(--panel-2, #eae9e3)' }}>
        <span style={{ display: 'block', width: `${barWidth(count, max)}%`, height: '100%', backgroundColor: barColour(stage) }} />
      </span>
      <span className="mono-num" style={{ width: '84px', flexShrink: 0, fontSize: '13px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{count}</span>
        <span style={{ color: 'var(--muted)' }}> · {pct}%</span>
      </span>
    </button>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; last?: boolean; sub?: React.ReactNode; onClick?: () => void; title?: string }> = ({
  label,
  value,
  last,
  sub,
  onClick,
  title,
}) => {
  const [hover, setHover] = useState(false);
  const body = (
    <>
      <p style={sectionLabel}>{label}</p>
      <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.05 }}>{value}</p>
      {sub && (
        <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</p>
      )}
    </>
  );
  const box: React.CSSProperties = { flex: 1, minWidth: 0, padding: '16px 20px', borderRight: last ? 'none' : '1px solid var(--line)' };
  if (!onClick) return <div style={box}>{body}</div>;
  // The cell keeps the strip's layout; the button fills it.
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', borderRight: box.borderRight }}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          flex: 1,
          minWidth: 0,
          padding: box.padding,
          margin: 0,
          border: 'none',
          backgroundColor: hover ? 'var(--panel)' : 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textTransform: 'none',
          letterSpacing: 'normal',
        }}
      >
        {body}
      </button>
    </div>
  );
};

export interface DashboardPageProps {
  title?: string;
  /** Opens the Applications list, filtered when a filter is given. */
  onOpenApplications: (filter?: Filters) => void;
  /** Opens one application's page (the next interview). */
  onOpenApplication?: (id: string) => void;
  onOpenSettings: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onOpenApplications, onOpenApplication, onOpenSettings, title = 'Dashboard' }) => {
  const { applications, loading } = useApplications();
  const [stats, setStats] = useState<DashboardStats>({
    total: 0,
    byStage: {},
    recentApplications: 0,
    applied: 0,
    rejected: 0,
    interviewsSet: 0,
    quiet: 0,
  });
  // Open action items (the live set Today shows): assessments and due dates
  // that live outside the application rows.
  const [actionItems, setActionItems] = useState<TodayActionItem[]>([]);
  useEffect(() => {
    let live = true;
    window.electronAPI?.today?.get()
      .then((res) => { if (live && res?.ok && res.data) setActionItems(res.data.actionItems ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [applications]);
  const needs = useMemo(() => computeNeedsYou(applications, actionItems), [applications, actionItems]);

  useEffect(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const byStage: Record<string, number> = {};
    let recentApplications = 0;
    let interviewsSet = 0;
    let quiet = 0;

    applications.forEach((app: JobApplication) => {
      // No response rows leave the applied count and get a line of their own.
      const silent = isQuiet(app);
      if (silent) quiet++;
      else byStage[app.current_stage] = (byStage[app.current_stage] || 0) + 1;
      if (new Date(app.created_at) >= sevenDaysAgo) recentApplications++;
      if (app.interview_at) interviewsSet++;
    });

    setStats({
      total: applications.length,
      byStage,
      recentApplications,
      applied: byStage.applied || 0,
      rejected: byStage.rejected || 0,
      interviewsSet,
      quiet,
    });
  }, [applications]);

  if (loading) {
    return (
      <div style={{ padding: '32px' }}>
        <p style={{ fontSize: '13px', color: 'var(--muted)' }}>Loading…</p>
      </div>
    );
  }

  const sortedStages = Object.entries(stats.byStage).sort(
    (a, b) => (STAGE_RANK[a[0]] ?? 99) - (STAGE_RANK[b[0]] ?? 99)
  );
  // No response sits right under applied, where those rows came from.
  if (stats.quiet > 0) {
    const at = sortedStages.findIndex(([s]) => s === 'applied');
    sortedStages.splice(at + 1, 0, ['no_response', stats.quiet]);
  }
  const maxStage = Math.max(1, ...sortedStages.map(([, c]) => c));
  const openStage = (stage: string) =>
    onOpenApplications(stage === 'no_response' ? { noResponse: true } : { stage });
  const offers = stats.byStage.offer || 0;
  // A set of things to do: one with an application opens it, several open the
  // list narrowed to exactly those applications.
  const openEntries = (entries: NeedEntry[], label: string) => {
    const ids = Array.from(new Set(entries.map((e) => e.applicationId).filter((id): id is string => !!id)));
    if (ids.length === 1 && entries.length === 1 && onOpenApplication) onOpenApplication(ids[0]);
    else {
      const unlinked = entries.filter((e) => !e.applicationId).map((e) => e.label);
      onOpenApplications({ ids, drillDown: label, unlinked: unlinked.length ? unlinked : undefined });
    }
  };
  const soonestLine = (entries: NeedEntry[]) => {
    const e = entries[0];
    if (!e) return null;
    return Number.isFinite(e.due) ? `${e.label} · due ${shortWhen(e.due)}` : e.label;
  };
  const [nextUp, ...laterUps] = needs.upcoming;
  const strip = [
    `${stats.applied} applied`,
    `${stats.rejected} rejected`,
    `${stats.interviewsSet} interview${stats.interviewsSet === 1 ? '' : 's'} set`,
    `${stats.quiet} no response`,
  ].join(' · ');

  return (
    <div style={{ padding: '8px 40px 80px', maxWidth: '1040px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', marginBottom: '24px' }}>
        {title}
      </h1>

      {/* Sync progress and what email changed, when there is anything to say */}
      <InboxBanner onOpenApplications={() => onOpenApplications()} onOpenSettings={onOpenSettings} />

      {/* Needs you: what is waiting on them, each a way into the list */}
      <p style={sectionLabel}>Needs you</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '28px' }}>
        <NeedCard
          label="Interviews"
          value={needs.interviews}
          detail={needs.interviews === 1 ? 'application at interview' : 'applications at interview'}
          tone={TONES.green.dot}
          active={needs.interviews > 0}
          onClick={() => onOpenApplications({ stage: 'interview' })}
          title="Show applications at interview"
        />
        <NeedCard
          label="Assessments to do"
          value={needs.assessments.length}
          detail={soonestLine(needs.assessments) ?? 'Nothing waiting'}
          extra={needs.assessments.length > 1 ? `${needs.assessments.length - 1} more after that` : undefined}
          tone={TONES.amber.dot}
          active={needs.assessments.length > 0}
          onClick={() => openEntries(needs.assessments, 'Assessments to do')}
          title="Assessment stages and open assessment items"
        />
        {nextUp ? (
          <NeedCard
            label="Next interview"
            value={<span style={{ fontSize: '20px' }}>{interviewWhen(new Date(nextUp.at).toISOString())}</span>}
            detail={`${nextUp.company}${nextUp.role ? ` · ${nextUp.role}` : ''}`}
            extra={laterUps.length > 0
              ? `then ${laterUps.slice(0, 2).map((u) => `${shortWhen(u.at)} ${u.company}`).join(', ')}`
              : undefined}
            tone={TONES.green.dot}
            active
            onClick={() =>
              onOpenApplication ? onOpenApplication(nextUp.applicationId) : onOpenApplications({ stage: 'interview' })
            }
            title={`Open ${nextUp.company}`}
          />
        ) : (
          <NeedCard
            label="Next interview"
            value={<span style={{ fontSize: '20px' }}>None booked</span>}
            detail="No interview time set yet"
            tone={TONES.green.dot}
            active={false}
            onClick={() => onOpenApplications({ stage: 'interview' })}
            title="Show applications at interview"
          />
        )}
      </div>

      {/* Stat strip */}
      <div style={{ display: 'flex', border: '1px solid var(--line)', marginBottom: '28px' }}>
        <Stat label="Applications" value={stats.total} />
        <Stat label="This week" value={stats.recentApplications} />
        <Stat
          label="Deadlines (7d)"
          value={needs.deadlines.length}
          sub={needs.deadlines[0] ? `${shortWhen(needs.deadlines[0].due)} · ${needs.deadlines[0].label}` : undefined}
          onClick={needs.deadlines.length > 0 ? () => openEntries(needs.deadlines, 'Deadlines in the next 7 days') : undefined}
          title="Application deadlines and dated action items in the next 7 days"
        />
        <Stat
          label="Offers"
          value={<span style={{ color: offers > 0 ? '#1a9a50' : 'var(--ink)' }}>{offers}</span>}
          last
        />
      </div>

      {/* Where the pipeline stands, in one line */}
      <div
        style={{
          border: '1px solid var(--line)',
          backgroundColor: 'var(--panel)',
          padding: '14px 20px',
          marginBottom: '28px',
        }}
      >
        <p style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: 1.5 }}>
          {stats.total > 0 ? strip : 'Add your first application to start tracking.'}
        </p>
      </div>

      {/* Applications by stage */}
      <div>
        <p style={sectionLabel}>Applications by stage</p>
        {stats.total === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--muted)' }}>No applications yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
            {sortedStages.map(([stage, count]) => (
              <StageRow key={stage} stage={stage} count={count} total={stats.total} max={maxStage} onClick={() => openStage(stage)} />
            ))}
          </div>
        )}
      </div>

      {/* Reply rate by source, resume and role family */}
      <WhatsWorking refreshKey={applications} />
    </div>
  );
};

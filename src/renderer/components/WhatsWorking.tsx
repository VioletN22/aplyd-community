import React, { useEffect, useState } from 'react';
import type { OutcomeRow, OutcomeStats } from '../../shared/types';

const label: React.CSSProperties = {
  fontSize: '12px',
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--muted)',
  marginBottom: '8px',
};

const statsApi = () => window.electronAPI?.stats;

// Must match OTHER_KEY in main/stats.ts: the row small buckets fold into.
const OTHER_KEY = '__other';

/**
 * One bucket: name (and a resume's focus underneath), the progress rate large
 * with "3 of 320" beside it and the rejection rate under that, and one bar:
 * progressed in colour, rejected in grey, the rest still waiting. The best row in a column gets
 * a faint tint and an accent rule; the folded Other row reads quieter.
 */
const Row: React.FC<{ row: OutcomeRow; best: boolean }> = ({ row, best }) => {
  const share = (n: number) => (row.applied > 0 ? (n / row.applied) * 100 : 0);
  // Progress rates are small, so keep one decimal under 10%.
  const fmt = (v: number) => (v > 0 && v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const progress = share(row.progressed);
  const rejected = share(row.rejected);
  const other = row.key === OTHER_KEY;
  return (
    <div
      title={other ? `${row.folded} smaller ${row.folded === 1 ? 'bucket' : 'buckets'} under 5 applications each, together` : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 12,
        rowGap: 5,
        alignItems: 'end',
        padding: '8px 10px',
        margin: '0 -10px',
        backgroundColor: best ? 'var(--success-tint, rgba(31, 122, 61, .07))' : 'transparent',
        boxShadow: best ? 'inset 2px 0 0 var(--success, #1f7a3d)' : 'none',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div title={row.label} style={{ fontSize: 13, fontWeight: best ? 600 : 400, color: other ? 'var(--muted)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.label}
        </div>
        {row.sublabel && (
          <div title={row.sublabel} style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.sublabel}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
        <span className="mono-num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: other ? 'var(--muted)' : best ? 'var(--success, #1f7a3d)' : 'var(--ink)' }}>
          {fmt(progress)}%
        </span>
        <span className="mono-num" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {row.progressed} of {row.applied}
        </span>
      </div>
      <div className="mono-num" style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)' }}>
        {fmt(rejected)}% rejected · {row.applied - row.replied} waiting
      </div>
      <div style={{ gridColumn: '1 / -1', height: 4, display: 'flex', backgroundColor: 'var(--panel-2)' }}>
        <div style={{ width: `${progress}%`, height: '100%', backgroundColor: other ? 'var(--faint)' : 'var(--success, #1f7a3d)' }} />
        <div style={{ width: `${rejected}%`, height: '100%', backgroundColor: 'var(--faint)', opacity: 0.6 }} />
      </div>
    </div>
  );
};

const Group: React.FC<{ title: string; rows: OutcomeRow[] }> = ({ title, rows }) => {
  // Rows arrive sorted by rate, Other last: the best is the first real bucket,
  // and only worth calling out when there is something to beat.
  const real = rows.filter((r) => r.key !== OTHER_KEY);
  const bestKey = real.length > 1 && real[0].progressed > 0 ? real[0].key : null;
  return (
    <div style={{ minWidth: 0 }}>
      <p style={label}>{title}</p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => <Row key={r.key} row={r} best={r.key === bestKey} />)}
        </div>
      )}
    </div>
  );
};

/**
 * Progress rate (got to an assessment, screen, interview or offer) by job source, resume sent and role family. Until enough
 * applications have an outcome it is one muted line, not a table of noise.
 */
export const WhatsWorking: React.FC<{ refreshKey?: unknown }> = ({ refreshKey }) => {
  const [stats, setStats] = useState<OutcomeStats | null>(null);

  useEffect(() => {
    const api = statsApi();
    if (!api) return;
    let live = true;
    api.outcomes()
      .then((res) => { if (live && res.ok && res.data) setStats(res.data); })
      .catch(() => {});
    return () => { live = false; };
  }, [refreshKey]);

  if (!stats) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <p style={label}>What's working · % that progressed to an assessment, screen, interview or offer</p>
      {!stats.eligible ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Shows once 10 applications have a reply or outcome ({stats.withOutcome} so far).
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 28, border: '1px solid var(--line)', padding: 20, marginTop: 4 }}>
          <Group title="By job source" rows={stats.bySource} />
          <Group title="By resume sent" rows={stats.byResume} />
          <Group title="By role family" rows={stats.byRoleFamily} />
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { EmailKind, EmailSyncStatus } from '../../shared/types';
import { StageChip } from './StatusBadge';
import { kindLabel, kindStage, syncSummary } from '../lib/email';
import { displayLocale } from '../../shared/locale';

/** "APPLIED -> REJECTED" in the stage badge colours. */
export const StageMove: React.FC<{ from: string | null; to: string }> = ({ from, to }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {from && <StageChip stage={from} />}
    {from && <ArrowRight size={12} style={{ color: 'var(--muted)' }} />}
    <StageChip stage={to} />
  </span>
);

export const KindChip: React.FC<{ kind: EmailKind }> = ({ kind }) => (
  <StageChip stage={kindStage(kind)} label={kindLabel(kind)} />
);

/** The live line under a sync: a moving bar while it runs, a summary once done. */
export const SyncProgress: React.FC<{ status: EmailSyncStatus | null }> = ({ status }) => {
  if (!status) return null;
  if (status.running) {
    return (
      <div style={{ margin: '12px 0 0' }}>
        <div className="aplyd-bar" style={{ marginBottom: 8 }} />
        <p style={{ fontSize: 13, margin: 0 }}>
          Reading your job emails... {status.seen.toLocaleString(displayLocale())} checked
        </p>
        {status.message && (
          <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 0' }}>{status.message}</p>
        )}
      </div>
    );
  }
  if (status.phase === 'error') {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--accent)', margin: '12px 0 0' }}>
        {status.error || status.message || 'The sync stopped. Try Sync now.'}
      </p>
    );
  }
  if (status.phase === 'done') {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '12px 0 0' }}>
        {syncSummary(status)}
      </p>
    );
  }
  return null;
};

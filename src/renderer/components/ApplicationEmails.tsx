import React, { useEffect, useState } from 'react';
import type { EmailEvent } from '../../shared/types';
import { KindChip } from './EmailBits';
import { emailApi } from '../hooks/useEmailSync';
import { shortDate, stageChange } from '../lib/email';
import { stageLabel } from '../lib/stages';

const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--fs-1)',
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--muted)',
  marginBottom: '8px',
};

/**
 * Emails linked to this application, newest first, read-only. Sync applies
 * them by itself; a row that moved the stage says so. Absent when there are none.
 */
export const ApplicationEmails: React.FC<{ applicationId: string }> = ({ applicationId }) => {
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const api = emailApi();
    if (!api) return;
    setEvents([]); setError(null);
    api.listEvents({ applicationId, status: 'all' })
      .then((res) => {
        if (!live) return;
        if (res.ok) setEvents(res.data || []);
        else setError(res.error || 'Could not load emails.');
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [applicationId]);

  if (error) {
    return (
      <div>
        <p style={sectionLabel}>Emails</p>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{error}</p>
      </div>
    );
  }
  if (events.length === 0) return null;

  const sorted = [...events].sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
  return (
    <div>
      <p style={sectionLabel}>Emails</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sorted.map((e) => (
          <div key={e.id} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(e.sentAt)}</span>
              <KindChip kind={e.kind} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0, lineHeight: 1.4, overflowWrap: 'anywhere' }} title={e.fromAddress}>
              {e.subject || '(no subject)'}
            </p>
            {(() => {
              const change = stageChange(e);
              return change ? (
                <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '2px 0 0' }}>
                  Changed stage to {stageLabel(change.to)}
                </p>
              ) : null;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
};

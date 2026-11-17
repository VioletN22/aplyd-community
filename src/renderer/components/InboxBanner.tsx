import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useEmailSync } from '../hooks/useEmailSync';
import { plural } from '../lib/email';
import { displayLocale } from '../../shared/locale';

// The sync whose auto-applied count the user has already looked at. Kept per viewer
// in localStorage: losing it only means the line shows once more.
const SEEN_KEY = 'aplyd.emailAutoAppliedSeen';
const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (v: string) => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* fine */ } };

/**
 * One slim line: syncing, a stopped sync, emails waiting for Claude, or how
 * many applications email just updated (which opens the Applications list). Email applies by itself, so
 * there is never anything to review. Nothing at all when there is nothing to
 * say, and only a quiet link when no inbox is connected.
 */
export const InboxBanner: React.FC<{
  onOpenApplications: () => void;
  onOpenSettings: () => void;
}> = ({ onOpenApplications, onOpenSettings }) => {
  const { accounts, status, loading, available } = useEmailSync();
  const [seen, setSeen] = useState<string | null>(readSeen);

  if (!available || loading) return null;

  if (accounts.length === 0) {
    return (
      <div style={{ marginBottom: 20 }}>
        <button className="inbox-quiet-link" onClick={onOpenSettings}>
          Connect your inbox to update stages automatically
        </button>
      </div>
    );
  }
  if (!status) return null;

  const lines: React.ReactNode[] = [];

  if (status.running) {
    lines.push(
      <div key="sync" className="inbox-line" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <span>Reading your job emails... {status.seen.toLocaleString(displayLocale())} checked</span>
        <div className="aplyd-bar" />
      </div>,
    );
  } else if (status.phase === 'error') {
    lines.push(
      <button key="err" className="inbox-line" onClick={onOpenSettings}>
        <span className="dot" />
        <span>Inbox sync stopped. Open Settings to fix it.</span>
        <span className="go"><ChevronRight size={14} /></span>
      </button>,
    );
  }

  if (!status.running && status.phase !== 'error' && status.pendingCount > 0) {
    lines.push(
      <button key="waiting" className="inbox-line" onClick={onOpenSettings}>
        <span className="dot" />
        <span>{plural(status.pendingCount, 'job email')} waiting to be read. Open Settings to see why.</span>
        <span className="go"><ChevronRight size={14} /></span>
      </button>,
    );
  }

  const seenMarker = status.lastSyncAt || '';
  if (!status.running && status.autoApplied > 0 && seen !== seenMarker) {
    lines.push(
      <button
        key="auto"
        className="inbox-line"
        onClick={() => { writeSeen(seenMarker); setSeen(seenMarker); onOpenApplications(); }}
      >
        <span className="dot" style={{ background: 'var(--success)' }} />
        <span>{plural(status.autoApplied, 'application')} updated from email</span>
        <span className="go"><ChevronRight size={14} /></span>
      </button>,
    );
  }

  if (lines.length === 0) return null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>{lines}</div>;
};

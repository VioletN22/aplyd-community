import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailAccount, EmailSyncStatus } from '../../shared/types';

// The email half of the preload surface. Reached through a getter so a build of
// the renderer running against an older main process degrades to "not set up"
// instead of throwing.
export const emailApi = () => window.electronAPI?.email;

/**
 * Tell every mounted useEmailSync that something changed (an account added or
 * removed) so every screen catches up without waiting for the next progress event.
 */
const CHANGED = 'aplyd:email-changed';
export const announceEmailChange = () => { window.dispatchEvent(new Event(CHANGED)); };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface UseEmailSync {
  accounts: EmailAccount[];
  status: EmailSyncStatus | null;
  loading: boolean;
  error: string | null;
  /** False when this build of main has no email API at all. */
  available: boolean;
  refresh: () => Promise<void>;
}

/**
 * Accounts plus the live sync status. Every screen that shows inbox state uses
 * this, so they all agree: it loads once, then follows email.onProgress.
 */
export function useEmailSync(): UseEmailSync {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [status, setStatus] = useState<EmailSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const available = !!emailApi();
  const lastPhase = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const api = emailApi();
    if (!api) { setLoading(false); return; }
    try {
      const [acc, st] = await Promise.all([api.listAccounts(), api.status()]);
      if (acc.ok) setAccounts(acc.data || []);
      if (st.ok && st.data) setStatus(st.data);
      const failed = !acc.ok ? acc.error : !st.ok ? st.error : null;
      setError(failed || null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChanged = () => { refresh(); };
    window.addEventListener(CHANGED, onChanged);
    const api = emailApi();
    if (!api) return () => window.removeEventListener(CHANGED, onChanged);
    const off = api.onProgress((s) => {
      setStatus(s);
      // A finished run changes lastSyncAt and lastError on the accounts too.
      if ((s.phase === 'done' || s.phase === 'error') && lastPhase.current !== s.phase) {
        api.listAccounts().then((r) => { if (r.ok) setAccounts(r.data || []); }).catch(() => {});
      }
      lastPhase.current = s.phase;
    });
    return () => {
      window.removeEventListener(CHANGED, onChanged);
      try { off && off(); } catch { /* already gone */ }
    };
  }, [refresh]);

  return { accounts, status, loading, error, available, refresh };
}

/** Re-render every minute so "5 min ago" stays true while the page is open. */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

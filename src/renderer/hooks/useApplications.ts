import { useState, useEffect } from 'react';
import { JobApplication } from '../../shared/types';

/**
 * Something outside the page added or changed applications (a quick add from
 * the global shortcut): every mounted list reloads.
 */
const CHANGED = 'aplyd:applications-changed';
export const announceApplicationsChanged = () => { window.dispatchEvent(new Event(CHANGED)); };

interface UseApplicationsReturn {
  applications: JobApplication[];
  loading: boolean;
  error: string | null;
  refresh: (filters?: any) => Promise<void>;
  // Update one application in place (no reload) so the list doesn't reset scroll.
  patch: (id: string, changes: Partial<JobApplication>) => void;
}

export function useApplications(): UseApplicationsReturn {
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (filters?: any) => {
    try {
      setLoading(true);
      setError(null);
      const res = await window.electronAPI.db.getAllApplications(filters);
      if (!res.ok) {
        setError(res.error || 'Failed to load applications');
        return;
      }
      setApplications(res.data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load applications';
      setError(errorMessage);
      console.error('Error loading applications:', err);
    } finally {
      setLoading(false);
    }
  };

  const patch = (id: string, changes: Partial<JobApplication>) => {
    setApplications((apps) => apps.map((a) => (a.id === id ? { ...a, ...changes } : a)));
  };

  useEffect(() => {
    refresh();
    const onChanged = () => { refresh(); };
    window.addEventListener(CHANGED, onChanged);
    return () => window.removeEventListener(CHANGED, onChanged);
  }, []);

  return { applications, loading, error, refresh, patch };
}

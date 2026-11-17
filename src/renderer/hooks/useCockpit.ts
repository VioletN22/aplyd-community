import { useCallback, useEffect, useState } from 'react';
import type { CockpitData } from '../../shared/cockpit';
import { useEmailSync } from './useEmailSync';

/**
 * The cockpit payload (actions, approvals, events, pipeline numbers), kept
 * fresh: on mount, whenever an agent writes to the database, when a sync
 * finishes, when the window regains focus, and once a minute. The sidebar and
 * Today both read it.
 */
export function useCockpit() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [error, setError] = useState('');
  const { status } = useEmailSync();

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.cockpit.get();
      if (!res.ok || !res.data) throw new Error(res.error || 'Could not load your day.');
      setData(res.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const off = window.electronAPI.cockpit.onChanged(() => void load());
    const focus = () => void load();
    window.addEventListener('focus', focus);
    const timer = setInterval(focus, 60000);
    return () => { off(); window.removeEventListener('focus', focus); clearInterval(timer); };
  }, [load]);

  useEffect(() => { void load(); }, [load, status?.phase]);

  return { data, error, reload: load };
}

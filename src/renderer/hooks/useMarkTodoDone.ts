import { useCallback, useState } from 'react';

/**
 * Ticks a to-do off from the calendar views, the same call Today uses. The tick
 * shows at once; the cockpit reload then drops the item. If the save fails the
 * tick is undone and the error is returned for the page to show.
 */
export function useMarkTodoDone(reload: () => unknown) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const markDone = useCallback(async (actionItemId: string) => {
    setTicked((s) => new Set(s).add(actionItemId));
    setError('');
    try {
      const res = await window.electronAPI?.today?.markActionItemDone(actionItemId);
      if (res && !res.ok) throw new Error(res.error || 'Could not mark that done.');
      await reload();
    } catch (e) {
      setTicked((s) => { const n = new Set(s); n.delete(actionItemId); return n; });
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reload]);
  // Dismissing a stale to-do: gone without counting as done.
  const dismiss = useCallback(async (actionItemId: string) => {
    setTicked((s) => new Set(s).add(actionItemId));
    setError('');
    try {
      const res = await window.electronAPI?.today?.dismissActionItem(actionItemId);
      if (res && !res.ok) throw new Error(res.error || 'Could not dismiss that.');
      await reload();
    } catch (e) {
      setTicked((s) => { const n = new Set(s); n.delete(actionItemId); return n; });
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [reload]);
  return { ticked, markDone, dismiss, error };
}

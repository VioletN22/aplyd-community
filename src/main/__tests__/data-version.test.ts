import { it, expect, vi } from 'vitest';
import { watchDataVersion } from '../data-version';
it('notifies only external data-version changes and releases its timer', () => {
  vi.useFakeTimers();
  let version=1;
  const changed=vi.fn();
  const stop=watchDataVersion(()=>version,changed);
  vi.advanceTimersByTime(3000); expect(changed).not.toHaveBeenCalled();
  version=2; vi.advanceTimersByTime(3000); expect(changed).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(3000); expect(changed).toHaveBeenCalledTimes(1);
  stop(); version=3; vi.advanceTimersByTime(3000); expect(changed).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

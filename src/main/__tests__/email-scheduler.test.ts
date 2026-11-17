import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmailScheduler, FIRST_SYNC_DELAY_MS, SYNC_EVERY_MS, RESUME_DELAY_MS } from '../email/scheduler';

describe('email scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('syncs a minute after launch, then every half hour', () => {
    const tick = vi.fn();
    const s = createEmailScheduler(tick);
    s.start();
    s.start(); // a second start is a no-op
    vi.advanceTimersByTime(FIRST_SYNC_DELAY_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick.mock.calls).toEqual([['launch']]);
    vi.advanceTimersByTime(SYNC_EVERY_MS - FIRST_SYNC_DELAY_MS);
    expect(tick.mock.calls).toEqual([['launch'], ['interval']]);
    vi.advanceTimersByTime(SYNC_EVERY_MS);
    expect(tick.mock.calls).toEqual([['launch'], ['interval'], ['interval']]);
  });

  it('syncs once shortly after the Mac wakes, however many wake events arrive', () => {
    const tick = vi.fn();
    const s = createEmailScheduler(tick);
    s.start();
    vi.advanceTimersByTime(FIRST_SYNC_DELAY_MS);
    tick.mockClear();

    s.resumed();
    vi.advanceTimersByTime(10_000);
    s.resumed(); // macOS can post wake twice
    vi.advanceTimersByTime(RESUME_DELAY_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick.mock.calls).toEqual([['resume']]);
    // Long enough for Wi-Fi to come back, short enough that a day asleep is caught up within a minute.
    expect(RESUME_DELAY_MS).toBeGreaterThanOrEqual(15_000);
    expect(RESUME_DELAY_MS).toBeLessThanOrEqual(60_000);
  });

  it('ignores a wake before the scheduler has started (no database yet)', () => {
    const tick = vi.fn();
    const s = createEmailScheduler(tick);
    s.resumed();
    vi.advanceTimersByTime(RESUME_DELAY_MS * 2);
    expect(tick).not.toHaveBeenCalled();
  });
});

// When inbox sync runs: a minute after launch, every half hour, and shortly
// after the Mac wakes. Pure apart from the timers, which are injectable.
//
// The wake trigger matters because timers do not count time asleep on macOS:
// a laptop shut for a day would otherwise wait out the rest of its half hour
// after waking (and a run during a dark wake fails with no network anyway).
// What a catch-up run reads after a long gap is sync.ts's business: it looks
// back from the last sync, so the whole gap is covered.

export const FIRST_SYNC_DELAY_MS = 60_000;
export const SYNC_EVERY_MS = 30 * 60_000;
/** After a wake, Wi-Fi needs a moment before IMAP or Claude can be reached. */
export const RESUME_DELAY_MS = 45_000;

export type SyncReason = 'launch' | 'interval' | 'resume';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
};

export interface EmailScheduler {
  /** Arm the launch run and the half-hourly runs. Once only. */
  start(): void;
  /** The Mac woke: one run shortly after, however many wake events arrive. */
  resumed(): void;
}

export function createEmailScheduler(tick: (reason: SyncReason) => void, timers: Timers = realTimers): EmailScheduler {
  let started = false;
  let wake: unknown = null;
  return {
    start() {
      if (started) return;
      started = true;
      timers.setTimeout(() => tick('launch'), FIRST_SYNC_DELAY_MS);
      timers.setInterval(() => tick('interval'), SYNC_EVERY_MS);
    },
    resumed() {
      if (!started) return; // no database yet: the launch run covers it
      if (wake !== null) timers.clearTimeout(wake);
      wake = timers.setTimeout(() => { wake = null; tick('resume'); }, RESUME_DELAY_MS);
    },
  };
}

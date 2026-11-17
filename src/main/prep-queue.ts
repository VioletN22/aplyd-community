// A small keyed work queue: at most `concurrency` jobs run at once, and a job
// whose key is already queued or running is not added twice (the caller gets
// the pending job's promise instead). Pure: the worker is injected, so the
// concurrency and dedupe rules are unit tested without Claude or a database.
//
// This sits above claude.ts's own two-process semaphore, not instead of it: a
// prep job makes several claude calls in a row, and capping jobs at two keeps a
// burst of adds from queueing a dozen letters in front of their own clicks.

export interface PrepQueueOpts<T> {
  concurrency?: number;
  keyOf: (job: T) => string;
  /** Called with a worker's error; the queue itself never rejects on it. */
  onError?: (err: unknown, job: T) => void;
}

interface Entry<T> { job: T; key: string; done: Promise<void>; resolve: () => void }

export class PrepQueue<T> {
  private readonly concurrency: number;
  private readonly waiting: Entry<T>[] = [];
  private readonly live = new Map<string, Entry<T>>();
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly worker: (job: T) => Promise<void>, private readonly opts: PrepQueueOpts<T>) {
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
  }

  /** Queue a job. Resolves when it (or the identical job already pending) finishes; never rejects. */
  enqueue(job: T): Promise<void> {
    const key = this.opts.keyOf(job);
    const existing = this.live.get(key);
    if (existing) return existing.done;
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    const entry: Entry<T> = { job, key, done, resolve };
    this.live.set(key, entry);
    this.waiting.push(entry);
    this.pump();
    return done;
  }

  /** Is a job with this key queued or running? */
  has(key: string): boolean { return this.live.has(key); }

  get running(): number { return this.active; }
  get queued(): number { return this.waiting.length; }

  /** Resolves once nothing is queued or running. */
  idle(): Promise<void> {
    if (!this.active && !this.waiting.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length) {
      const entry = this.waiting.shift()!;
      this.active++;
      let run: Promise<void>;
      try { run = Promise.resolve(this.worker(entry.job)); } catch (e) { run = Promise.reject(e); }
      run
        .catch((e) => { try { this.opts.onError?.(e, entry.job); } catch { /* a logger must not break the queue */ } })
        .finally(() => {
          this.active--;
          this.live.delete(entry.key);
          entry.resolve();
          this.pump();
          if (!this.active && !this.waiting.length) {
            const ws = this.idleWaiters; this.idleWaiters = [];
            for (const w of ws) w();
          }
        });
    }
  }
}

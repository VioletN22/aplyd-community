import { describe, it, expect } from 'vitest';
import { PrepQueue } from '../prep-queue';

function deferred() {
  let resolve!: () => void; let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('PrepQueue', () => {
  it('runs at most two jobs at once and drains the rest in order', async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    let peak = 0; let now = 0;
    const q = new PrepQueue<string>(async (id) => {
      started.push(id); now++; peak = Math.max(peak, now);
      const g = deferred(); gates.set(id, g);
      try { await g.promise; } finally { now--; }
    }, { keyOf: (id) => id });
    for (const id of ['a', 'b', 'c', 'd']) q.enqueue(id);
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(q.running).toBe(2);
    expect(q.queued).toBe(2);
    gates.get('a')!.resolve();
    await tick(); await tick();
    expect(started).toEqual(['a', 'b', 'c']);
    gates.get('b')!.resolve(); gates.get('c')!.resolve();
    await tick(); await tick();
    gates.get('d')!.resolve();
    await q.idle();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    expect(peak).toBe(2);
  });

  it('does not queue the same key twice while it is pending', async () => {
    let runs = 0;
    const g = deferred();
    const q = new PrepQueue<{ id: string }>(async () => { runs++; await g.promise; }, { keyOf: (j) => j.id });
    const p1 = q.enqueue({ id: 'x' });
    const p2 = q.enqueue({ id: 'x' });
    expect(p1).toBe(p2);
    expect(q.has('x')).toBe(true);
    g.resolve();
    await p1;
    expect(runs).toBe(1);
    expect(q.has('x')).toBe(false);
    await q.enqueue({ id: 'x' });
    expect(runs).toBe(2);
  });

  it('keeps going after a worker throws, and reports the error', async () => {
    const errors: string[] = [];
    const done: string[] = [];
    const q = new PrepQueue<string>(async (id) => {
      if (id === 'bad') throw new Error('boom');
      done.push(id);
    }, { keyOf: (id) => id, concurrency: 1, onError: (e, id) => errors.push(id + ':' + (e as Error).message) });
    await Promise.all([q.enqueue('bad'), q.enqueue('ok')]);
    expect(errors).toEqual(['bad:boom']);
    expect(done).toEqual(['ok']);
  });

  it('survives a synchronous throw from the worker', async () => {
    const errors: unknown[] = [];
    const q = new PrepQueue<string>(((_id: string) => { throw new Error('sync'); }) as any, { keyOf: (s) => s, onError: (e) => errors.push(e) });
    await q.enqueue('a');
    expect(errors).toHaveLength(1);
  });
});

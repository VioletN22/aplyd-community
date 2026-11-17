// In-process application events. Emitters never wait on, or fail because of, a
// listener: each listener runs inside its own try/catch and its error is logged.

export type AppEvent = { type: 'application:added'; id: string } | { type: 'application:stage'; id: string; from: string|null; to: string };

const listeners = new Set<(e: AppEvent) => void>();

export function onAppEvent(fn: (e: AppEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitAppEvent(e: AppEvent): void {
  for (const fn of Array.from(listeners)) {
    try { fn(e); } catch (err) { console.error('[events] listener failed for', e.type, err); }
  }
}

// ── Compatibility with the quick-add branch ──────────────────────────────────
// Quick add emits a richer payload through these two names. They ride on the
// same bus: emitApplicationAdded is an application:added event, and
// onApplicationAdded hears every application:added (with the rich payload when
// one was emitted this way, otherwise just the id).

export interface ApplicationAddedEvent {
  applicationId: string;
  company: string;
  role: string;
  jobUrl: string;
  /** Which path created the row. */
  via: 'quick-add' | 'ui';
  /** True when the row is a placeholder (the posting could not be read yet). */
  partial?: boolean;
}

const richPayloads = new Map<string, ApplicationAddedEvent>();

export function emitApplicationAdded(e: ApplicationAddedEvent): void {
  richPayloads.set(e.applicationId, e);
  try { emitAppEvent({ type: 'application:added', id: e.applicationId }); }
  finally { richPayloads.delete(e.applicationId); }
}

export function onApplicationAdded(fn: (e: ApplicationAddedEvent) => void | Promise<void>): () => void {
  return onAppEvent((e) => {
    if (e.type !== 'application:added') return;
    const payload = richPayloads.get(e.id) || { applicationId: e.id, company: '', role: '', jobUrl: '', via: 'ui' as const };
    const r = fn(payload);
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch((err) => console.error('[events] application:added listener rejected', err));
    }
  });
}

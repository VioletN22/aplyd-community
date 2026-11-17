import { describe, it, expect, vi } from 'vitest';
import { onAppEvent, emitAppEvent, type AppEvent } from '../events';

describe('app events', () => {
  it('delivers to every listener until unsubscribed', () => {
    const seen: AppEvent[] = [];
    const off = onAppEvent((e) => seen.push(e));
    emitAppEvent({ type: 'application:added', id: 'a1' });
    off();
    emitAppEvent({ type: 'application:added', id: 'a2' });
    expect(seen).toEqual([{ type: 'application:added', id: 'a1' }]);
  });

  it('never throws, and a failing listener does not stop the others', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const off1 = onAppEvent(() => { throw new Error('bad listener'); });
    const off2 = onAppEvent((e) => seen.push(e.type));
    expect(() => emitAppEvent({ type: 'application:stage', id: 'a1', from: 'applied', to: 'interview' })).not.toThrow();
    expect(seen).toEqual(['application:stage']);
    expect(err).toHaveBeenCalled();
    off1(); off2(); err.mockRestore();
  });
});

import { emitApplicationAdded, onApplicationAdded } from '../events';

describe('quick-add compatibility wrappers', () => {
  it('emitApplicationAdded is an application:added event, with the rich payload for onApplicationAdded', () => {
    const plain: AppEvent[] = [];
    const rich: unknown[] = [];
    const off1 = onAppEvent((e) => plain.push(e));
    const off2 = onApplicationAdded((e) => { rich.push(e); });
    const payload = { applicationId: 'q1', company: 'Acme', role: 'Dev', jobUrl: '', via: 'quick-add' as const, partial: true };
    emitApplicationAdded(payload);
    emitAppEvent({ type: 'application:added', id: 'u1' });
    emitAppEvent({ type: 'application:stage', id: 'u1', from: 'applied', to: 'interview' });
    off1(); off2();
    expect(plain.filter((e) => e.type === 'application:added')).toEqual([
      { type: 'application:added', id: 'q1' }, { type: 'application:added', id: 'u1' },
    ]);
    expect(rich).toEqual([payload, { applicationId: 'u1', company: '', role: '', jobUrl: '', via: 'ui' }]);
  });
});

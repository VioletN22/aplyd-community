import { describe, it, expect, vi } from 'vitest';
import { attachEscape } from '../escape';

const key = (name: string) => Object.assign(new Event('keydown', { cancelable: true }), { key: name });

describe('attachEscape', () => {
  it('cancels on Escape and ignores other keys', () => {
    const target = new EventTarget();
    const onEscape = vi.fn();
    attachEscape(target, onEscape);
    target.dispatchEvent(key('Enter'));
    expect(onEscape).not.toHaveBeenCalled();
    const esc = key('Escape');
    target.dispatchEvent(esc);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
  });

  it('stops listening once detached', () => {
    const target = new EventTarget();
    const onEscape = vi.fn();
    const detach = attachEscape(target, onEscape);
    detach();
    target.dispatchEvent(key('Escape'));
    expect(onEscape).not.toHaveBeenCalled();
  });
});

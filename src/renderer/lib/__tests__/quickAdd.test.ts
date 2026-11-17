import { describe, it, expect } from 'vitest';
import { formatAccelerator } from '../quickAdd';

describe('formatAccelerator', () => {
  it('renders modifiers as Mac symbols in menu order', () => {
    expect(formatAccelerator('Control+Command+J')).toBe('⌃⌘J');
    expect(formatAccelerator('Command+Shift+Alt+k')).toBe('⌥⇧⌘K');
    expect(formatAccelerator('CmdOrCtrl+Space')).toBe('⌘Space');
  });
  it('passes unknown keys through and survives empty input', () => {
    expect(formatAccelerator('Ctrl+F5')).toBe('⌃F5');
    expect(formatAccelerator('')).toBe('');
  });
});

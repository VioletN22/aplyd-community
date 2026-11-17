/**
 * Quick add: a global shortcut in main that turns whatever job ad or link is on
 * the clipboard into an application. The preload half may not exist in an
 * older main process, so every caller goes through quickAddApi() and copes
 * with undefined.
 */

type IpcResult<T = void> = Promise<{ ok: boolean; data?: T; error?: string }>;

export interface QuickAddShortcut { shortcut: string; error: string | null }

export interface QuickAddApi {
  onAdded(cb: (p: { applicationId: string; open: boolean }) => void): () => void;
  getShortcut(): IpcResult<QuickAddShortcut>;
  setShortcut(accel: string): IpcResult<unknown>;
}

export const quickAddApi = (): QuickAddApi | undefined =>
  (window.electronAPI as unknown as { quickAdd?: QuickAddApi } | undefined)?.quickAdd;

// Mac menu order: Control, Option, Shift, Command.
const MODIFIERS: { names: string[]; symbol: string; rank: number }[] = [
  { names: ['control', 'ctrl'], symbol: '⌃', rank: 0 },
  { names: ['alt', 'option', 'altgr'], symbol: '⌥', rank: 1 },
  { names: ['shift'], symbol: '⇧', rank: 2 },
  { names: ['command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'super', 'meta'], symbol: '⌘', rank: 3 },
];

const KEYS: Record<string, string> = {
  space: 'Space', enter: '↩', return: '↩', tab: '⇥', backspace: '⌫', delete: '⌦',
  escape: '⎋', esc: '⎋', up: '↑', down: '↓', left: '←', right: '→', plus: '+',
};

/** "Control+Command+J" as the Mac shows it: "⌃⌘J". Unknown parts pass through. */
export function formatAccelerator(accel: string): string {
  const parts = String(accel || '').split('+').map((p) => p.trim()).filter(Boolean);
  const mods: { symbol: string; rank: number }[] = [];
  const keys: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    const mod = MODIFIERS.find((m) => m.names.includes(lower));
    if (mod) { if (!mods.some((m) => m.symbol === mod.symbol)) mods.push(mod); continue; }
    keys.push(KEYS[lower] ?? (part.length === 1 ? part.toUpperCase() : part));
  }
  return mods.sort((a, b) => a.rank - b.rank).map((m) => m.symbol).join('') + keys.join('');
}

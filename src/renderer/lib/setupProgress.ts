export const SETUP_KEY = 'community-setup-v1';
export const SETUP_STEPS = ['welcome', 'profile', 'ai', 'email', 'calendar', 'skills', 'ready'] as const;
export type SetupStep = typeof SETUP_STEPS[number];
export type SettingsSection = Exclude<SetupStep, 'welcome' | 'ready'>;
export type SetupChoice = 'reviewed' | 'skipped';
export interface SetupProgress {
  step: SetupStep;
  paused: boolean;
  finished: boolean;
  choices: Partial<Record<SetupStep, SetupChoice>>;
}
export function readSetupProgress(raw: string | null): SetupProgress {
  const empty: SetupProgress = { step: 'welcome', paused: false, finished: false, choices: {} };
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw);
    if (!value || !SETUP_STEPS.includes(value.step) || !value.choices || typeof value.choices !== 'object') return empty;
    const choices: SetupProgress['choices'] = {};
    for (const step of SETUP_STEPS) {
      if (value.choices[step] === 'reviewed' || value.choices[step] === 'skipped') choices[step] = value.choices[step];
    }
    return { step: value.step, paused: value.paused === true, finished: value.finished === true, choices };
  } catch { return empty; }
}
export function advanceSetup(state: SetupProgress, choice: SetupChoice): SetupProgress {
  return { ...state, step: SETUP_STEPS[Math.min(SETUP_STEPS.indexOf(state.step) + 1, SETUP_STEPS.length - 1)], choices: { ...state.choices, [state.step]: choice } };
}

export function reopenSetup(state: SetupProgress): SetupProgress {
  return { ...state, paused: false, finished: false };
}

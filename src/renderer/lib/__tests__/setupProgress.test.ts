import { describe, expect, it } from 'vitest';
import { readSetupProgress, advanceSetup, reopenSetup } from '../setupProgress';

describe('setup progress', () => {
  it('starts a new workspace at welcome', () => {
    expect(readSetupProgress(null)).toEqual({ step: 'welcome', paused: false, finished: false, choices: {} });
  });
  it('recovers safely from corrupt or obsolete storage', () => {
    for (const raw of ['{', 'null', '{"step":"missing"}', '{"step":"email","choices":null}']) {
      expect(readSetupProgress(raw).step).toBe('welcome');
    }
  });
  it('resumes a paused step without treating it as connected', () => {
    const state = readSetupProgress(JSON.stringify({ step: 'email', paused: true, finished: false, choices: { ai: 'reviewed', profile: 'skipped', email: 'connected' } }));
    expect(state.step).toBe('email');
    expect(state.paused).toBe(true);
    expect(state.choices).toEqual({ ai: 'reviewed', profile: 'skipped' });
  });
  it('keeps an optional skip when moving to the next step', () => {
    const state = { ...readSetupProgress(null), step: 'ai' as const };
    expect(advanceSetup(state, 'skipped')).toMatchObject({ step: 'email', choices: { ai: 'skipped' }, finished: false });
  });
  it('resumes a reopened completed guide after restarting', () => {
    const completed = { ...readSetupProgress(null), step: 'ready' as const, finished: true, choices: { ai: 'skipped' as const } };
    const reopened = reopenSetup(completed);
    const restarted = readSetupProgress(JSON.stringify({ ...reopened, step: 'email' }));
    expect(restarted.finished).toBe(false);
    expect(restarted.paused).toBe(false);
    expect(restarted.step).toBe('email');
    expect(restarted.choices).toEqual({ ai: 'skipped' });
  });
  it('does not finish just because the user reached ready', () => {
    const state = { ...readSetupProgress(null), step: 'skills' as const };
    expect(advanceSetup(state, 'reviewed')).toMatchObject({ step: 'ready', finished: false });
  });
});

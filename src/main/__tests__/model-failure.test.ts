import { describe, it, expect } from 'vitest';
import { isModelUnavailable, explainModelFailure } from '../email/sync';

// Regression tests for the AI-not-configured messages. The no-key error text
// contains the word "login", which the signed-out matcher would otherwise claim.
describe('explainModelFailure for an unconfigured provider', () => {
  const noKey = new Error('Add an Anthropic API key in Settings. Claude Code login is separate.');
  const noProvider = new Error('AI is optional. Choose a provider in Settings to use this feature; manual tracking remains available.');

  it('tells a no-key user to add their Anthropic key, not to run the CLI', () => {
    const msg = explainModelFailure(noKey);
    expect(msg).toMatch(/Anthropic API key/i);
    expect(msg).not.toMatch(/run claude|type \/login/i);
  });

  it('tells a no-provider user to choose a provider in Settings', () => {
    const msg = explainModelFailure(noProvider);
    expect(msg).toMatch(/choose an AI provider/i);
    expect(msg).not.toMatch(/run claude/i);
  });

  it('treats both as a global stop so the run does not classify every email', () => {
    expect(isModelUnavailable(noKey)).toBe(true);
    expect(isModelUnavailable(noProvider)).toBe(true);
  });

  it('still recognises a genuine signed-out failure', () => {
    const signedOut = new Error('OAuth token expired: please log in again (401)');
    expect(isModelUnavailable(signedOut)).toBe(true);
    expect(explainModelFailure(signedOut)).toMatch(/signed out/i);
  });
});

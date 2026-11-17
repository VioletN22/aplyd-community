import { describe, it, expect, vi } from 'vitest';

// Only the pure prompt builder and the schema are exercised. The module's
// imports reach the database and electron at the top, so stub them out.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
}));
vi.mock('../database', () => ({}));
vi.mock('../letter-context', () => ({ resumeTextForJob: async () => ({ text: '', primary: '', primaryDocId: null }) }));

import { FIT_SCHEMA, fitScorePrompt, type FitContext } from '../fit';

const ctx: FitContext = {
  company: 'Acme',
  role: 'Engineer',
  posting: 'React role building an internal platform',
  resumeText: 'PRIMARY RESUME for this job: RESUME BODY\n\nOTHER RESUME VARIANTS: RETAIL VARIANT',
};

describe('FIT_SCHEMA', () => {
  it('is a bounded integer score plus its reasons, nothing extra', () => {
    expect(FIT_SCHEMA.properties.score).toEqual({ type: 'integer', minimum: 0, maximum: 10 });
    expect(FIT_SCHEMA.required).toEqual(['score', 'missing', 'reason']);
    expect(FIT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('fitScorePrompt', () => {
  it('carries the target, the posting and every resume variant', () => {
    const p = fitScorePrompt(ctx);
    expect(p).toContain('TARGET: Engineer at Acme');
    expect(p).toContain('React role building an internal platform');
    expect(p).toContain('RESUME BODY');
    expect(p).toContain('RETAIL VARIANT');
  });

  it('scores against the resumes only, never a corpus', () => {
    const p = fitScorePrompt(ctx);
    expect(p).toContain('Judge only on the resumes above');
    expect(p).not.toMatch(/corpus|approved work history/i);
  });

  it('asks for the 0 to 10 score, the missing list and a one-sentence reason', () => {
    const p = fitScorePrompt(ctx);
    expect(p).toContain('score: 0 to 10');
    expect(p).toContain('missing:');
    expect(p).toContain('reason: one sentence');
  });

  it('uses no em dashes', () => {
    expect(fitScorePrompt(ctx)).not.toContain('—');
  });

  it('caps a long posting', () => {
    const p = fitScorePrompt({ ...ctx, posting: 'x'.repeat(9000) });
    expect(p).toContain('x'.repeat(6000));
    expect(p).not.toContain('x'.repeat(6001));
  });

  it('says so when there is no posting or resume', () => {
    const p = fitScorePrompt({ ...ctx, posting: '', resumeText: '' });
    expect(p).toContain('(no posting text stored)');
    expect(p).toContain('(no resume on file)');
  });
});

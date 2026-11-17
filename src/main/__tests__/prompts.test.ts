import { describe, it, expect, vi } from 'vitest';

// The prompt builders under test are pure. The module still imports the DB for the
// thin profile/facts helpers used by the non-letter prompts, and the DB pulls in
// electron, so stub it out: nothing here should touch it.
vi.mock('../database', () => ({
  getAnswerBank: () => [],
  getDocuments: () => [],
  getVoiceNotes: () => [],
  getPortfolioLinks: () => [],
  getSetting: () => null,
}));

import {
  coverLetterPrompt, refineCoverLetterPrompt, coverLetterStudioPrompt, distillVoicePrompt,
  LETTER_SCHEMA, STUDIO_SCHEMA, DISTILL_SCHEMA, LETTER_RULES,
  type LetterContext,
} from '../autopilot-prompts';

const ctx: LetterContext = {
  company: 'Acme', role: 'Engineer', rawJobText: 'React role...',
  profile: { 'Email': 'e@x.com', 'Phone': '04', 'Full name': 'Alex Morgan', 'Salary expectation': '90000', 'Notice period': '1 week' },
  facts: [{ label: 'What is your expected salary', value: '90000' }, { label: 'Years of experience', value: '2' }],
  voice: { follow: ['plain confident sentences'], avoid: ['corporate filler'] },
  exemplars: ['Dear Hiring Manager,\nKept letter one...'], resumeText: 'RESUME BODY', researchText: '', portfolioText: '',
};

describe('letter prompts', () => {
  it('letter prompt carries resume, raw posting, template rules', () => {
    const p = coverLetterPrompt(ctx);
    expect(p).toContain('RESUME BODY');
    expect(p).toContain('React role');
    expect(p).toContain('Dear Hiring Manager,');
    expect(p).toContain('Sincerely,');
    expect(p).toContain('never use em dashes');
  });

  it('salary and notice are excluded from letter prompts', () => {
    const p = coverLetterPrompt(ctx);
    expect(p).not.toContain('90000');
    expect(p).not.toContain('Notice period');
  });

  it('refine prompt carries resume, posting and feedback', () => {
    const p = refineCoverLetterPrompt({ ...ctx, body: 'DRAFT', feedback: 'more php' });
    expect(p).toContain('RESUME BODY'); expect(p).toContain('React role');
    expect(p).toContain('DRAFT'); expect(p).toContain('more php');
  });

  it('exemplars are framed as voice not content', () => {
    expect(coverLetterPrompt(ctx)).toMatch(/match their voice, not their content/i);
  });

  it('prompt caps raw job text at 6000 chars', () => {
    const p = coverLetterPrompt({ ...ctx, rawJobText: 'x'.repeat(9000) });
    expect(p.length).toBeLessThan(9000 + 4000);
    // a genuinely huge posting must still land inside the cap plus the fixed scaffolding
    const huge = coverLetterPrompt({ ...ctx, rawJobText: 'x'.repeat(50000) });
    expect(huge.length).toBeLessThan(6000 + 4000);
  });

  it('falls back to the job summary when there is no raw posting', () => {
    const p = coverLetterPrompt({ ...ctx, rawJobText: undefined, jobSummary: 'SUMMARY ONLY' });
    expect(p).toContain('SUMMARY ONLY');
  });

  it('studio prompt shares the locked template and asks for questions', () => {
    const p = coverLetterStudioPrompt(ctx);
    expect(p).toContain(LETTER_RULES);
    expect(p).toContain('RESUME BODY');
    expect(p).not.toContain('90000');
    expect(p).toMatch(/questions/i);
  });

  it('refine prompt keeps salary and notice out too', () => {
    const p = refineCoverLetterPrompt({ ...ctx, body: 'DRAFT', feedback: 'more php' });
    expect(p).not.toContain('90000');
    expect(p).not.toContain('Notice period');
  });

  it('no em dashes anywhere in generated prompt text', () => {
    expect(coverLetterPrompt(ctx)).not.toContain('—');
    expect(refineCoverLetterPrompt({ ...ctx, body: 'D', feedback: 'f' })).not.toContain('—');
    expect(coverLetterStudioPrompt(ctx)).not.toContain('—');
    expect(distillVoicePrompt(['note'], 'guide')).not.toContain('—');
  });
});

describe('distillVoicePrompt', () => {
  it('carries the raw notes, the voice guide, and the drop rules', () => {
    const p = distillVoicePrompt(['make it punchier', 'add my php work at Acme'], 'GUIDE TEXT');
    expect(p).toContain('make it punchier');
    expect(p).toContain('GUIDE TEXT');
    expect(p).toMatch(/one-off content request/i);
    expect(p).toMatch(/question to the assistant/i);
    expect(p).toMatch(/follow/i);
    expect(p).toMatch(/avoid/i);
  });

  it('tolerates an empty guide and no notes', () => {
    const p = distillVoicePrompt([], '');
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
  });
});

describe('schemas', () => {
  it('LETTER_SCHEMA is a strict {letter, note} object', () => {
    expect(LETTER_SCHEMA).toEqual({
      type: 'object',
      properties: { letter: { type: 'string' }, note: { type: 'string' } },
      required: ['letter', 'note'],
      additionalProperties: false,
    });
  });

  it('STUDIO_SCHEMA adds a questions array', () => {
    const s = STUDIO_SCHEMA as any;
    expect(s.properties.questions).toEqual({ type: 'array', items: { type: 'string' } });
    expect(s.required).toContain('questions');
    expect(s.additionalProperties).toBe(false);
  });

  it('DISTILL_SCHEMA is {follow, avoid} string arrays', () => {
    const s = DISTILL_SCHEMA as any;
    expect(s.properties.follow).toEqual({ type: 'array', items: { type: 'string' } });
    expect(s.properties.avoid).toEqual({ type: 'array', items: { type: 'string' } });
    expect(s.required).toEqual(['follow', 'avoid']);
    expect(s.additionalProperties).toBe(false);
  });
});

// The studio's free-text "extra" arrives as a first-class fact, so it is
// attributed to the user and cannot be cut off by the raw-posting cap.
describe('extra context from the studio', () => {
  it('rides in as a labelled fact', () => {
    const p = coverLetterPrompt({
      ...ctx,
      facts: [{ label: 'Extra context the user gave for this letter', value: 'EXTRA NOTE' }, ...ctx.facts],
    });
    expect(p).toContain('EXTRA NOTE');
    expect(p).toContain('Extra context the user gave for this letter');
  });
});

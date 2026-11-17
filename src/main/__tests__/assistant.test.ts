import { describe, it, expect, vi } from 'vitest';

// assistant.ts reaches the database and the claude subprocess at call time, never
// at import time, but the modules it pulls in (database, letter-context) import
// electron at the top. Only the pure prompt builder is exercised here.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
}));

import {
  ASSISTANT_SCHEMA, HISTORY_TURNS, assistantPrompt,
  type AssistantContext,
} from '../assistant';

const ctx: AssistantContext = {
  company: 'Acme',
  role: 'Engineer',
  posting: 'React role building an internal platform',
  research: 'Acme builds logistics software in Sydney.',
  profile: { 'Full name': 'Alex Morgan', Email: 'e@x.com', Phone: '04' },
  facts: [{ label: 'Years of experience', value: '2' }],
  resumeText: 'PRIMARY RESUME for this job: RESUME BODY\n\nOTHER RESUME VARIANTS: RETAIL VARIANT BODY',
  portfolioText: 'PORTFOLIO BODY',
  voice: { follow: ['plain confident sentences'], avoid: ['corporate filler'] },
  letter: 'Dear Hiring Manager, LETTER DRAFT BODY',
  fitScore: 7,
  fitReason: 'Strong platform overlap, no logistics domain yet.',
  history: [
    { role: 'user', text: 'EARLIER QUESTION' },
    { role: 'assistant', text: 'EARLIER ANSWER' },
  ],
  message: 'What are your qualifications?',
};

describe('assistantPrompt', () => {
  it('carries this application: the posting, the fit score, the research', () => {
    const p = assistantPrompt(ctx);
    expect(p).toContain('Engineer at Acme');
    expect(p).toContain('React role building an internal platform');
    expect(p).toContain('7 out of 10');
    expect(p).toContain('Strong platform overlap');
    expect(p).toContain('Acme builds logistics software');
  });

  it('carries everything about the user: every resume variant, letter, facts, profile, voice', () => {
    const p = assistantPrompt(ctx);
    expect(p).toContain("THE USER'S RESUMES");
    expect(p).toContain('RESUME BODY');
    expect(p).toContain('RETAIL VARIANT BODY');
    expect(p).toContain('LETTER DRAFT BODY');
    expect(p).toContain('Years of experience: 2');
    expect(p).toContain('Alex Morgan');
    expect(p).toContain('PORTFOLIO BODY');
    expect(p).toContain('plain confident sentences');
    expect(p).toContain('corporate filler');
  });

  it('carries the conversation and the message being answered', () => {
    const p = assistantPrompt(ctx);
    expect(p).toContain('EARLIER QUESTION');
    expect(p).toContain('EARLIER ANSWER');
    expect(p).toContain('THE USER JUST SAID:\nWhat are your qualifications?');
  });

  it('states the first-person rule for form questions', () => {
    const p = assistantPrompt(ctx);
    expect(p).toContain('AS THE USER, in the first person');
    expect(p).toContain('ready to paste');
  });

  it('states the no-invention rule', () => {
    const p = assistantPrompt(ctx);
    expect(p).toContain('Never invent employers');
    expect(p).toContain('Ground every claim in the material above');
    expect(p).toMatch(/Never state a duration of experience/);
  });

  it('bans em dashes and markdown, and contains none itself', () => {
    const p = assistantPrompt(ctx);
    expect(p).toContain('never use em dashes');
    expect(p).toContain('no markdown headers');
    expect(p).not.toContain('—');
  });

  it('degrades safely when the application has almost nothing on it', () => {
    const bare = assistantPrompt({
      company: 'Acme',
      role: 'Engineer',
      posting: '',
      profile: {},
      facts: [],
      voice: { follow: [], avoid: [] },
      history: [],
      message: 'Why do you want to work here?',
    });
    expect(bare).toContain('(no posting text stored)');
    expect(bare).not.toContain("THE USER'S RESUMES");
    expect(bare).not.toContain("THE USER'S COVER LETTER DRAFT");
    expect(bare).not.toContain('COMPANY RESEARCH');
    expect(bare).toContain('Why do you want to work here?');
  });

  it('caps the posting so one long listing cannot swallow the turn', () => {
    const long = assistantPrompt({ ...ctx, posting: 'x'.repeat(9000) });
    expect(long).toContain('x'.repeat(6000));
    expect(long).not.toContain('x'.repeat(6001));
  });
});

describe('ASSISTANT_SCHEMA', () => {
  it('is the { reply, formAnswer: { question, answer } } contract, nullable inside', () => {
    expect(ASSISTANT_SCHEMA).toEqual({
      type: 'object',
      properties: {
        reply: { type: 'string' },
        formAnswer: {
          type: 'object',
          properties: {
            question: { type: ['string', 'null'] },
            answer: { type: ['string', 'null'] },
          },
          required: ['question', 'answer'],
          additionalProperties: false,
        },
      },
      required: ['reply', 'formAnswer'],
      additionalProperties: false,
    });
  });
});

describe('HISTORY_TURNS', () => {
  it('keeps the last dozen turns', () => {
    expect(HISTORY_TURNS).toBe(12);
  });
});

describe('no corpus', () => {
  it('never asks for or prints an approved work history block', () => {
    const p = assistantPrompt(ctx);
    expect(p).not.toContain('APPROVED WORK HISTORY');
    expect(p).not.toMatch(/corpus/i);
  });
});

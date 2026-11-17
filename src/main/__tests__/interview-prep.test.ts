import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: class {} }));
vi.mock('../database', () => ({}));
vi.mock('../letter-context', () => ({ resumeTextForJob: async () => ({ text: '', primary: '', primaryDocId: null }) }));

import {
  INTERVIEW_PREP_SCHEMA, interviewPrepPrompt, renderInterviewPrep, noDashes, PREP_STAGES, type InterviewPrepData,
} from '../interview-prep';

describe('INTERVIEW_PREP_SCHEMA', () => {
  it('is strict and bounds the counts', () => {
    expect(INTERVIEW_PREP_SCHEMA.additionalProperties).toBe(false);
    expect(INTERVIEW_PREP_SCHEMA.required).toEqual(['company_snapshot', 'questions', 'stories']);
    expect(INTERVIEW_PREP_SCHEMA.properties.questions).toMatchObject({ minItems: 8, maxItems: 10 });
    expect(INTERVIEW_PREP_SCHEMA.properties.stories).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(INTERVIEW_PREP_SCHEMA.properties.stories.items.required).toContain('evidence');
    expect(INTERVIEW_PREP_SCHEMA.properties.stories.items.required).toContain('answers_question');
  });
});

describe('interviewPrepPrompt', () => {
  const ctx = { company: 'Canva', role: 'Frontend Engineer', stage: 'phone_screen', posting: 'POSTING TEXT', research: 'RESEARCH TEXT', resumeText: 'RESUME TEXT' };
  it('carries posting, cached research and resumes', () => {
    const p = interviewPrepPrompt(ctx);
    expect(p).toContain('a phone screen for Frontend Engineer at Canva');
    expect(p).toContain('POSTING TEXT');
    expect(p).toContain('RESEARCH TEXT');
    expect(p).toContain('RESUME TEXT');
    expect(p).toContain('8 to 10 questions');
    expect(p).toContain('3 to 5 stories');
    expect(p).not.toMatch(/—/);
  });
  it('says so when there is no research', () => {
    expect(interviewPrepPrompt({ ...ctx, stage: 'interview', research: '' })).toContain('(none saved)');
  });
});

describe('renderInterviewPrep', () => {
  const data: InterviewPrepData = {
    company_snapshot: 'Canva makes design tools — used everywhere.',
    questions: Array.from({ length: 8 }, (_, i) => ({ question: `Question ${i + 1}?`, why: 'checks x' })),
    stories: [
      { title: 'Shipped the tracker', story: 'I built it.', evidence: 'Built aplyd in Electron', answers_question: 2 },
      { title: 'Bad ref', story: 'Something.', evidence: 'Line', answers_question: 99 },
      { title: 'Retail rush', story: 'I handled it.', evidence: 'Managed Christmas peak', answers_question: 8 },
    ],
  };
  it('renders the three sections with numbered questions and linked stories', () => {
    const md = renderInterviewPrep(data, { company: 'Canva', role: 'Frontend Engineer' });
    expect(md).toContain('# Interview prep: Frontend Engineer at Canva');
    expect(md).toContain('## Company snapshot');
    expect(md).toContain('1. Question 1? _(checks x)_');
    expect(md).toContain('8. Question 8?');
    expect(md).toContain('### Shipped the tracker (answers Q2)');
    expect(md).toContain('> Evidence: Built aplyd in Electron');
    expect(md).toContain('### Bad ref\n');
    expect(md).toContain('### Retail rush (answers Q8)');
  });
  it('never contains em or en dashes', () => {
    const md = renderInterviewPrep(data, { company: 'A–B', role: 'R' });
    expect(md).not.toMatch(/[—–]/);
    expect(noDashes('a — b')).toBe('a, b');
  });
  it('only phone screens and interviews get a sheet', () => {
    expect([...PREP_STAGES].sort()).toEqual(['interview', 'phone_screen']);
  });
});

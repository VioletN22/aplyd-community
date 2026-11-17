// Interview prep sheet: when an application reaches phone_screen or interview,
// one page of markdown lands in applications.prep_notes. Company snapshot from
// CACHED research only (no live crawl), 8 to 10 likely questions for this role,
// and 3 to 5 stories from their resumes, each with its evidence line and the
// question it answers.
//
// Pure halves (schema, prompt, markdown render) are unit tested; buildInterviewPrep
// is the side effect.
import { getApplication, getRawJobText, getCompanyResearch, updateApplication } from './database';
import { runClaudeJSON, getPreferredModel, SYS } from './claude';
import { resumeTextForJob } from './letter-context';

const POSTING_CAP = 6000;
const RESEARCH_CAP = 5000;
const RESUME_CAP = 26000;

/** Stages that earn a prep sheet. */
export const PREP_STAGES = new Set(['phone_screen', 'interview']);

export const INTERVIEW_PREP_SCHEMA = {
  type: 'object',
  properties: {
    company_snapshot: { type: 'string' },
    questions: {
      type: 'array', minItems: 8, maxItems: 10,
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, why: { type: 'string' } },
        required: ['question', 'why'],
        additionalProperties: false,
      },
    },
    stories: {
      type: 'array', minItems: 3, maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          story: { type: 'string' },
          evidence: { type: 'string' },
          answers_question: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['title', 'story', 'evidence', 'answers_question'],
        additionalProperties: false,
      },
    },
  },
  required: ['company_snapshot', 'questions', 'stories'],
  additionalProperties: false,
};

export interface InterviewPrepData {
  company_snapshot: string;
  questions: { question: string; why: string }[];
  stories: { title: string; story: string; evidence: string; answers_question: number }[];
}

export interface InterviewPrepContext {
  company: string;
  role: string;
  stage: string;
  posting: string;
  /** Cached company research; '' when none is saved. */
  research: string;
  resumeText: string;
}

const clean = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** No em or en dashes anywhere in their material: a comma reads the same. */
export function noDashes(s: string): string {
  return String(s || '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/, '');
}

/** Pure: the whole prompt. */
export function interviewPrepPrompt(ctx: InterviewPrepContext): string {
  const stageWord = ctx.stage === 'phone_screen' ? 'a phone screen' : 'an interview';
  return [
    `The candidate has ${stageWord} for ${ctx.role} at ${ctx.company}. Write them a one-page prep sheet.`,
    '',
    'JOB POSTING:',
    clean(ctx.posting).slice(0, POSTING_CAP) || '(no posting text stored)',
    '',
    'WHAT WE KNOW ABOUT THE COMPANY (saved research; may be empty):',
    clean(ctx.research).slice(0, RESEARCH_CAP) || '(none saved)',
    '',
    'THE CANDIDATE\'S RESUMES (the only evidence about the candidate you may use):',
    clean(ctx.resumeText).slice(0, RESUME_CAP) || '(no resume on file)',
    '',
    'Return:',
    '- company_snapshot: 2 to 4 plain sentences on what the company does and anything from the research worth mentioning. Only what the research or posting says; if neither says much, say so briefly.',
    `- questions: 8 to 10 questions the candidate is likely to be asked in ${stageWord} for THIS role, most likely first. "why" is one short line on what the interviewer is checking.`,
    '- stories: 3 to 5 stories from the candidate\'s resumes they can tell. story is 2 to 3 sentences in the candidate\'s first person. evidence is the exact resume line (or a close quote) it rests on. answers_question is the 1-based number of the question it answers best.',
    '',
    'Never invent employers, titles, metrics, dates or durations. Never use em dashes.',
  ].join('\n');
}

/** Pure: the sheet as markdown, the shape prep_notes stores. */
export function renderInterviewPrep(data: InterviewPrepData, meta: { company: string; role: string }): string {
  const qs = (data.questions || []).map((q) => ({ question: noDashes(clean(q?.question)), why: noDashes(clean(q?.why)) })).filter((q) => q.question);
  const stories = (data.stories || []).filter((s) => clean(s?.title) || clean(s?.story));
  const lines: string[] = [];
  lines.push(`# Interview prep: ${noDashes(meta.role)} at ${noDashes(meta.company)}`, '');
  lines.push('## Company snapshot', '', noDashes(clean(data.company_snapshot)) || 'No saved research on this company yet.', '');
  lines.push('## Likely questions', '');
  qs.forEach((q, i) => lines.push(`${i + 1}. ${q.question}${q.why ? ` _(${q.why})_` : ''}`));
  lines.push('', '## Your stories', '');
  for (const s of stories) {
    const n = Number(s.answers_question);
    const answers = Number.isInteger(n) && n >= 1 && n <= qs.length ? ` (answers Q${n})` : '';
    lines.push(`### ${noDashes(clean(s.title)) || 'Story'}${answers}`, '');
    if (clean(s.story)) lines.push(noDashes(clean(s.story)), '');
    if (clean(s.evidence)) lines.push(`> Evidence: ${noDashes(clean(s.evidence))}`, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Build the sheet and store it. Without `force` it only fills an EMPTY
 * prep_notes (checked again right before the write, so notes the user typed while
 * it ran are never replaced). Returns whether it wrote.
 */
export async function buildInterviewPrep(applicationId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const app = getApplication(applicationId);
  if (!app) throw new Error(`Application ${applicationId} not found`);
  if (!opts.force && clean(app.prep_notes)) return false;
  const posting = getRawJobText(applicationId) || [app.job_description, app.key_responsibilities, app.required_skills]
    .filter(Boolean).join('\n\n');
  const research = getCompanyResearch(app.company)?.text || '';
  const { text: resumeText } = await resumeTextForJob(app.job_title, posting);
  const data = await runClaudeJSON<InterviewPrepData>(
    interviewPrepPrompt({ company: app.company, role: app.job_title, stage: app.current_stage, posting, research, resumeText }),
    { model: getPreferredModel(), fallbackModel: 'sonnet', schema: INTERVIEW_PREP_SCHEMA, systemPrompt: SYS.prep, timeoutMs: 240000 },
  );
  const md = renderInterviewPrep(data, { company: app.company, role: app.job_title });
  if (!opts.force) {
    const now = getApplication(applicationId);
    if (!now || clean(now.prep_notes)) return false;
  }
  updateApplication(applicationId, { prep_notes: md });
  return true;
}

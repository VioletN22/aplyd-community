/**
 * Fit score: how well their resumes answer this posting, 0 to 10, with one
 * sentence the user can read on a card.
 *
 * The evidence is the same resume block the letters use (resumeTextForJob in
 * letter-context.ts): the best-fit locker variant in full, then every other
 * variant as supporting material. Cheap and small on purpose: haiku, a 30s cap,
 * one integer and one sentence out, stored on the application row.
 *
 * The prompt builder is pure and unit tested; computeFitScore is the side effect.
 */
import { getApplication, getRawJobText, updateApplication } from './database';
import { runClaudeJSON, SYS } from './claude';
import { resumeTextForJob } from './letter-context';

/** Raw postings run long; the letter path caps at the same number. */
const POSTING_CAP = 6000;
/** Every resume variant together, same cap as the letter prompt. */
const RESUME_CAP = 26000;

/** The { score, missing, reason } contract the model answers in. */
export const FIT_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 10 },
    missing: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['score', 'missing', 'reason'],
  additionalProperties: false,
};

export interface FitContext {
  company: string;
  role: string;
  /** Raw posting when we kept it, otherwise the extraction summary. */
  posting: string;
  /** The resume block from resumeTextForJob. */
  resumeText: string;
}

export interface FitResult {
  score: number;
  missing: string[];
  reason: string;
}

const clean = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Pure: the whole scoring prompt. */
export function fitScorePrompt(ctx: FitContext): string {
  const posting = clean(ctx.posting).slice(0, POSTING_CAP) || '(no posting text stored)';
  const resume = clean(ctx.resumeText).slice(0, RESUME_CAP) || '(no resume on file)';
  return [
    'Score how well this candidate matches the posting.',
    '',
    `TARGET: ${ctx.role} at ${ctx.company}`,
    '',
    'JOB POSTING:',
    posting,
    '',
    'THE CANDIDATE\'S RESUMES (the only evidence you may use):',
    resume,
    '',
    'Return:',
    '- score: 0 to 10. 10 means the candidate meets the stated requirements with direct evidence in the resumes, 0 means no overlap at all.',
    '- missing: the stated requirements with no evidence in the resumes, short phrases.',
    '- reason: one sentence the candidate can read on a card, plain and honest, never using em dashes.',
    '',
    'Judge only on the resumes above. Do not assume skills the candidate has not recorded.',
  ].join('\n');
}

/** What this application knows: the raw posting, or the summary for older rows. */
function postingFor(applicationId: string): { company: string; role: string; posting: string } {
  const application = getApplication(applicationId);
  if (!application) throw new Error(`Application ${applicationId} not found`);
  const raw = getRawJobText(applicationId) || '';
  const summary = [
    application.job_description,
    application.key_responsibilities,
    application.required_skills,
    application.nice_to_have_skills,
  ].filter(Boolean).join('\n\n');
  return { company: application.company, role: application.job_title, posting: raw || summary };
}

/**
 * Score this posting against their best-fit resume and store it on the row.
 * Throws (and stores nothing) when the locker has no readable resume.
 */
export async function computeFitScore(applicationId: string): Promise<FitResult> {
  const job = postingFor(applicationId);
  const { text: resumeText } = await resumeTextForJob(job.role, job.posting);
  if (!clean(resumeText)) {
    throw new Error('No resume in the locker yet. Add one in Settings first.');
  }
  const raw = await runClaudeJSON<FitResult>(fitScorePrompt({ ...job, resumeText }), {
    model: 'haiku',
    schema: FIT_SCHEMA,
    systemPrompt: SYS.extract,
    timeoutMs: 30000,
  });
  const n = Number(raw?.score);
  if (!Number.isFinite(n)) throw new Error('fit score was not a number');
  const score = Math.max(0, Math.min(10, Math.round(n)));
  const reason = clean(raw?.reason);
  const missing = (Array.isArray(raw?.missing) ? raw.missing : []).map(clean).filter(Boolean);
  updateApplication(applicationId, { fit_score: score, fit_reason: reason });
  return { score, missing, reason };
}

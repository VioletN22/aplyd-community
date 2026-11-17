// The model half of matching: haiku, schema-enforced, terse. Only the email
// (sender, subject, date, the first 3000 characters of body) and their shortlist
// of applications (id, company, role, date) go in.

import { runClaudeJSON, SYS } from '../claude';
import type { ClassifyInput, ClassifyResult, SecondPassEmail, SecondPassResult } from './sync';
import type { AppLite } from './match';

export const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    applicationId: { type: ['string', 'null'] },
    kind: { type: 'string', enum: ['received', 'rejection', 'interview', 'assessment', 'offer', 'other'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'string' },
  },
  required: ['applicationId', 'kind', 'confidence', 'evidence'],
  additionalProperties: false,
};

export function classifyPrompt(input: ClassifyInput): string {
  const apps = input.candidates
    .map((a) => `${a.id} | ${a.company} | ${a.job_title} | applied ${String(a.created_at).slice(0, 10)}`)
    .join('\n');
  return [
    'Applications (id | company | role | date):',
    apps || '(none)',
    '',
    'Email:',
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    `Date: ${input.date.slice(0, 10)}`,
    '',
    input.body.slice(0, 3000),
    '',
    'Answer:',
    '- applicationId: the id from the list this email is about, or null if none fits.',
    '- kind: received (application acknowledged), rejection (including a job board saying the employer "has decided not to progress your application" or it is "unlikely to progress further"), interview (an invitation to interview or a call), assessment (a test, task or questionnaire to complete), offer, or other (alerts, marketing, anything not about one of the user\'s applications).',
    '- confidence 0-1 that both the application and the kind are right.',
    '- evidence: a short quote from the email, under 20 words.',
  ].join('\n');
}

export async function classifyEmail(input: ClassifyInput): Promise<ClassifyResult> {
  return runClaudeJSON<ClassifyResult>(classifyPrompt(input), {
    model: 'haiku',
    schema: EMAIL_SCHEMA,
    systemPrompt: SYS.email,
    timeoutMs: 45000,
  });
}

// ── batched: several emails per call ────────────────────────────────────────
export const EMAIL_BATCH_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, ...EMAIL_SCHEMA.properties },
        required: ['index', ...EMAIL_SCHEMA.required],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

/** Every email with its OWN shortlist: an id is only valid for the email it is listed under. */
export function classifyBatchPrompt(inputs: ClassifyInput[]): string {
  const blocks = inputs.map((input, i) => {
    const apps = input.candidates
      .map((a) => `  ${a.id} | ${a.company} | ${a.job_title} | applied ${String(a.created_at).slice(0, 10)}`)
      .join('\n');
    return [
      `=== Email ${i} ===`,
      'Applications it may be about (id | company | role | date):',
      apps || '  (none)',
      `From: ${input.from}`,
      `Subject: ${input.subject}`,
      `Date: ${input.date.slice(0, 10)}`,
      '',
      input.body.slice(0, 1500),
    ].join('\n');
  });
  return [
    `Classify each of these ${inputs.length} emails. Return one result per email, with index = the email number.`,
    '',
    ...blocks,
    '',
    'For each email:',
    '- applicationId: an id from THAT email\'s own list, or null if none fits.',
    '- kind: received (application acknowledged), rejection (including a job board saying the employer "has decided not to progress your application" or it is "unlikely to progress further"), interview (an invitation to interview or a call), assessment (a test, task or questionnaire to complete), offer, or other (alerts, marketing, anything not about one of the user\'s applications).',
    '- confidence 0-1 that both the application and the kind are right.',
    '- evidence: a short quote from that email, under 20 words.',
  ].join('\n');
}

export async function classifyEmails(inputs: ClassifyInput[]): Promise<ClassifyResult[]> {
  const out = await runClaudeJSON<{ results: (ClassifyResult & { index: number })[] }>(classifyBatchPrompt(inputs), {
    model: 'haiku',
    schema: EMAIL_BATCH_SCHEMA,
    systemPrompt: SYS.email,
    timeoutMs: 90000,
  });
  const byIndex = new Map((out?.results || []).map((r) => [Number(r.index), r]));
  // Missing or duplicate indexes make the whole batch untrustworthy: let the caller fall back.
  if (byIndex.size !== inputs.length) throw new Error('batch result count mismatch');
  return inputs.map((_, i) => {
    const r = byIndex.get(i);
    if (!r) throw new Error('batch result missing index ' + i);
    return { applicationId: r.applicationId, kind: r.kind, confidence: r.confidence, evidence: r.evidence };
  });
}

// ── second pass: the emails the shortlist missed, against every application ──
// One shared list of all their applications (compact, ~100 rows), then up to
// CLASSIFY_BATCH emails. For an email that is about none of them, the model
// also names the company and role, so an interview or offer from a company the user
// never logged can become an application of its own.
export const EMAIL_SECOND_PASS_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          ...EMAIL_SCHEMA.properties,
          company: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
        },
        required: ['index', ...EMAIL_SCHEMA.required, 'company', 'role'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

export function secondPassPrompt(emails: SecondPassEmail[], apps: AppLite[]): string {
  const list = apps
    .map((a) => `${a.id} | ${a.company} | ${a.job_title} | applied ${String(a.created_at).slice(0, 10)}`)
    .join('\n');
  const blocks = emails.map((e, i) => [
    `=== Email ${i} ===`,
    `From: ${e.from}`,
    `Subject: ${e.subject}`,
    `Date: ${e.date.slice(0, 10)}`,
    '',
    e.body.slice(0, 1500),
  ].join('\n'));
  return [
    'All of the user\'s job applications (id | company | role | date applied):',
    list || '(none)',
    '',
    `Classify each of these ${emails.length} emails. Return one result per email, with index = the email number.`,
    'The company in an email may be a recruiter or agency acting for an employer, a parent brand or a product name: match on whichever the list uses.',
    '',
    ...blocks,
    '',
    'For each email:',
    '- applicationId: the id from the list above this email is about, or null if it is about none of them.',
    '- kind: received (application acknowledged), rejection (including a job board saying the employer "has decided not to progress your application" or it is "unlikely to progress further"), interview (an invitation to interview or a call), assessment (a test, task or questionnaire to complete), offer, or other (alerts, marketing, the user\'s own replies, anything not about a job application).',
    '- confidence 0-1: with an applicationId, that the application and the kind are right; with null, that the kind is right and it is about a real job application of the user\'s.',
    '- evidence: a short quote from that email, under 20 words.',
    '- company: the hiring company the email is about (the employer, not the ATS or job board), or null if unclear.',
    '- role: the job title it is about, or null if not stated.',
  ].join('\n');
}

export async function classifyAgainstAll(emails: SecondPassEmail[], apps: AppLite[]): Promise<SecondPassResult[]> {
  const out = await runClaudeJSON<{ results: (SecondPassResult & { index: number })[] }>(secondPassPrompt(emails, apps), {
    model: 'haiku',
    schema: EMAIL_SECOND_PASS_SCHEMA,
    systemPrompt: SYS.email,
    timeoutMs: 120000,
  });
  const byIndex = new Map((out?.results || []).map((r) => [Number(r.index), r]));
  if (byIndex.size !== emails.length) throw new Error('second pass result count mismatch');
  return emails.map((_, i) => {
    const r = byIndex.get(i);
    if (!r) throw new Error('second pass result missing index ' + i);
    return {
      applicationId: r.applicationId, kind: r.kind, confidence: r.confidence, evidence: r.evidence,
      company: r.company ?? null, role: r.role ?? null,
    };
  });
}

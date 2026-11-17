/**
 * The per-application assistant.
 *
 * The user fills application forms that ask open questions ("What are your
 * qualifications?", "Why do you want to work here?", "Describe a project you are
 * proud of"). This module answers them AS THE USER: first person, pasteable, and
 * grounded in exactly one pile of material, never in the model's own memory.
 *
 * What it is given every turn:
 *   this application   posting, company research (cached only), fit score
 *   who the user is    profile, answer bank, every resume variant, portfolio, voice
 *   what they sent     the cover letter draft for THIS row
 *   the conversation   the last turns, from chat_messages
 *
 * Two rules hold it together:
 *   1. no invention. Every claim has to exist in the material above, so a missing
 *      number is asked for, never filled in.
 *   2. no live web hop per turn. Hydration runs cache-only, the way a refine does.
 *
 * The prompt builder is pure and unit tested. Everything with a side effect
 * (hydration, the subprocess, the writes) lives in assistantReply.
 */
import { getPreferredModel, runClaudeJSONMeta, SYS } from './claude';
import {
  addChatMessage, getApplication, getChatMessages, getCoverLetterForApplication,
} from './database';
import { hydrateLetterContext } from './letter-context';
import type { AssistantFormAnswer, AssistantMessage, AssistantReply } from '../shared/types';

// Caps, in the same spirit as the letter path: enough material to be specific,
// small enough that a chat turn stays a chat turn.
const POSTING_CAP = 6000;
const RESEARCH_CAP = 2500;
const RESUME_CAP = 26000;
const PORTFOLIO_CAP = 2000;
const LETTER_CAP = 4000;
/** How much of the conversation the model sees. Older turns fall off the top. */
export const HISTORY_TURNS = 12;

/**
 * formAnswer is always present in the JSON and always has both keys: an optional
 * field is a field the model can quietly forget to think about. Nulls mean "the user's
 * message was not a form question", and the caller drops the object entirely.
 */
export const ASSISTANT_SCHEMA = {
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
};

/** Everything the prompt builder needs, already read out of the database. */
export interface AssistantContext {
  company: string;
  role: string;
  /** Raw posting when we kept it, otherwise the extraction summary. */
  posting: string;
  /** Cached company research, if any was ever fetched for this company. */
  research?: string;
  profile: Record<string, string>;
  facts: { label: string; value: string }[];
  /** Every resume variant as text, best fit for this job first. */
  resumeText?: string;
  portfolioText?: string;
  voice: { follow: string[]; avoid: string[] };
  /** The cover letter draft for THIS application. */
  letter?: string;
  fitScore?: number | null;
  fitReason?: string | null;
  /** Turns before the one being answered, oldest first. */
  history: AssistantMessage[];
  /** The message the user just sent. */
  message: string;
}

const trimmed = (v: unknown): string => String(v ?? '').trim();

function labelledBlock(label: string, body: string): string {
  const text = trimmed(body);
  return text ? `${label}\n${text}\n\n` : '';
}

function profileBlock(profile: Record<string, string>): string {
  const lines = Object.entries(profile || {})
    .filter(([, v]) => trimmed(v))
    .map(([k, v]) => `- ${k}: ${trimmed(v)}`);
  return lines.join('\n');
}

function factsBlock(facts: { label: string; value: string }[]): string {
  const lines = (facts || [])
    .filter((f) => f && trimmed(f.label) && trimmed(f.value))
    .map((f) => `- ${trimmed(f.label)}: ${trimmed(f.value)}`);
  return lines.join('\n');
}

function voiceBlock(voice: { follow: string[]; avoid: string[] }): string {
  const fmt = (xs: string[]) =>
    (xs || []).map(trimmed).filter(Boolean).map((x) => `- ${x}`).join('\n');
  const follow = fmt(voice?.follow || []);
  const avoid = fmt(voice?.avoid || []);
  if (!follow && !avoid) return '';
  return (
    'THE USER\'S WRITING STYLE (match it when you draft anything they will submit):\n' +
    (follow ? `Follow:\n${follow}\n` : '') +
    (avoid ? `Avoid:\n${avoid}\n` : '') +
    '\n'
  );
}

function conversationBlock(history: AssistantMessage[]): string {
  const turns = (history || [])
    .filter((t) => t && trimmed(t.text))
    .map((t) => `${t.role === 'assistant' ? 'ASSISTANT' : 'USER'}: ${trimmed(t.text)}`);
  return turns.join('\n\n');
}

function fitLine(ctx: AssistantContext): string {
  if (ctx.fitScore == null && !trimmed(ctx.fitReason)) return '';
  const score = ctx.fitScore == null ? '' : `${ctx.fitScore} out of 10.`;
  return `APLYD'S FIT SCORE for this application (its own read of the user's best-fit resume against this posting): ${[score, trimmed(ctx.fitReason)].filter(Boolean).join(' ')}\n\n`;
}

const ASSISTANT_RULES = [
  'RULES:',
  '- When the user\'s message is an application form question ("What are your qualifications?", "Why do you want to work here?", "Tell us about a project you are proud of"), answer it AS THE USER, in the first person, ready to paste straight into the form.',
  '- Ground every claim in the material above. Never invent employers, job titles, metrics, dates, durations, team sizes, qualifications, or technologies. If a fact is not in the material, it does not go in the answer.',
  '- Never state a duration of experience ("N years of X") unless that exact figure appears in the material.',
  '- Plain text ready to paste into a form: no markdown headers, no bold, no code fences, no emoji. Use a list only when the user asked for one.',
  '- never use em dashes anywhere; use commas, colons, or parentheses.',
  '- Be concise. A form answer is one to three short paragraphs unless the user names a length or a word count, and then you hit it.',
  '- When something the answer needs is genuinely missing from the material, say so plainly and ask the user for it rather than filling the gap.',
  '- When the user is asking about the application rather than answering a form (how they fit, what to send next, what to change), just answer them directly.',
  '- Be specific to THIS company and role. No generic job hunting advice.',
].join('\n');

const ASSISTANT_OUTPUT = [
  'OUTPUT:',
  '- reply: your message to the user. When you drafted a form answer, reply IS that answer, exactly as they should paste it, with no preamble around it.',
  '- formAnswer: set question to the form question in its own words and answer to the pasteable answer, ONLY when the user\'s message was an application form question. Otherwise set both question and answer to null.',
  '- Output only the JSON described by the schema.',
].join('\n');

/**
 * Pure: the whole prompt for one turn. Exported so the material it carries and
 * the rules it enforces are testable without a subprocess.
 */
export function assistantPrompt(ctx: AssistantContext): string {
  const posting = trimmed(ctx.posting).slice(0, POSTING_CAP);
  return (
    'Answer for the user, about ONE job application they are working on.\n\n' +
    `APPLICATION: ${ctx.role} at ${ctx.company}\n\n` +
    fitLine(ctx) +
    labelledBlock('JOB POSTING:', posting || '(no posting text stored)') +
    labelledBlock(
      'COMPANY RESEARCH (saved earlier, may be imperfect; ignore any of it that does not describe the same company as the posting):',
      trimmed(ctx.research).slice(0, RESEARCH_CAP),
    ) +
    labelledBlock('THE USER\'S PROFILE (identity and contact details):', profileBlock(ctx.profile) || '(none yet)') +
    labelledBlock('THE USER\'S RESUMES (best-fit variant for this job first, then the others; all facts are true):', trimmed(ctx.resumeText).slice(0, RESUME_CAP)) +
    labelledBlock('THE USER\'S COVER LETTER DRAFT FOR THIS APPLICATION:', trimmed(ctx.letter).slice(0, LETTER_CAP)) +
    labelledBlock('KNOWN FACTS (the user\'s answer bank):', factsBlock(ctx.facts) || '(none yet)') +
    labelledBlock('THE USER\'S PORTFOLIO:', trimmed(ctx.portfolioText).slice(0, PORTFOLIO_CAP)) +
    voiceBlock(ctx.voice) +
    labelledBlock('CONVERSATION SO FAR:', conversationBlock(ctx.history)) +
    `THE USER JUST SAID:\n${trimmed(ctx.message)}\n\n` +
    ASSISTANT_RULES + '\n\n' +
    ASSISTANT_OUTPUT
  );
}

/**
 * The house rule is no em dashes anywhere, and a rule worth writing in the
 * prompt is worth enforcing on the way out: the user pastes this text into a form,
 * where nobody gets a second pass at it. En dashes are left alone, they are
 * usually a date range.
 */
function noEmDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ', ');
}

function normalizeIncoming(messages: AssistantMessage[]): AssistantMessage[] {
  return (messages || [])
    .filter((m) => m && trimmed(m.text))
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, text: trimmed(m.text) }));
}

/** Persisted turns, oldest first, in the shape the prompt builder wants. */
function storedHistory(applicationId: string): AssistantMessage[] {
  try {
    return getChatMessages(applicationId).map((row) => ({
      role: row.role === 'assistant' ? 'assistant' as const : 'user' as const,
      text: row.content,
    }));
  } catch {
    // A chat that cannot read its own history still has to answer the question
    // in front of it.
    return [];
  }
}

/**
 * One turn.
 *
 * `messages` are the NEW turns for this call, normally the single message the user
 * just typed, and the last of them must be theirs: everything already said is read
 * back from chat_messages. Both sides of a successful turn are then persisted,
 * so a failed call leaves no dangling question behind.
 */
export async function assistantReply(
  applicationId: string,
  messages: AssistantMessage[],
): Promise<AssistantReply> {
  const incoming = normalizeIncoming(messages);
  const latest = incoming[incoming.length - 1];
  if (!latest || latest.role !== 'user') {
    throw new Error('The assistant needs a message from you to answer.');
  }

  const application = getApplication(applicationId);
  if (!application) throw new Error(`Application ${applicationId} not found`);

  // Cache-only hydration: an assistant turn never pays for a live web crawl.
  const hydrated = await hydrateLetterContext(applicationId, { researchCacheOnly: true });

  const transcript = [...storedHistory(applicationId), ...incoming].slice(-HISTORY_TURNS);
  const ctx: AssistantContext = {
    company: hydrated.company,
    role: hydrated.role,
    posting: hydrated.rawJobText || hydrated.jobSummary || '',
    research: hydrated.researchText,
    profile: hydrated.profile,
    facts: hydrated.facts,
    resumeText: hydrated.resumeText,
    portfolioText: hydrated.portfolioText,
    voice: hydrated.voice,
    letter: getCoverLetterForApplication(applicationId)?.body || '',
    fitScore: application.fit_score ?? null,
    fitReason: application.fit_reason ?? null,
    history: transcript.slice(0, -1),
    message: transcript[transcript.length - 1].text,
  };

  const { data } = await runClaudeJSONMeta<{ reply?: string; formAnswer?: { question?: string | null; answer?: string | null } }>(
    assistantPrompt(ctx),
    {
      model: getPreferredModel(),
      fallbackModel: 'sonnet',
      systemPrompt: SYS.assistant,
      schema: ASSISTANT_SCHEMA,
      timeoutMs: 150000,
    },
  );

  const reply = noEmDashes(trimmed(data?.reply));
  if (!reply) throw new Error('The assistant came back empty. Try again.');

  // A form answer only counts when BOTH halves arrived: half of one would save a
  // labelless or answerless row into the answer bank.
  const question = noEmDashes(trimmed(data?.formAnswer?.question));
  const answer = noEmDashes(trimmed(data?.formAnswer?.answer));
  const formAnswer: AssistantFormAnswer | undefined =
    question && answer ? { question, answer } : undefined;

  for (const turn of incoming) addChatMessage(applicationId, turn.role, turn.text);
  addChatMessage(applicationId, 'assistant', reply);

  return formAnswer ? { reply, formAnswer } : { reply };
}

/** The stored thread for an application, oldest first. */
export function assistantHistory(applicationId: string) {
  return getChatMessages(applicationId).map((row) => ({
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' as const : 'user' as const,
    text: row.content,
    createdAt: row.created_at,
  }));
}

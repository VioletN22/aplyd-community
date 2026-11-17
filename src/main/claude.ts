// Compatibility names retained for existing job, letter, email and assistant callers.
// In-app inference uses the optional provider selected in Settings.
import { ExtractedJobData, JOB_SOURCES } from '../shared/types';
import { cancelAllAI, type AIOptions, type AIMeta } from './ai-provider';
export { detectUrls, bareUrl, isSingleUrlInput, singleUrlOf, splitAddItems } from '../shared/add-input';
export type RunOpts = AIOptions;
export type RunMeta = AIMeta;
export function killClaudeProcesses(): void { cancelAllAI(); }
export function getPreferredModel(): string {
  try { return require('./ai-settings').getAIConfig().model || 'sonnet'; } catch { return 'sonnet'; }
}
async function runProvider(prompt: string, opts: RunOpts, onDelta?: (text: string) => void) {
  const { runAI } = await import('./ai-settings');
  return runAI(prompt, opts, onDelta);
}
export async function runClaudeCLI(prompt: string, optsOrTimeout?: RunOpts | number, legacyModel?: string): Promise<string> {
  const opts = typeof optsOrTimeout === 'number' ? { timeoutMs: optsOrTimeout, model: legacyModel } : optsOrTimeout || {};
  return (await runProvider(prompt, opts)).text;
}
export async function runClaudeStream(prompt: string, opts: RunOpts, onDelta: (text: string) => void): Promise<string> {
  return (await runProvider(prompt, opts, onDelta)).text;
}
export async function runClaudeJSON<T = any>(prompt: string, opts: RunOpts & { schema: object }): Promise<T> {
  return (await runClaudeJSONMeta<T>(prompt, opts)).data;
}
export async function runClaudeJSONMeta<T = any>(prompt: string, opts: RunOpts & { schema: object }): Promise<{ data: T; meta: RunMeta }> {
  const result = await runProvider(prompt, opts);
  return { data: result.data as T, meta: result.meta };
}
export const SYS = {
  letter: 'You write job application cover letters as the user, in their first-person voice, grounded only in the material provided in the prompt. You have no tools. Output exactly the JSON requested, nothing else.',
  extract: 'You extract structured data from job postings. You have no tools. Output exactly the JSON requested, nothing else.',
  resolve: 'You answer job application form fields on the user\'s behalf using only the provided facts. Output exactly what is requested, nothing else.',
  chat: 'You are the user\'s job-search copilot inside their tracker app. Be direct and concrete. Never use em dashes.',
  assistant: 'You are the user\'s job application assistant inside their tracker app. You draft first-person answers as the user, grounded only in the provided material, and you never invent employers, titles, metrics, dates, or durations. You have no tools. Never use em dashes. Output exactly the JSON requested, nothing else.',
  email: 'You read one job-application email and say which of the listed applications it is about and what it says. You have no tools. Output exactly the JSON requested, nothing else.',
  distill: 'You distill raw user feedback notes into clean writing rules. Output exactly the JSON requested, nothing else.',
  prep: 'You prepare the user for a job interview, grounded only in the posting, the company notes and the resumes provided. You never invent employers, titles, metrics or dates. You have no tools. Never use em dashes. Output exactly the JSON requested, nothing else.',
};

// Legacy argument helper only; in-app inference never launches Claude Code.
const CLI_MODELS = new Set(['fable', 'opus', 'sonnet', 'haiku']);
export function buildClaudeArgs(opts: RunOpts & { model: string; stream?: boolean }, isWin: boolean): string[] {
  const cliModel = CLI_MODELS.has(opts.model) ? opts.model : 'sonnet';
  if (isWin) return ['-p', '--model', cliModel, '--output-format', 'text'];
  // Streaming and --json-schema are mutually exclusive at the CLI: the schema
  // path needs the single JSON envelope. A streaming caller parses the finished
  // text itself instead (parseCoverLetter on the letter path).
  const format = opts.stream ? 'stream-json' : opts.schema ? 'json' : 'text';
  const args = ['-p', '--model', cliModel, '--output-format', format];
  // Verified against claude 2.1.233: `--output-format stream-json` under --print
  // refuses to start without --verbose ("requires --verbose"), and partial
  // message chunks only arrive with --include-partial-messages.
  if (opts.stream) args.push('--include-partial-messages', '--verbose');
  // Isolate from the user's global Claude Code config: their MCP servers, hooks
  // and skills all load into a bare `claude -p`, roughly doubling latency and
  // hanging the call outright if any MCP server stalls. --tools "" drops the
  // tool definitions entirely; --no-session-persistence keeps the user's resume,
  // phone number and letters out of ~/.claude/projects transcripts.
  args.push(
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '',
    '--tools', '',
    '--no-session-persistence',
  );
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
  if (opts.schema && !opts.stream) args.push('--json-schema', JSON.stringify(opts.schema));
  if (opts.fallbackModel) args.push('--fallback-model', opts.fallbackModel);
  return args;
}

export function cliFailureMessage(code: number, stdout: string, stderr: string): string {
  let why = stderr.trim();
  if (!why) {
    const out = stdout.trim();
    try {
      const env = JSON.parse(out);
      why = typeof env?.result === 'string' ? env.result : out;
    } catch {
      why = out;
    }
  }
  return `claude CLI exited ${code}: ${why.slice(0, 400)}`;
}

export function jsonStringPrefix(buffer: string, key: string): string {
  let raw = buffer.replace(/^\s+/, '');
  if (raw.startsWith('`')) {
    // A ```json fence: skip its whole opening line, and show nothing until that
    // line has actually arrived (otherwise "```js" reads as prose for a moment).
    const nl = raw.indexOf('\n');
    if (nl < 0) return '';
    raw = raw.slice(nl + 1).replace(/^\s+/, '');
  }
  const head = raw;
  if (!head) return '';
  if (head[0] !== '{') return head;    // plain prose, show it as it lands
  const open = raw.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!open || open.index == null) return '';
  let i = open.index + open[0].length;
  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') break;                       // end of the value
    if (ch !== '\\') { out += ch; i++; continue; }
    const esc = raw[i + 1];
    if (esc === undefined) break;                // escape still arriving
    if (esc === 'u') {
      if (i + 6 > raw.length) break;             // \uXXXX still arriving
      const code = parseInt(raw.slice(i + 2, i + 6), 16);
      if (Number.isNaN(code)) break;
      out += String.fromCharCode(code);
      i += 6;
      continue;
    }
    const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
    if (!(esc in simple)) break;                 // not something we can decode
    out += simple[esc];
    i += 2;
  }
  return out;
}

// The exact shape the tolerant post-processing below already expects. Handing it
// to the CLI as --json-schema turns "usually valid JSON" into "valid JSON", while
// the post-processing stays: a schema fixes the shape, not the content.
const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const nullableNum = { type: ['number', 'null'] } as const;
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    company: str,
    job_title: str,
    location: str,
    workplace_address: nullableStr,
    job_url: str,
    job_source: nullableStr,
    salary_min: nullableNum,
    salary_max: nullableNum,
    equity: nullableStr,
    benefits: nullableStr,
    job_description: str,
    key_responsibilities: str,
    required_skills: str,
    nice_to_have_skills: str,
    team_info: nullableStr,
    hiring_timeline: nullableStr,
    application_deadline: nullableStr,
  },
  required: [
    'company', 'job_title', 'location', 'workplace_address', 'job_url', 'job_source',
    'salary_min', 'salary_max', 'equity', 'benefits', 'job_description',
    'key_responsibilities', 'required_skills', 'nice_to_have_skills',
    'team_info', 'hiring_timeline', 'application_deadline',
  ],
  additionalProperties: false,
};

// The sources a listing can name, in the app's order. Email is left out: it is
// how a job reached the user, not something the listing text shows.
const EXTRACTION_SOURCES = JOB_SOURCES.filter((s) => s !== 'Email').map((s) => `"${s}"`).join(', ');

/**
 * Extracts structured job data from raw job listing text.
 * Uses the selected provider with validated structured output.
 */
export async function extractJobListing(
  jobListingText: string
): Promise<ExtractedJobData> {
  const extractionPrompt = `Extract structured data from this job listing (it may be a messy copy-paste from LinkedIn or another job board, full of UI text like "Apply", "Save", "Promoted", "Premium" - ignore all that noise).

CRITICAL RULES:
- company and job_title are almost always present - look carefully. E.g. "Software Engineer at Frollo" means job_title="Software Engineer", company="Frollo". Never return "Unknown" if the info exists anywhere in the text.
- job_description must be a CLEAN, CONCISE rewrite (max 150 words): what the company does + what the role is. Strip ALL job-board boilerplate, promo text, premium upsells, follower counts, etc.
- key_responsibilities, required_skills, nice_to_have_skills: short bullet-style lines separated by newlines, max 6 each.
- Salaries: convert to numbers (e.g. "$120k" -> 120000). Use null if not stated.
- job_source: the job site/channel this listing came from, IF it's obvious from the text or URL. Choose EXACTLY ONE from: ${EXTRACTION_SOURCES}. Use null if you can't tell. Do NOT guess "Company website" just because a company is named.
- workplace_address: the exact workplace street address only if the listing explicitly states it. Use null for a city, suburb, postcode alone, remote role, or an applicant/contact address. Never guess.

Return ONLY a valid JSON object (no markdown fences, no commentary) with exactly these fields:
{
  "company": string,
  "job_title": string,
  "location": string,
  "workplace_address": string | null,
  "job_url": string (empty string if not found),
  "job_source": string | null,
  "salary_min": number | null,
  "salary_max": number | null,
  "equity": string | null,
  "benefits": string | null (one short line),
  "job_description": string (clean, max 150 words),
  "key_responsibilities": string (newline-separated bullets),
  "required_skills": string (newline-separated bullets),
  "nice_to_have_skills": string (newline-separated bullets, empty string if none),
  "team_info": string | null,
  "hiring_timeline": string | null,
  "application_deadline": string | null
}

Job listing text:
${jobListingText}`;

  // Provider failures surface to the caller; never invent a posting.
  let extractedData: ExtractedJobData;
  try {
    extractedData = await runClaudeJSON<ExtractedJobData>(extractionPrompt, {
      model: 'sonnet',
      systemPrompt: SYS.extract,
      schema: EXTRACT_SCHEMA,
      timeoutMs: 60000,
    });
  } catch (error) {
    throw new Error(`Failed to extract job data as JSON: ${error}`);
  }
  if (!extractedData || typeof extractedData !== 'object') {
    throw new Error('Extraction returned no object');
  }

  // Fill safe defaults for optional-ish fields so validation doesn't reject good extractions
  extractedData.job_url = extractedData.job_url || '';
  extractedData.nice_to_have_skills = extractedData.nice_to_have_skills || '';
  extractedData.job_source = extractedData.job_source || null;

  // Validate truly required fields only (others get safe defaults)
  const requiredFields: (keyof ExtractedJobData)[] = [
    "company",
    "job_title",
    "job_description",
  ];

  for (const field of requiredFields) {
    if (!extractedData[field]) {
      throw new Error(
        `Missing required field in extraction: ${field}. Response: ${JSON.stringify(extractedData).slice(0, 300)}`
      );
    }
  }

  extractedData.location = extractedData.location || '';
  extractedData.workplace_address = extractedData.workplace_address?.trim() || null;
  extractedData.key_responsibilities = extractedData.key_responsibilities || '';
  extractedData.required_skills = extractedData.required_skills || '';

  // Ensure salary fields are numbers or null
  if (extractedData.salary_min !== null && extractedData.salary_min !== undefined) {
    extractedData.salary_min = Number(extractedData.salary_min);
  } else {
    extractedData.salary_min = null;
  }

  if (extractedData.salary_max !== null && extractedData.salary_max !== undefined) {
    extractedData.salary_max = Number(extractedData.salary_max);
  } else {
    extractedData.salary_max = null;
  }

  return extractedData;
}

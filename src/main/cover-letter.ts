// The cover-letter draft, in one place, so background
// prep (prep.ts) and the detail page's Generate button share the exact same
// path: hydration, streamed generation, schema retry, working-draft upsert.
// Only ever writes the working draft (is_final=0); saved versions and PDFs are
// theirs to make.
import { saveCoverLetterForApplication } from './database';
import { coverLetterPrompt, LETTER_SCHEMA, parseCoverLetter } from './autopilot-prompts';
import { hydrateLetterContext } from './letter-context';
import { runClaudeJSONMeta, runClaudeStream, jsonStringPrefix, getPreferredModel, SYS } from './claude';

export type LetterLog = (...args: unknown[]) => void;

export interface LetterGenOpts {
  applicationId: string;
  company: string;
  role: string;
  jobText?: string;
  jobUrl?: string;
  location?: string;
}

export interface LetterGenDeps {
  /** Progress sink; payloads already carry applicationId. */
  send: (payload: Record<string, unknown>) => void;
  log: LetterLog;
}

export interface LetterGenResult {
  body: string;
  note?: string;
  researched: boolean;
  sources: string[];
  error?: string;
}

// Live draft chunks are coalesced to this cadence before they cross IPC: fast
// enough to read as typing, slow enough that a 3,000-character letter is a few
// dozen messages instead of a few hundred.
const STREAM_THROTTLE_MS = 150;

// The template is locked in LETTER_RULES, so a draft that opens with anything
// other than a greeting means the model drifted. Log it (the golden run reads
// this line); never rewrite their letter behind their back.
export function warnIfTemplateSlipped(body: string, log: LetterLog): void {
  const first = (body.split('\n')[0] || '').trim();
  if (body && !first.startsWith('Dear ')) log('[cover] warning: draft does not open with a "Dear " greeting:', first.slice(0, 80));
}

/**
 * Draft a WORKING letter (is_final=0) for one application: the detail page's
 * Generate button, the add flow's "generate on add" and background prep all
 * run this. Never throws: a failure comes back as `error`, already worded for
 * the page. Progress goes to deps.send (coverletter:progress in the app).
 */
export async function generateLetterDraft(opts: LetterGenOpts, deps: LetterGenDeps): Promise<LetterGenResult> {
  const { log } = deps;
  const send = (payload: Record<string, unknown>) => {
    try { deps.send({ applicationId: opts.applicationId, ...payload }); } catch { /* sink gone */ }
  };
  const emit = (stage: string, message: string) => send({ stage, message });
  const t0 = Date.now();
  try {
    log('[cover] generate start', opts.company, opts.role);
    emit('research', 'Researching ' + opts.company + ' on the web…');
    // One hydration pass: resume (cached on mtime), portfolio (7d), research
    // (14d, live on a miss), distilled voice, kept letters, raw posting.
    const ctx = await hydrateLetterContext(opts.applicationId, { onProgress: (m) => emit('research', m) });
    const researchText = ctx.researchText || '';
    const sources = ctx.researchSources;
    log('[cover] research done', 'chars=' + researchText.length, 'sources=' + sources.length, Math.round((Date.now() - t0) / 1000) + 's');
    emit('writing', researchText ? 'Read ' + (sources.length || 1) + ' source(s), now writing your letter…' : 'Writing your letter from your profile + the posting…');

    const prompt = coverLetterPrompt(ctx);
    const model = getPreferredModel();

    // Deltas land a few characters at a time; forwarding every one of them puts
    // hundreds of IPC messages and React renders through for one letter. Batch
    // them into at most one message every STREAM_THROTTLE_MS, which still reads
    // as live typing.
    let queued = '';
    let lastSentAt = 0;
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      if (!queued) return;
      const delta = queued;
      queued = '';
      lastSentAt = Date.now();
      send({ stage: 'stream', message: '', delta });
    };
    const queueDelta = (delta: string) => {
      queued += delta;
      if (flushTimer) return;
      const wait = STREAM_THROTTLE_MS - (Date.now() - lastSentAt);
      if (wait <= 0) { flush(); return; }
      flushTimer = setTimeout(() => { flushTimer = null; flush(); }, wait);
    };

    // The draft arrives as the JSON the prompt asked for, so what reaches the
    // page is the decoded `letter` value: prose, not escaped quotation marks.
    let raw = '';
    let shownChars = 0;
    const onDelta = (chunk: string) => {
      raw += chunk;
      const shown = jsonStringPrefix(raw, 'letter');
      if (shown.length <= shownChars) return;
      queueDelta(shown.slice(shownChars));
      shownChars = shown.length;
    };

    // 300s: legit drafts have been observed at 125s+ when the subscription is busy
    // with other sessions; a tighter cap turns that tail latency into a failure.
    let out: string;
    try {
      out = await runClaudeStream(
        prompt,
        { model, fallbackModel: 'sonnet', systemPrompt: SYS.letter, timeoutMs: 300000 },
        onDelta,
      );
    } finally {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flush();
    }

    // Streaming cannot carry --json-schema, so the shape is only a request here.
    // A letter that still opens with a brace means the JSON never closed: take
    // one schema-enforced run at it before calling the draft a failure.
    const parsed = parseCoverLetter(out);
    let body = parsed.letter.trim();
    let note = parsed.note.trim();
    if (!body || body.startsWith('{') || body.startsWith('```')) {
      log('[cover] stream output was not a readable letter, retrying with the schema');
      emit('writing', 'That draft came back garbled, writing it again…');
      const retry = await runClaudeJSONMeta<{ letter: string; note: string }>(
        prompt,
        { model, fallbackModel: 'sonnet', systemPrompt: SYS.letter, schema: LETTER_SCHEMA, timeoutMs: 300000 },
      );
      body = String(retry.data?.letter || '').trim();
      note = String(retry.data?.note || '').trim();
    }
    if (!body) throw new Error('empty draft returned');
    warnIfTemplateSlipped(body, log);
    try { saveCoverLetterForApplication(opts.applicationId, { company: opts.company, role: opts.role, jobUrl: opts.jobUrl ?? null, body }); } catch { /* persist best-effort */ }
    log('[cover] model=' + model, 'streamed=' + raw.length + 'ch');
    log('[cover] generate done', Math.round((Date.now() - t0) / 1000) + 's', 'len=' + body.length, note ? 'note' : '');
    emit('done', 'Done');
    return { body, note, researched: !!researchText, sources };
  } catch (e: any) {
    const msg = String(e?.message || e);
    log('[cover] generate FAILED', msg, Math.round((Date.now() - t0) / 1000) + 's');
    // The page shows this reason verbatim, so both routes to it (this page asked
    // for the draft, or the add flow started one) say exactly the same thing.
    const reason = /timed out/i.test(msg)
      ? 'The draft took too long (the AI was busy). Try again in a moment.'
      : ('Could not generate: ' + msg);
    emit('error', reason);
    return { body: '', researched: false, sources: [], error: reason };
  }
}

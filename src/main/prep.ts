// Background prep, hung off the app events:
//
//   application:added  -> fit score (unless already scored), then a cover-letter
//                         WORKING draft (unless one exists). Never a saved
//                         version (is_final=1), never a PDF.
//   application:stage  -> entering phone_screen / interview with empty
//                         prep_notes -> an interview prep sheet.
//
// At most two jobs at once (PrepQueue), on top of claude.ts's own semaphore.
// Progress goes out on prep:progress. Nothing here throws into a caller: every
// failure is logged and reported as state 'error'.
import type { BrowserWindow } from 'electron';
import { getApplication, getCoverLetterForApplication, getRawJobText } from './database';
import { computeFitScore } from './fit';
import { generateLetterDraft } from './cover-letter';
import { buildInterviewPrep, PREP_STAGES } from './interview-prep';
import { onAppEvent } from './events';
import { PrepQueue } from './prep-queue';
import { PLACEHOLDER_DESCRIPTION_PREFIX, type PrepStatus } from '../shared/types';

type Log = (...args: unknown[]) => void;

export type PrepJob =
  | { kind: 'add'; id: string }
  | { kind: 'interview'; id: string; force?: boolean };

let getWindow: () => BrowserWindow | null = () => null;
let log: Log = () => {};
let started = false;
/** Why a forced rebuild failed, read back by regenerateInterviewPrep. */
const forcedFailures = new Map<string, string>();

function report(s: PrepStatus): void {
  try { getWindow()?.webContents.send('prep:progress', s); } catch { /* window gone */ }
}

/** A row that is still only a quick-add placeholder has nothing to score or write from. */
function hasPosting(id: string): boolean {
  const app = getApplication(id);
  if (!app) return false;
  if ((getRawJobText(id) || '').trim()) return true;
  const desc = String(app.job_description || '').trim();
  return !!desc && !desc.startsWith(PLACEHOLDER_DESCRIPTION_PREFIX);
}

async function runAddPrep(id: string): Promise<void> {
  const app = getApplication(id);
  if (!app) return;
  if (!hasPosting(id)) { log('[prep] skipped, no posting yet', id); return; }

  if (app.fit_score == null) {
    report({ applicationId: id, task: 'fit', state: 'running' });
    try {
      const fit = await computeFitScore(id);
      log('[prep] fit', id, 'score=' + fit.score);
      report({ applicationId: id, task: 'fit', state: 'done', message: fit.reason });
    } catch (e) {
      log('[prep] fit failed', id, String(e));
      report({ applicationId: id, task: 'fit', state: 'error', message: String((e as Error)?.message || e) });
    }
  }

  if (getCoverLetterForApplication(id)) { log('[prep] draft exists, skipped', id); return; }
  const current = getApplication(id);
  if (!current) return;
  report({ applicationId: id, task: 'letter', state: 'running' });
  const r = await generateLetterDraft(
    { applicationId: id, company: current.company, role: current.job_title, jobUrl: current.job_url || undefined, location: current.location || undefined },
    {
      // The same event the detail page streams from, so an open page shows it.
      send: (payload) => { try { getWindow()?.webContents.send('coverletter:progress', payload); } catch { /* window gone */ } },
      log,
    },
  );
  if (r.error) {
    report({ applicationId: id, task: 'letter', state: 'error', message: r.error });
  } else {
    log('[prep] draft ready', id);
    report({ applicationId: id, task: 'letter', state: 'done', message: 'Draft ready' });
  }
}

async function runInterviewPrep(id: string, force: boolean): Promise<void> {
  report({ applicationId: id, task: 'interview_prep', state: 'running' });
  try {
    const wrote = await buildInterviewPrep(id, { force });
    log('[prep] interview prep', id, wrote ? 'written' : 'skipped (notes already there)');
    report({ applicationId: id, task: 'interview_prep', state: 'done', message: wrote ? 'Prep sheet ready' : 'Kept your existing notes' });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    log('[prep] interview prep failed', id, msg);
    report({ applicationId: id, task: 'interview_prep', state: 'error', message: /timed out/i.test(msg) ? 'That took too long (the AI was busy). Try again in a moment.' : msg });
    if (force) forcedFailures.set(id, msg);
  }
}

const queue = new PrepQueue<PrepJob>(
  (job) => (job.kind === 'add' ? runAddPrep(job.id) : runInterviewPrep(job.id, !!job.force)),
  {
    concurrency: 2,
    // A forced rebuild is its own job, so it is not swallowed by a pending auto one.
    keyOf: (j) => (j.kind === 'interview' && j.force ? `interview!:${j.id}` : `${j.kind}:${j.id}`),
    onError: (e, j) => log('[prep] job failed', j.kind, j.id, String(e)),
  },
);

function enqueue(job: PrepJob): Promise<void> {
  report({ applicationId: job.id, task: job.kind === 'add' ? 'fit' : 'interview_prep', state: 'queued' });
  return queue.enqueue(job);
}

/** Queue fit + working draft for one application (also used when a posting is attached later). */
export function queueApplicationPrep(id: string): void {
  if (id) void enqueue({ kind: 'add', id });
}

/**
 * Rebuild the prep sheet now, replacing prep_notes. Resolves when written;
 * rejects with the reason when it could not be.
 */
export async function regenerateInterviewPrep(id: string): Promise<void> {
  if (!getApplication(id)) throw new Error('That application no longer exists.');
  forcedFailures.delete(id);
  await enqueue({ kind: 'interview', id, force: true });
  const reason = forcedFailures.get(id);
  forcedFailures.delete(id);
  if (reason) throw new Error(reason);
}

/** Subscribe once. Safe to call again (no second subscription). */
export function startPrep(deps: { getWindow: () => BrowserWindow | null; log: Log }): void {
  getWindow = deps.getWindow;
  log = deps.log;
  if (started) return;
  started = true;
  onAppEvent((e) => {
    if (e.type === 'application:added') queueApplicationPrep(e.id);
    else if (e.type === 'application:stage' && PREP_STAGES.has(e.to)) {
      const app = getApplication(e.id);
      if (app && !String(app.prep_notes || '').trim()) void enqueue({ kind: 'interview', id: e.id });
    }
  });
}

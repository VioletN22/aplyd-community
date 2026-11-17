// Electron glue for inbox sync: the email:* IPC handlers, the scheduler and
// the production wiring of the engine's dependencies. Every handler answers the
// app's one IPC envelope, { ok, data?, error? }.
//
// The password comes in once, over email:addAccount, goes straight to the
// Keychain and is never returned, stored in sqlite or logged.

import { ipcMain, powerMonitor, shell, type BrowserWindow } from 'electron';
import {
  getDatabase, createStageHistory, getApplication, updateApplication, createApplication,
} from '../database';
import { emitAppEvent } from '../events';
import { PLACEHOLDER_DESCRIPTION } from '../../shared/types';
import type { EmailAccount, EmailEventStatus, EmailSyncStatus } from '../../shared/types';
import { EmailStore, publicEvent } from './store';
import { Keychain } from './keychain';
import { EmailSync, type StageOps, type ActionItemOps } from './sync';
import { createEmailScheduler, RESUME_DELAY_MS, type SyncReason } from './scheduler';
import { upsertDetectedActionItem } from '../action-items';

const APP_PASSWORD_URL = 'https://myaccount.google.com/apppasswords';

type Log = (...args: unknown[]) => void;
type Ipc<T> = { ok: boolean; data?: T; error?: string };

const failed = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Stage moves through the same functions the renderer's stage change uses. */
const productionStages: StageOps = {
  move(applicationId, stage, note) {
    const h = createStageHistory(applicationId, stage, note);
    // updateApplication emits application:stage, so interview prep runs as for a hand move.
    updateApplication(applicationId, { current_stage: stage });
    return h.id;
  },
  addNote(applicationId, line) {
    const app = getApplication(applicationId);
    if (!app) return;
    const notes = app.notes ? `${app.notes}\n${line}` : line;
    updateApplication(applicationId, { notes });
  },
  create({ company, role, notes }) {
    const app = createApplication({
      company, job_title: role, location: '', job_url: '', job_source: 'Email',
      salary_min: null, salary_max: null, equity: null, benefits: null,
      // No posting to read: the placeholder keeps fit and letter prep from running on nothing.
      job_description: PLACEHOLDER_DESCRIPTION, key_responsibilities: '', required_skills: '', nice_to_have_skills: '',
      team_info: null, hiring_timeline: null, application_deadline: null,
    }, undefined, notes);
    createStageHistory(app.id, 'applied', notes);
    emitAppEvent({ type: 'application:added', id: app.id });
    return app.id;
  },
};

/** Detected "book a time" / "verify SEEK Pass" emails become Today action items. */
const productionActionItems: ActionItemOps = {
  upsertDetected(ctx) {
    upsertDetectedActionItem(getDatabase() as any, ctx);
  },
};

let engine: EmailSync | null = null;
let store: EmailStore | null = null;
const keychain = new Keychain();
let getWindow: () => BrowserWindow | null = () => null;
let log: Log = () => {};

/** Lazily built on first use, once the database exists. */
function sync(): EmailSync {
  if (engine) return engine;
  store = new EmailStore(getDatabase() as any);
  engine = new EmailSync({
    store,
    // imap.ts pulls in imapflow + mailparser; load it only when a sync runs.
    fetcher: (opts) => require('./imap').scanAccount(opts),
    classify: (input) => require('./classify').classifyEmail(input),
    classifyBatch: (inputs) => require('./classify').classifyEmails(inputs),
    classifySecondPass: (emails, apps) => require('./classify').classifyAgainstAll(emails, apps),
    getPassword: (email) => keychain.getPassword(email),
    stages: productionStages,
    actionItems: productionActionItems,
    explain: (err, email) => require('./imap').explainImapFailure(err, { email, provider: 'gmail' }),
    onStatus: (s: EmailSyncStatus) => {
      try { getWindow()?.webContents.send('email:progress', s); } catch { /* window gone */ }
    },
  });
  return engine;
}

function emailStore(): EmailStore { sync(); return store!; }

const toAccount = (a: { email: string; lastSyncAt: string | null; lastError: string | null }): EmailAccount =>
  ({ email: a.email, provider: 'gmail', lastSyncAt: a.lastSyncAt, lastError: a.lastError });

/**
 * Kick a sync in the background; errors land on the status and the account row,
 * never on the app. `again`: run once more after a sync already going (a new
 * inbox must not wait half an hour for its backlog).
 */
function startBackground(reason: string, again = false): void {
  sync().start({ again })
    .then((s) => log(`[email] sync (${reason}) ${s.phase}: seen=${s.seen} candidates=${s.candidates} auto=${s.autoApplied} waiting=${s.pendingCount}`
      + (s.phase === 'error' || s.pendingCount ? ` | ${s.message}` : '')))
    .catch((e) => log('[email] sync crashed', failed(e)));
}

async function wrap<T>(name: string, fn: () => Promise<T> | T): Promise<Ipc<T>> {
  try { return { ok: true, data: await fn() }; }
  catch (e) { log(`[email] ${name} err`, failed(e)); return { ok: false, error: failed(e) }; }
}

export function registerEmailIpc(opts: { getWindow: () => BrowserWindow | null; log: Log }): void {
  getWindow = opts.getWindow;
  log = opts.log;

  ipcMain.handle('email:addAccount', (_e, email: string, appPassword: string) => wrap('addAccount', async () => {
    const address = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('That does not look like an email address.');
    // Google shows app passwords in groups of four; the spaces are not part of it.
    const password = String(appPassword || '').replace(/\s+/g, '');
    if (!password) throw new Error('Paste the app password first.');
    const { verifyAccount } = require('./imap') as typeof import('./imap');
    const verified = await verifyAccount(address, password, 'gmail');
    if (!verified.ok) throw new Error(verified.error);
    await keychain.setPassword(address, password);
    emailStore().addAccount(address);
    startBackground('account added', true);
    return toAccount(emailStore().getAccount(address)!);
  }));

  ipcMain.handle('email:removeAccount', (_e, email: string) => wrap('removeAccount', async () => {
    await keychain.deletePassword(email);
    emailStore().removeAccount(email);
  }));

  ipcMain.handle('email:listAccounts', () => wrap('listAccounts', () => emailStore().listAccounts().map(toAccount)));

  ipcMain.handle('email:syncNow', () => wrap('syncNow', () => {
    startBackground('manual');
    return sync().status();
  }));

  ipcMain.handle('email:status', () => wrap('status', () => sync().status()));

  ipcMain.handle('email:listEvents', (_e, o?: { status?: EmailEventStatus | 'all'; applicationId?: string }) =>
    wrap('listEvents', () => emailStore().listEvents(o || {}).map(publicEvent)));

  ipcMain.handle('email:openAppPasswordPage', () => wrap('openAppPasswordPage', async () => {
    await shell.openExternal(APP_PASSWORD_URL);
  }));
}

const scheduler = createEmailScheduler((reason: SyncReason) => {
  try {
    if (!emailStore().listAccounts().length) return;
    startBackground(reason);
  } catch (e) {
    log('[email] scheduler skipped', failed(e));
  }
});
let scheduled = false;

/**
 * First sync a minute after launch, then every half hour, and 45 seconds after
 * the Mac wakes from sleep (timers do not count time asleep, so without it a
 * day-long sleep left the inbox unread until the next half-hour tick). Called
 * once the database is initialized; does nothing until an account exists, and
 * a run that is still going simply absorbs the next tick.
 */
export function startEmailScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  scheduler.start();
  try {
    powerMonitor.on('resume', () => {
      log(`[email] woke from sleep: sync in ${RESUME_DELAY_MS / 1000}s`);
      scheduler.resumed();
    });
  } catch (e) {
    log('[email] no wake trigger', failed(e));
  }
}

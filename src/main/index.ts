import { registerSkillIpc } from './skills-service';
import { aiStatus, configureAI, testAI } from './ai-settings';
import { cancelAllAI } from './ai-provider';
import type { AIConfigure } from '../shared/ai-types';
import type { ReviewPeriod } from '../shared/cockpit-stats';
import { initializeCommunityData, isDevelopmentMode } from './community-data';
import { chooseFormatLocale, closeOnQuit, databaseErrorText, runStartupSteps, versionMenuLabel } from './startup';
import { initializeCalendarPreferences } from './calendar/preferences';
import { readCalendarPreferences, saveCalendarPreferences } from './calendar/preferences';
import { cockpitStats } from './cockpit-stats';
import {CalendarService} from './calendar/service';
import type {CalendarCredentials} from './calendar/oauth';
import {listLeads, getLead, saveLead, importLeads} from './leads';
import {parseLeadImport} from '../shared/lead-import';
import type {Lead} from '../shared/leads';
import {listApprovals, decideStoredApproval, approveAll} from './approvals';
import type {ApprovalDecision, ReviewedApproval} from '../shared/approvals';
import {getCockpit} from './cockpit';
import {watchDataVersion} from './data-version';
import { displayLocale, setDisplayLocale } from '../shared/locale';
let stopDataVersion: (() => void) | undefined;
import { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, MenuItemConstructorOptions } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

// A dedicated app name and data folder, so this app never reads data written by another Aplyd build.
app.setName('Aplyd Community');
app.setPath('userData', path.join(app.getPath('appData'), 'aplyd-community'));

const isDev = isDevelopmentMode(app.isPackaged, process.env.NODE_ENV, process.argv);

// File-based logging that survives even when there's no attached console. Uses the OS
// temp dir so it works on Windows too (not a hardcoded /tmp).
const LOG_PATH = path.join(os.tmpdir(), 'aplyd-community-main.log');
function log(...args: unknown[]) {
  const line = new Date().toISOString() + ' ' + args.map(String).join(' ') + '\n';
  try { fs.appendFileSync(LOG_PATH, line); } catch { /* ignore */ }
  console.log(...args);
}
process.on('unhandledRejection', (err) => log('[unhandledRejection]', err));
process.on('uncaughtException', (err) => log('[uncaughtException]', err));

// Single-instance lock: second launch focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

import {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  getAllApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  getStageHistoryForApplication,
  createStageHistory,
  updateStageHistory,
  createApplication,
  setApplicationResume,
  getAnswerBank,
  upsertAnswer,
  deleteAnswer,
  getDocuments,
  addDocument,
  deleteDocument,
  setDocumentDefault,
  getResumeFocus,
  setResumeFocus,
  getVoiceNotes,
  addVoiceNote,
  deleteVoiceNote,
  getPortfolioLinks,
  addPortfolioLink,
  deletePortfolioLink,
  getCoverLetters,
  saveCoverLetter,
  deleteCoverLetter,
  getCoverLetterForApplication,
  saveCoverLetterForApplication,
  saveCoverLetterVersion,
  getSavedCoverLettersForApplication,
  getSetting,
  setSetting,
  setRawJobText,
  startupBackup,
} from './database';
import { setAutopilotHost, attachHostIfLoaded, shutdownDriveIfLoaded } from './autopilot-lazy';
import {
  coverLetterPrompt, refineCoverLetterPrompt, coverLetterStudioPrompt,
  LETTER_SCHEMA, STUDIO_SCHEMA, parseCoverLetter,
  profileSeedPrompt, parseProfileSeed, fetchUrlText,
} from './autopilot-prompts';
import { hydrateLetterContext, hydrateStandaloneLetterContext, ensureVoiceProfile } from './letter-context';
import { assistantHistory, assistantReply } from './assistant';
import { computeFitScore } from './fit';
import { extractJobListing, runClaudeCLI, runClaudeJSONMeta, runClaudeStream, jsonStringPrefix, killClaudeProcesses, getPreferredModel, SYS, singleUrlOf, bareUrl } from './claude';
import { getFlowData } from './flow';
import { registerEmailIpc, startEmailScheduler } from './email/service';
import { registerActionItemsIpc } from './action-items';
import { generateLetterDraft, warnIfTemplateSlipped, type LetterGenOpts } from './cover-letter';
import { letterPdfBase, profileFullName, uniquePdfPath } from './letter-file';
import { getProfile } from './autopilot-prompts';
import { emitAppEvent } from './events';
import { startPrep, queueApplicationPrep, regenerateInterviewPrep } from './prep';
import { outcomeStats, todayData } from './stats';
import { JobApplication, Workflow, StageHistory, ExtractedJobData, BatchAddProgress, PLACEHOLDER_DESCRIPTION, STAGES, isStage } from '../shared/types';
import { initQuickAdd } from './quick-add';
import { listPrepFiles } from './prep-files';

let calendarService: CalendarService | null = null;
function getCalendarService(): CalendarService {
  if (!calendarService) calendarService = new CalendarService(
    () => getCockpit(getDatabase()).events,
    {get: key => getSetting(key), set: (key,value) => setSetting(key,value)},
    () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('calendar:changed'); },
    url => shell.openExternal(url),
  );
  return calendarService;
}

let mainWindow: BrowserWindow | null = null;
let isStarting = false;

// The research driver parks its (hidden) view inside this window, and loads long
// after it exists (the first live company research), so it asks for it.
setAutopilotHost(() => mainWindow);

// Inline splash as base64 data URL: shows instantly, no file I/O
const SPLASH_HTML = Buffer.from(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111010;display:flex;flex-direction:column;align-items:center;
     justify-content:center;height:100vh;font-family:-apple-system,sans-serif;
     color:#f0ede8;-webkit-app-region:drag;user-select:none}
.logo{font-size:52px;font-weight:300;letter-spacing:-.03em}
.logo span{color:#f23a17}
.bar{margin-top:28px;width:120px;height:3px;background:#222;border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;width:40%;background:#f23a17;border-radius:2px;
       animation:s 1.1s ease-in-out infinite}
@keyframes s{0%{margin-left:-42%}100%{margin-left:102%}}
.sub{margin-top:14px;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#555}
</style></head><body>
<div class="logo">aply<span>d</span></div>
<div class="bar"><i></i></div>
<div class="sub">loading…</div>
</body></html>`).toString('base64');
const SPLASH_URL = `data:text/html;base64,${SPLASH_HTML}`;

const APP_URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(__dirname, '../renderer/index.html')}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111010',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer is plain React over the preload bridge: it needs no Node and
      // no relaxed origin rules, so it runs in the OS sandbox with web security on.
      sandbox: true,
      webSecurity: true,
    },
    title: 'Aplyd Community',
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Let the research driver's view attach to this window. Only if the driver is
  // already loaded: on a first load it asks for the window itself (see
  // autopilot-lazy).
  attachHostIfLoaded(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Never let the privileged window navigate away from the app itself. This window
  // carries the preload bridge, so a remote origin loaded here would inherit the
  // whole IPC surface. Company research pages live in the driver's BrowserView
  // (own session, no preload), never here. Anything else opens in the real browser instead.
  const isAppUrl = (url: string) =>
    url === APP_URL
    || url === SPLASH_URL
    || url.startsWith('http://localhost:5173')
    || url.startsWith('file://')
    || url.startsWith('devtools://')
    || url === 'about:blank';
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    log('[nav] blocked will-navigate', url.slice(0, 120));
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    log('[nav] blocked will-redirect', url.slice(0, 120));
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('[did-fail-load]', code, desc, url);
  });

  // Show the splash the moment it renders, then swap in the real app once it
  // has finished loading. We track which URL just loaded so the splash handler
  // doesn't re-trigger when the app URL finishes.
  let appLoadRequested = false;
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) return;
    const current = mainWindow.webContents.getURL();
    log('[did-finish-load]', current.slice(0, 40));

    if (!appLoadRequested) {
      // Splash just rendered, so reveal the window IMMEDIATELY, before any
      // heavy work. The user sees the loading screen right away.
      mainWindow.setAlwaysOnTop(true, 'floating');
      mainWindow.show();
      mainWindow.focus();
      app.focus({ steal: true });
      appLoadRequested = true;
      log('[show] window visible, uptime=' + process.uptime().toFixed(3));

      const swap = () => {
        if (!mainWindow) return;
        // Initialize the DB now: this triggers the native better-sqlite3
        // load, but the window is already on screen so the user never waits
        // on a blank dock icon. Done before loading the app so the first
        // renderer IPC call finds the DB ready.
        // Only the database is required. Calendar, inbox, prep and quick add
        // are logged and skipped when they fail, and the app opens anyway.
        const ok = runStartupSteps([
          { name: 'database', run: () => initializeDatabase() },
          {
            name: 'database watcher',
            run: () => {
              stopDataVersion?.();
              stopDataVersion = watchDataVersion(
                () => (getDatabase().prepare('PRAGMA data_version').get() as {data_version:number}).data_version,
                () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('db:changed'); },
              );
              log('[swap] db initialized, uptime=' + process.uptime().toFixed(3));
              // Today's snapshot, taken behind the app: it never blocks the load.
              startupBackup().then(logBackup).catch((e) => log('[backup] failed:', e));
            },
          },
        ], [
          { name: 'calendar preferences', run: () => initializeCalendarPreferences() },
          { name: 'calendar sync', run: () => getCalendarService().start() },
          // Inbox sync: first run a minute from now, only if an account exists.
          { name: 'inbox sync', run: () => startEmailScheduler() },
          // Background prep: fit + working draft on add, prep sheet on interview.
          { name: 'prep', run: () => startPrep({ getWindow: () => mainWindow, log }) },
          { name: 'quick add', run: () => initQuickAdd({ addFromText: addApplicationFromText, getWindow: () => mainWindow, log }) },
        ], {
          log,
          onFatal: (reason) => {
            // A broken or newer-version database must not boot into a renderer
            // where every action silently fails. Tell the user what is wrong and
            // how to restore a backup, then quit.
            const text = databaseErrorText(reason, path.join(app.getPath('userData'), 'backups'));
            dialog.showErrorBox(text.title, text.body);
            closeDatabase();
            app.quit();
          },
        });
        if (!ok) return;
        log('[swap] loading app url', APP_URL.slice(0, 60));
        mainWindow.setAlwaysOnTop(false);
        mainWindow.loadURL(APP_URL);
        isStarting = false;
      };
      // Defer one tick so the splash actually paints before we block the
      // main thread loading the native module. In dev, Vite needs a beat.
      if (isDev) setTimeout(swap, 800);
      else setTimeout(swap, 16);
    } else if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  log('[createWindow] loading splash');
  mainWindow.loadURL(SPLASH_URL);
}

/**
 * The application menu, which the app had been running without.
 *
 * Two jobs: Cmd+N starts a new application from anywhere, and the standard Edit
 * roles exist at all. Without an Edit menu Electron never wires the system copy,
 * paste and select-all accelerators, so Cmd+C in a letter textarea did nothing.
 */
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const macAppMenu: MenuItemConstructorOptions[] = isMac
    ? [{
        label: 'Aplyd Community',
        submenu: [
          { role: 'about' }, { type: 'separator' },
          { role: 'services' }, { type: 'separator' },
          { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
          { role: 'quit' },
        ],
      }]
    : [];
  const template: MenuItemConstructorOptions[] = [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'New application',
          accelerator: 'CmdOrCtrl+N',
          click: () => { try { mainWindow?.webContents.send('nav:new'); } catch { /* window gone */ } },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(isMac
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] as MenuItemConstructorOptions[]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as MenuItemConstructorOptions[]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
    {
      role: 'help',
      submenu: [
        // The version, readable on every platform (macOS also has About).
        { label: versionMenuLabel(app.getVersion()), enabled: false },
        { type: 'separator' },
        // A privacy-respecting update check: it opens the releases page in the
        // browser. Aplyd never phones home or downloads anything by itself.
        {
          label: 'Check for updates',
          click: () => { void shell.openExternal('https://github.com/VioletN22/aplyd-community/releases'); },
        },
        {
          label: 'Report an issue',
          click: () => { void shell.openExternal('https://github.com/VioletN22/aplyd-community/issues'); },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/** The one line the log gets about today's snapshot. */
function logBackup(r: Awaited<ReturnType<typeof startupBackup>>): void {
  if (!r.ok) { log('[backup] failed:', r.error); return; }
  log('[backup]', r.skipped ? "today's snapshot already exists" : 'wrote ' + r.file,
    '| kept=' + r.kept, 'pruned=' + r.pruned);
}

// Headless boot self-check: run the REAL packaged main process (load the native
// DB module, run a query) and exit 0/1 WITHOUT opening a window. Catches native-load / missing-module crashes
// on a runner with no display. Triggered with APLYD_SMOKETEST=1.
async function runSmokeTest(): Promise<void> {
  try {
    initializeDatabase();
    initializeCalendarPreferences();
    const row = getDatabase().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) throw new Error('db query failed');
    // The rolling snapshot is part of a real boot, so the self-check waits for it
    // and reports it. A failed backup is reported, never fatal: the app boots
    // regardless, and so does this.
    logBackup(await startupBackup());
    log('[smoketest] OK platform=' + process.platform);
    closeDatabase();
    app.exit(0);
  } catch (e) {
    log('[smoketest] FAIL ' + String(e));
    closeDatabase();
    app.exit(1);
  }
}

// Content-Security-Policy for the packaged renderer.
//
// Scoped deliberately: it is stamped ONLY onto the app's own file:// document.
// Two things must not be touched. (1) The research driver's view loads real
// company sites; it lives on the persist:autopilot session, but we filter on the
// URL as well so a session change can never silently start breaking them. (2) The
// offscreen PDF windows render data: URLs, which a default-src 'self' policy
// would strangle. Dev is exempt so Vite's HMR websocket keeps working.
//
// The renderer makes no network requests of its own (everything goes over IPC),
// so connect-src can be as tight as everything else.
const RENDERER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; "
  + "base-uri 'none'; frame-src 'none'";

function applyRendererCsp(): void {
  if (isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    // Anything that is not the app's own file:// document passes through untouched.
    if (!details.url.startsWith('file://')) return cb({});
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [RENDERER_CSP] } });
  });
}

/**
 * The user's own locale for dates and numbers: the OS regional format, else the
 * first preferred language, else English.
 */
function systemLocale(): string {
  return chooseFormatLocale({
    systemLocale: () => app.getSystemLocale(),
    preferredLanguages: () => app.getPreferredSystemLanguages(),
  });
}

// The renderer asks once, from the preload, so both halves format alike.
ipcMain.on('locale:get', (e) => { e.returnValue = displayLocale() || ''; });

app.whenReady().then(() => {
  setDisplayLocale(systemLocale());
  registerSkillIpc(() => app.getPath('userData'));
  // If the data folder itself is unusable the app cannot run. Show the reason
  // (and where to look) instead of a dock icon with no window, then quit.
  try {
    initializeCommunityData(app.getPath('userData'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log('[whenReady] community data init failed:', reason);
    dialog.showErrorBox(
      'Aplyd Community cannot open its data',
      `${reason}\n\nData folder:\n${app.getPath('userData')}`,
    );
    closeDatabase();
    app.quit();
    return;
  }
  log('[whenReady] uptime=' + process.uptime().toFixed(3) + ' isPackaged=' + app.isPackaged);
  if (process.env.APLYD_SMOKETEST === '1') { void runSmokeTest(); return; }
  isStarting = true;
  applyRendererCsp();
  // Create the window FIRST. Everything that needs the database (the DB itself,
  // today's backup) happens inside swap(), once the splash
  // is visible and before the app URL loads, so cold start stays minimal and the
  // first renderer IPC call still finds the DB ready.
  createWindow();
  try { buildAppMenu(); } catch (e) { log('[menu] failed to build application menu', e); }
});

// Every quit path closes the database cleanly, which folds the WAL back into
// job-tracker.db. window-all-closed below covers Windows and Linux too.
closeOnQuit(app, closeDatabase);

// On quit, reap any in-flight `claude` subprocesses so nothing is left running
// after the app exits.
app.on('before-quit', () => {
  calendarService?.stop();
  stopDataVersion?.();
  try { killClaudeProcesses(); } catch { /* ignore */ }
});

app.on('window-all-closed', () => {
  calendarService?.stop();
  calendarService = null;
  stopDataVersion?.();
  closeDatabase();
  // Only if research ever ran: loading the driver just to shut down a browser
  // that was never opened would undo the deferral.
  shutdownDriveIfLoaded();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    if (!isStarting) {
      isStarting = true;
      createWindow();
    }
  } else if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.focus();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow.focus();
  }
});

// Every handler below answers { ok, data?, error? }, the one IPC contract in the
// app. A thrown handler crosses IPC as an "Error invoking remote method" string
// with the real reason buried in it, which is neither showable nor catchable in
// any useful way; an envelope is both, and the renderer reads .ok / .error.

/** Why a call failed, in words worth showing them. */
const failed = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Inbox sync (email:*): accounts, sync runs, the per-application email list. See email/service.ts.
registerEmailIpc({ getWindow: () => mainWindow, log });
// Today action items: the one today:markActionItemDone channel. See action-items.ts.
registerActionItemsIpc();

// Flow (Sankey) IPC Handler

/**
 * Get the aggregated application flow (nodes + links + summary) for the
 * Sankey view. Computed fresh from stage_history on each call.
 */
ipcMain.handle('flow:getData', async () => {
  try { return { ok: true, data: getFlowData() }; }
  catch (e) { log('[flow] getData err', String(e)); return { ok: false, error: failed(e) }; }
});

// Database IPC Handlers

/**
 * Get all applications with optional filters
 */
ipcMain.handle('db:getAllApplications', async (_event, filters?) => {
  try { return { ok: true, data: getAllApplications(filters) }; }
  catch (e) { log('[db] getAllApplications err', String(e)); return { ok: false, error: failed(e) }; }
});

/**
 * Get a single application by ID
 */
ipcMain.handle('db:getApplication', async (_event, id: string) => {
  try { return { ok: true, data: getApplication(id) }; }
  catch (e) { log('[db] getApplication err', String(e)); return { ok: false, error: failed(e) }; }
});

/**
 * Update an application
 */
ipcMain.handle('db:updateApplication', async (_event, id: string, updates: Partial<JobApplication>) => {
  try { return { ok: true, data: updateApplication(id, updates) }; }
  catch (e) { log('[db] updateApplication err', String(e)); return { ok: false, error: failed(e) }; }
});

/**
 * Delete an application
 */
ipcMain.handle('db:deleteApplication', async (_event, id: string) => {
  try { deleteApplication(id); return { ok: true }; }
  catch (e) { log('[db] deleteApplication err', String(e)); return { ok: false, error: failed(e) }; }
});

/**
 * Get stage history for an application
 */
ipcMain.handle('db:getStageHistory', async (_event, applicationId: string) => {
  try { return { ok: true, data: getStageHistoryForApplication(applicationId) }; }
  catch (e) { log('[db] getStageHistory err', String(e)); return { ok: false, error: failed(e) }; }
});

/**
 * Create a stage history entry
 */
ipcMain.handle('db:createStageHistory', async (_event, applicationId: string, stage: string, notes?: string) => {
  try {
    if (!isStage(stage)) return { ok: false, error: `Unknown stage "${stage}". Stages are: ${STAGES.join(', ')}.` };
    return { ok: true, data: createStageHistory(applicationId, stage, notes || null) };
  }
  catch (e) { log('[db] createStageHistory err', String(e)); return { ok: false, error: failed(e) }; }
});

/**
 * Update a stage history entry
 */
ipcMain.handle('db:updateStageHistory', async (_event, id: string, updates: Partial<StageHistory>) => {
  try { return { ok: true, data: updateStageHistory(id, updates) }; }
  catch (e) { log('[db] updateStageHistory err', String(e)); return { ok: false, error: failed(e) }; }
});

// Workflow IPC shims. Per-company workflows are gone: every application uses
// the fixed STAGES list. These answer the old channels until the renderer stops
// calling them, then they can be deleted with the preload entries.
const STANDARD_WORKFLOW: Workflow = { id: 'standard', company: '', name: 'Standard', stages: [...STAGES], is_default: true, created_at: '' };
const WORKFLOWS_GONE = 'Workflows are gone: every application uses the same stages now.';
ipcMain.handle('db:getAllWorkflows', async () => ({ ok: true, data: [STANDARD_WORKFLOW] }));
ipcMain.handle('db:createWorkflow', async () => ({ ok: false, error: WORKFLOWS_GONE }));
ipcMain.handle('db:updateWorkflow', async () => ({ ok: false, error: WORKFLOWS_GONE }));
ipcMain.handle('db:deleteWorkflow', async () => ({ ok: false, error: WORKFLOWS_GONE }));

// ── Wave 2: resume sent, background prep, outcomes, Today ────────────────────
ipcMain.handle('applications:setResume', async (_e, applicationId: string, docId: string | null) => {
  try { return { ok: true, data: setApplicationResume(applicationId, docId ?? null) }; }
  catch (e) { log('[resume] setResume err', String(e)); return { ok: false, error: failed(e) }; }
});
// Prep sheets saved as files: listed per application; only a listed file opens.
ipcMain.handle('prep:files', async (_e, applicationId: string) => {
  try { return { ok: true, data: listPrepFiles(getDatabase() as any, applicationId) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
});
ipcMain.handle('prep:openFile', async (_e, applicationId: string, filePath: string) => {
  const known = listPrepFiles(getDatabase() as any, applicationId).some((f) => f.path === filePath);
  if (!known) return { ok: false, error: 'That file is not linked to this application.' };
  const err = await shell.openPath(filePath);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('prep:regenerateInterviewPrep', async (_e, applicationId: string) => {
  try {
    await regenerateInterviewPrep(applicationId);
    return { ok: true, data: getApplication(applicationId) };
  } catch (e) { log('[prep] regenerate err', String(e)); return { ok: false, error: failed(e) }; }
});
ipcMain.handle('stats:cockpit', async (_e, period?: ReviewPeriod) => {
  try { return {ok:true,data:cockpitStats(getDatabase(), undefined, period)}; }
  catch (e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('stats:outcomes', async () => {
  try { return { ok: true, data: outcomeStats(getDatabase()) }; }
  catch (e) { log('[stats] outcomes err', String(e)); return { ok: false, error: failed(e) }; }
});
ipcMain.handle('calendar:preferences', async () => {
  try { return {ok:true, data:readCalendarPreferences()}; } catch(e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('calendar:savePreferences', async (_e, input: unknown) => {
  try {
    const data = saveCalendarPreferences(input);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('calendar:changed');
    return {ok:true, data};
  } catch(e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('calendar:status', async () => {
  try { return {ok:true,data:await getCalendarService().getStatus()}; }
  catch (e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('calendar:connect', async (_e, credentials: CalendarCredentials) => {
  try { return {ok:true,data:await getCalendarService().connect(credentials)}; }
  catch (e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('calendar:disconnect', async () => {
  try { await getCalendarService().disconnect(); return {ok:true}; }
  catch (e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('calendar:sync', async () => {
  try { await getCalendarService().sync(); return {ok:true}; }
  catch (e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('calendar:week', async (_e, startDay: string) => {
  try { return {ok:true,data:await getCalendarService().week(startDay)}; }
  catch (e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('leads:list', async () => {
  try { return {ok: true, data: listLeads(getDatabase())}; }
  catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('leads:get', async (_e, id: string) => {
  try { return {ok: true, data: getLead(getDatabase(), id)}; }
  catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('leads:save', async (_e, input: Partial<Lead> & Pick<Lead, 'org' | 'segment' | 'stage'>, expectedUpdatedAt?: string) => {
  try { return {ok: true, data: saveLead(getDatabase(), input, expectedUpdatedAt)}; }
  catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('leads:importTracker', async () => {
  try {
    const picked = await dialog.showOpenDialog({ title: 'Choose an outreach CSV', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: { insertedLeads: 0, insertedEvents: 0, skipped: 0, problems: [] } };
    const trackerPath = picked.filePaths[0];
    if (fs.statSync(trackerPath).size > 10 * 1024 * 1024) throw new Error('Choose a CSV smaller than 10 MB.');
    const suppression = await dialog.showOpenDialog({ title: 'Optional suppression CSV (Cancel to skip)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    const suppressionPath = suppression.canceled ? null : suppression.filePaths[0];
    if (suppressionPath && fs.statSync(suppressionPath).size > 10 * 1024 * 1024) throw new Error('Choose a suppression CSV smaller than 10 MB.');
    const data = parseLeadImport(fs.readFileSync(trackerPath, 'utf8'), suppressionPath ? fs.readFileSync(suppressionPath, 'utf8') : '');
    const backupDirectory = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupDirectory, {recursive: true});
    await getDatabase().backup(path.join(backupDirectory, `job-tracker-before-lead-import-${Date.now()}.db`));
    return {ok: true, data: importLeads(getDatabase(), data)};
  } catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('approvals:list', async (_e, filter?: {applicationId?: string; leadId?: string}) => {
  try { return {ok: true, data: listApprovals(getDatabase(), filter)}; }
  catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('approvals:decide', async (_e, id: string, decision: ApprovalDecision) => {
  try { return {ok: true, data: decideStoredApproval(getDatabase(), id, decision)}; }
  catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('approvals:approveAll', async (_e, reviewed: ReviewedApproval[]) => {
  try { return {ok: true, data: approveAll(getDatabase(), reviewed)}; }
  catch (e) { return {ok: false, error: failed(e)}; }
});
ipcMain.handle('cockpit:get', async () => {
  try { return {ok:true,data:getCockpit(getDatabase())}; }
  catch(e) { return {ok:false,error:failed(e)}; }
});
ipcMain.handle('today:get', async () => {
  try { return { ok: true, data: todayData(getDatabase()) }; }
  catch (e) { log('[today] get err', String(e)); return { ok: false, error: failed(e) }; }
});

// File Operations IPC Handler

/**
 * Paths the user has explicitly chosen through a native dialog this session.
 *
 * Every path-taking handler checks this set, so a compromised renderer cannot
 * hand the main process an arbitrary absolute path (say ~/.ssh/id_rsa) to read
 * or copy into the document locker. The set is per-session on purpose: it dies
 * with the process, and picking a file again is one click.
 */
const pickedPaths = new Set<string>();

/**
 * Open file dialog and return file content
 */
ipcMain.handle('file:selectFile', async (_event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'Job listing', extensions: ['txt', 'md', 'pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, data: null };
    }

    const filePath = result.filePaths[0];
    pickedPaths.add(filePath);

    let content = '';
    if (/\.pdf$/i.test(filePath)) {
      // A posting saved as a PDF is common. pdf-parse is already a dependency
      // (the resume locker uses it), so read the text out instead of returning
      // binary garbage the way the utf-8 read used to.
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(fs.readFileSync(filePath));
        content = String(data.text || '').trim();
      } catch (e) {
        log('[file:selectFile] pdf parse failed', e);
        content = '';
      }
    } else if (/\.(txt|md|markdown)$/i.test(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      // Images and unknown binaries are not a job listing in any readable sense.
      return { ok: true, data: { filePath, content: '', note: "That file type can't be read as text. Paste the job text instead." } };
    }

    return { ok: true, data: { filePath, content } };
  } catch (e) {
    log('[file] selectFile err', String(e));
    return { ok: false, error: failed(e) };
  }
});

// ── Structured profile: who the user is, and how a letter signs off ───────────────
ipcMain.handle('autopilot:profile:get', async () => { try { return JSON.parse(getSetting('profile') || '{}'); } catch { return {}; } });
ipcMain.handle('autopilot:profile:set', async (_e, profile: Record<string, string>) => { setSetting('profile', JSON.stringify(profile || {})); return { ok: true }; });
ipcMain.handle('autopilot:profile:seed', async () => {
  const out = await runClaudeCLI(profileSeedPrompt(), { timeoutMs: 60000, model: 'sonnet', systemPrompt: SYS.extract }).catch(() => '');
  const seeded = parseProfileSeed(out);
  if (Object.keys(seeded).length) {
    let current: Record<string, string> = {};
    try { current = JSON.parse(getSetting('profile') || '{}'); } catch { /* ignore */ }
    const merged = { ...seeded, ...current }; // never clobber values you already set
    setSetting('profile', JSON.stringify(merged));
    return merged;
  }
  return {};
});

// ── Answer bank / document locker / voice profile (historical autopilot: names)
ipcMain.handle('autopilot:getAnswerBank', async () => getAnswerBank());
ipcMain.handle('autopilot:upsertAnswer', async (_e, entry) => upsertAnswer(entry));
ipcMain.handle('autopilot:deleteAnswer', async (_e, id: string) => { deleteAnswer(id); return { ok: true }; });
ipcMain.handle('autopilot:getDocuments', async () => getDocuments());
ipcMain.handle('autopilot:pickDocument', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const picked = result.filePaths[0];
  pickedPaths.add(picked);
  return picked; // path only, never read PDF bytes as utf-8
});
ipcMain.handle('autopilot:addDocument', async (_e, label: string, filePath: string, tags: string[], isDefault: boolean) => {
  // Only a path the user actually picked with the dialog this session. Locker
  // documents are read back into prompts, so an arbitrary path here would be an
  // arbitrary-file-read primitive.
  if (!pickedPaths.has(filePath)) return { ok: false, error: 'Document must be chosen with the file picker.' };
  try { return { ok: true, data: addDocument(label, filePath, tags, isDefault) }; }
  catch (e) { log('[locker] addDocument err', String(e)); return { ok: false, error: failed(e) }; }
});
ipcMain.handle('autopilot:deleteDocument', async (_e, id: string) => { deleteDocument(id); return { ok: true }; });
ipcMain.handle('autopilot:setDocumentDefault', async (_e, id: string) => { setDocumentDefault(id); return { ok: true }; });
ipcMain.handle('autopilot:getResumeFocus', async () => getResumeFocus());
ipcMain.handle('autopilot:setResumeFocus', async (_e, docId: string, focus: string) => { setResumeFocus(docId, focus); return { ok: true }; });
ipcMain.handle('autopilot:getVoiceNotes', async () => getVoiceNotes());
ipcMain.handle('autopilot:addVoiceNote', async (_e, kind: string, note: string) => addVoiceNote(kind as any, note));
ipcMain.handle('autopilot:deleteVoiceNote', async (_e, id: string) => { deleteVoiceNote(id); return { ok: true }; });

// Portfolio links (a live website Claude can reference / fetch)
ipcMain.handle('autopilot:getPortfolioLinks', async () => getPortfolioLinks());
ipcMain.handle('autopilot:addPortfolioLink', async (_e, label: string, url: string) => addPortfolioLink(label, url));
ipcMain.handle('autopilot:deletePortfolioLink', async (_e, id: string) => { deletePortfolioLink(id); return { ok: true }; });

// Cover-letter vault + studio
ipcMain.handle('autopilot:getCoverLetters', async () => getCoverLetters());
ipcMain.handle('autopilot:saveCoverLetter', async (_e, input) => saveCoverLetter(input));
ipcMain.handle('autopilot:deleteCoverLetter', async (_e, id: string) => { deleteCoverLetter(id); return { ok: true }; });
// Standalone studio (no application row): the vault's own generate + refine.
ipcMain.handle('autopilot:generateCoverLetter', async (_e, opts: { company: string; role: string; jobText?: string; extra?: string }) => {
  const ctx = await hydrateStandaloneLetterContext({
    company: opts.company, role: opts.role, rawJobText: opts.jobText, extraContext: opts.extra,
  });
  const { data, meta } = await runClaudeJSONMeta<{ letter: string; note: string; questions: string[] }>(
    coverLetterStudioPrompt(ctx),
    { model: getPreferredModel(), fallbackModel: 'sonnet', systemPrompt: SYS.letter, schema: STUDIO_SCHEMA, timeoutMs: 180000 },
  );
  log('[cover] studio done', 'model=' + meta.model, 'tokens=' + (meta.inputTokens ?? '?'));
  return { body: String(data?.letter || '').trim(), note: String(data?.note || '').trim(), questions: (data?.questions || []).slice(0, 2) };
});
ipcMain.handle('autopilot:refineCoverLetter', async (_e, opts: { company: string; role: string; body: string; feedback: string; remember?: boolean; jobText?: string }) => {
  // Remembering is opt-in: only an explicitly ticked box turns this feedback into
  // a permanent style rule, and the distilled profile is rebuilt afterwards.
  const feedback = (opts.feedback || '').trim();
  if (opts.remember && feedback) {
    addVoiceNote('style', feedback);
    ensureVoiceProfile(true).catch((e) => log('[voice] redistill failed', String(e)));
  }
  const ctx = await hydrateStandaloneLetterContext(
    { company: opts.company, role: opts.role, rawJobText: opts.jobText },
    { feedback },
  );
  const { data, meta } = await runClaudeJSONMeta<{ letter: string; note: string }>(
    refineCoverLetterPrompt({ ...ctx, body: opts.body, feedback }),
    { model: getPreferredModel(), fallbackModel: 'sonnet', systemPrompt: SYS.letter, schema: LETTER_SCHEMA, timeoutMs: 240000 },
  );
  log('[cover] studio refine done', 'model=' + meta.model, 'tokens=' + (meta.inputTokens ?? '?'));
  return { body: String(data?.letter || '').trim() || opts.body, note: String(data?.note || '').trim() };
});

// ── Per-application cover letter (lives in the application's detail page) ─────
// Full context: everything Aplyd Community knows about you (resume/portfolio/facts/voice) +
// LIVE company research (their site/values/this year's direction) + the job posting,
// matched to your resume. Generate → refine with feedback → copy. Persisted per app.
// Export folder is user-selectable; the default belongs only to this community installation.
function coverLetterDir(): string {
  const custom = (getSetting('cover_letter_dir') || '').trim();
  return custom || path.join(app.getPath('userData'), 'exports', 'cover-letters');
}
// Render a cover letter to a labelled PDF, never overwriting an earlier version.
async function writeCoverPdf(company: string, role: string, body: string): Promise<string> {
  const dir = coverLetterDir();
  fs.mkdirSync(dir, { recursive: true });
  // "<Company> - <Role> - <Full Name>.pdf" (letter-file.ts); never overwrites.
  const file = uniquePdfPath(dir, letterPdfBase(company, role, profileFullName(getProfile())), fs.existsSync);
  const paras = body.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>`).join('\n');
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>` +
    `body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.55;color:#111;margin:0;padding:0}` +
    `.doc{max-width:660px;margin:0 auto}p{margin:0 0 14px}` +
    `</style></head><body><div class="doc">${paras}</div></body></html>`;
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    fs.writeFileSync(file, pdf);
  } finally { win.destroy(); }
  return file;
}

ipcMain.handle('coverletter:getForApp', async (_e, applicationId: string) => getCoverLetterForApplication(applicationId));
ipcMain.handle('coverletter:getVersions', async (_e, applicationId: string) => getSavedCoverLettersForApplication(applicationId));
ipcMain.handle('coverletter:deleteVersion', async (_e, id: string) => { deleteCoverLetter(id); return { ok: true }; });
ipcMain.handle('coverletter:getDir', async () => coverLetterDir());
ipcMain.handle('coverletter:setDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], defaultPath: coverLetterDir() });
  if (r.canceled || !r.filePaths[0]) return { dir: coverLetterDir() };
  setSetting('cover_letter_dir', r.filePaths[0]);
  return { dir: r.filePaths[0] };
});
ipcMain.handle('coverletter:openFolder', async () => { try { fs.mkdirSync(coverLetterDir(), { recursive: true }); shell.openPath(coverLetterDir()); } catch { /* ignore */ } return { ok: true }; });
// Save a version you LIKE in BOTH places: the app's vault (kept version) + a PDF on disk.
ipcMain.handle('coverletter:saveVersion', async (_e, opts: { applicationId: string; company: string; role: string; jobUrl?: string; body: string; label?: string }) => {
  const label = (opts.label && opts.label.trim()) ? opts.label.trim() : `${opts.company} - ${opts.role}`;
  const version = saveCoverLetterVersion(opts.applicationId, { company: opts.company, role: opts.role, jobUrl: opts.jobUrl ?? null, body: opts.body, label });
  let pdfPath = '';
  try { pdfPath = await writeCoverPdf(opts.company, opts.role, opts.body); } catch (e) { log('[cover] pdf save err', String(e)); }
  return { version, pdfPath };
});
/** The detail page's Generate button and background prep share this one path. */
function generateCoverLetterForApplication(opts: LetterGenOpts) {
  return generateLetterDraft(opts, {
    send: (payload) => { try { mainWindow?.webContents.send('coverletter:progress', payload); } catch { /* window gone */ } },
    log,
  });
}

ipcMain.handle('coverletter:generate', async (_e, opts: { applicationId: string; company: string; role: string; jobText?: string; jobUrl?: string; location?: string }) =>
  generateCoverLetterForApplication(opts));
ipcMain.handle('coverletter:refine', async (_e, opts: { applicationId: string; company: string; role: string; body: string; feedback: string; remember?: boolean; jobUrl?: string }) => {
  try {
    const feedback = (opts.feedback || '').trim();
    // Opt-in only: this feedback becomes a permanent style rule ONLY when the user
    // ticked the box, and the distilled profile is rebuilt right after.
    if (opts.remember && feedback) {
      addVoiceNote('style', feedback);
      ensureVoiceProfile(true).catch((e) => log('[voice] redistill failed', String(e)));
    }
    const ctx = await hydrateLetterContext(opts.applicationId, { feedback });
    const { data, meta } = await runClaudeJSONMeta<{ letter: string; note: string }>(
      refineCoverLetterPrompt({ ...ctx, body: opts.body, feedback }),
      { model: getPreferredModel(), fallbackModel: 'sonnet', systemPrompt: SYS.letter, schema: LETTER_SCHEMA, timeoutMs: 240000 },
    );
    const body = String(data?.letter || '').trim();
    const note = String(data?.note || '').trim();
    warnIfTemplateSlipped(body, log);
    log('[cover] model=' + meta.model, 'tokens=' + (meta.inputTokens ?? '?'));
    // never wipe a good draft: if the model returns nothing, keep the old body
    const finalBody = body || opts.body;
    try { saveCoverLetterForApplication(opts.applicationId, { company: opts.company, role: opts.role, jobUrl: opts.jobUrl ?? null, body: finalBody }); } catch { /* persist best-effort */ }
    return { body: finalBody, note };
  } catch (e: any) {
    const msg = String(e?.message || e);
    log('[cover] refine FAILED', msg);
    return { body: opts.body, note: '', error: /timed out/i.test(msg) ? 'That refine took too long (the AI was busy). Try again in a moment.' : ('Could not refine: ' + msg) };
  }
});
ipcMain.handle('coverletter:saveForApp', async (_e, opts: { applicationId: string; company: string; role: string; jobUrl?: string; body: string }) =>
  saveCoverLetterForApplication(opts.applicationId, { company: opts.company, role: opts.role, jobUrl: opts.jobUrl ?? null, body: opts.body }));

// ── Add flow ─────────────────────────────────────────────────────────────────
// One box takes anything: a posting, a link, or a burst of links. What it will
// not do any more is invent a row. A fetch or extraction failure is an error the user
// can see and retry, not a silent "Job Title (edit me)" stub to clean up later.

/** What a finished add knows about itself, enough to draft a letter from. */
interface AddedApplication { applicationId: string; company: string; role: string; jobUrl: string }

async function addApplicationFromText(input: { text: string; jobSource?: string | null }): Promise<AddedApplication> {
  const text = String(input?.text || '').trim();
  if (!text) throw new Error('Nothing to add: paste a posting or a link.');

  // A link on its own means "read this page for me". Everything else IS the
  // posting. fetchUrlText carries the SSRF guard (no private hosts, no redirects
  // out of it) and 12k characters is a whole posting plus the board's chrome.
  let sourceText = text;
  let jobUrl = '';
  const linkOnly = singleUrlOf(text);
  if (linkOnly) {
    jobUrl = linkOnly;
    const notes = text.split(/\r?\n/).filter((l) => bareUrl(l) !== linkOnly).join('\n').trim();
    const fetched = await fetchUrlText(linkOnly, 10000, 0, 12000).catch(() => '');
    // Nothing readable came back and the notes under the link are not a posting
    // either: say so, rather than asking the model to invent a job from a URL.
    if (fetched.length < 200 && notes.length < 200) {
      let host = linkOnly;
      try { host = new URL(linkOnly).host.replace(/^www\./, ''); } catch { /* keep the raw url */ }
      throw new Error(`Could not read the posting at ${host} (some boards need a login). Open it, copy the text, and paste that instead.`);
    }
    sourceText = [fetched, notes].filter(Boolean).join('\n\n');
  }

  // Throws on failure, and that is the point: no row exists until this succeeds.
  const extracted = await extractJobListing(sourceText);
  if (jobUrl) extracted.job_url = jobUrl;
  if (input.jobSource) extracted.job_source = input.jobSource;

  const application = createApplication(extracted);
  // Keep the FULL posting: job_description is a 150-word paraphrase; letters and
  // the fit score are written from this.
  try { setRawJobText(application.id, sourceText); } catch (e) { log('[add] raw text save failed', String(e)); }
  createStageHistory(application.id, 'applied', 'Application added');
  // Fit score and the working draft are background prep, started by the
  // callers' application:added (not here: quick add dedupes rows after this
  // returns and emits on its own).

  log('[add] created', application.id, extracted.company, '/', extracted.job_title, jobUrl ? 'from ' + jobUrl : 'from pasted text');
  return { applicationId: application.id, company: extracted.company, role: extracted.job_title, jobUrl: extracted.job_url || '' };
}

ipcMain.handle('apps:addFromText', async (_e, opts: { text: string; autoGenerate?: boolean; jobSource?: string | null }) => {
  try {
    const added = await addApplicationFromText({ text: opts?.text || '', jobSource: opts?.jobSource ?? null });
    // Background prep (fit, then the working draft) starts from this event, after
    // this reply: the user lands on the detail page first, and the draft streams into
    // it through coverletter:progress. Every add gets a draft now, so
    // autoGenerate is accepted and no longer changes anything.
    emitAppEvent({ type: 'application:added', id: added.applicationId });
    return { ok: true, data: { applicationId: added.applicationId } };
  } catch (e) {
    const msg = failed(e);
    log('[add] failed', msg);
    return { ok: false, error: msg };
  }
});

/** Per-item news for a running batch, watched by the modal and the list behind it. */
const emitBatch = (p: BatchAddProgress) => {
  try { mainWindow?.webContents.send('apps:batchProgress', p); } catch { /* window gone mid-batch */ }
};

async function runBatchAdd(items: string[], jobSource: string | null): Promise<void> {
  for (let index = 0; index < items.length; index++) {
    emitBatch({ index, total: items.length, status: 'working' });
    try {
      const added = await addApplicationFromText({ text: items[index], jobSource });
      emitAppEvent({ type: 'application:added', id: added.applicationId });
      emitBatch({ index, total: items.length, status: 'done', applicationId: added.applicationId, company: added.company, role: added.role });
    } catch (e) {
      const msg = failed(e);
      log('[add] batch item', index + 1, 'failed:', msg);
      emitBatch({ index, total: items.length, status: 'error', error: msg });
    }
  }
  log('[add] batch of', items.length, 'finished');
}

ipcMain.handle('apps:addBatch', async (_e, opts: { items: string[]; jobSource?: string | null }) => {
  const items = (opts?.items || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!items.length) return { ok: false, error: 'Nothing to add: paste some links or postings.' };
  log('[add] batch start,', items.length, 'items');
  // Answer now, work after: the modal draws its rows immediately and fills them in
  // from the progress events. One item at a time, so a burst of ten links cannot
  // monopolise the two claude slots. Closing the modal does not stop it.
  setTimeout(() => { runBatchAdd(items, opts?.jobSource ?? null).catch((e) => log('[add] batch failed', String(e))); }, 0);
  return { ok: true };
});

// The posting for a row that was quick-added (company + role only). Saves the raw
// text first (that alone unblocks letters), then fills the summary fields on the
// SAME row. Their company and role stay theirs: the user typed them.
ipcMain.handle('apps:setRawText', async (_e, opts: { applicationId: string; text: string }) => {
  const id = opts?.applicationId;
  const text = String(opts?.text || '').trim();
  try {
    if (!id) return { ok: false, error: 'No application to attach that posting to.' };
    if (!text) return { ok: false, error: 'Paste the posting text first.' };
    const current = getApplication(id);
    if (!current) return { ok: false, error: 'That application no longer exists.' };
    setRawJobText(id, text);

    let extracted: ExtractedJobData;
    try {
      extracted = await extractJobListing(text);
    } catch (e) {
      log('[add] setRawText extraction failed', failed(e));
      return { ok: false, error: 'Saved the posting, but could not read the details out of it: ' + failed(e) };
    }
    const filled = (mine: string | null | undefined, found: string | null | undefined) =>
      (String(mine || '').trim() ? mine : found) ?? null;
    updateApplication(id, {
      job_description: extracted.job_description,
      key_responsibilities: extracted.key_responsibilities,
      required_skills: extracted.required_skills,
      nice_to_have_skills: extracted.nice_to_have_skills,
      location: filled(current.location, extracted.location) || '',
      workplace_address: filled(current.workplace_address, extracted.workplace_address),
      job_url: filled(current.job_url, extracted.job_url) || '',
      job_source: filled(current.job_source, extracted.job_source),
      salary_min: current.salary_min ?? extracted.salary_min,
      salary_max: current.salary_max ?? extracted.salary_max,
      equity: filled(current.equity, extracted.equity),
      benefits: filled(current.benefits, extracted.benefits),
      team_info: filled(current.team_info, extracted.team_info),
      hiring_timeline: filled(current.hiring_timeline, extracted.hiring_timeline),
      application_deadline: filled(current.application_deadline, extracted.application_deadline),
    });
    // A quick-added row just got its posting: now it can be scored and drafted.
    queueApplicationPrep(id);
    log('[add] posting attached to', id, 'chars=' + text.length);
    return { ok: true };
  } catch (e) {
    const msg = failed(e);
    log('[add] setRawText failed', msg);
    return { ok: false, error: msg };
  }
});

// Manual re-score, for when a resume variant has changed since the row was added.
ipcMain.handle('fit:recompute', async (_e, opts: { applicationId: string }) => {
  try {
    const { score, reason } = await computeFitScore(opts.applicationId);
    return { ok: true, data: { score, reason } };
  } catch (e) {
    log('[fit] recompute err', String(e));
    return { ok: false, error: failed(e) };
  }
});

// The per-application assistant: the panel on the detail page that answers
// application form questions as them. Same { ok, data?, error? } contract, and
// grounded only in their resumes, answer bank, profile and letters.
ipcMain.handle('assistant:send', async (_e, opts: { applicationId: string; text: string }) => {
  const t0 = Date.now();
  const id = opts?.applicationId;
  try {
    const data = await assistantReply(id, [{ role: 'user', text: String(opts?.text || '') }]);
    log(`[assistant] reply ${Math.round((Date.now() - t0) / 1000)}s`, data.formAnswer ? 'form answer' : 'chat');
    return { ok: true, data };
  } catch (e) {
    const msg = failed(e);
    log('[assistant] send err', msg);
    return { ok: false, error: /timed out/i.test(msg) ? 'That took too long, try again in a moment.' : msg };
  }
});

ipcMain.handle('assistant:history', async (_e, applicationId: string) => {
  try { return { ok: true, data: assistantHistory(applicationId) }; }
  catch (e) { log('[assistant] history err', String(e)); return { ok: false, error: failed(e) }; }
});

// Saving an answer the user liked puts it in the answer bank keyed on the question
// itself, so letters and later answers can reuse it.
ipcMain.handle('assistant:saveAnswer', async (_e, opts: { label: string; value: string }) => {
  try {
    const label = String(opts?.label || '').trim();
    const value = String(opts?.value || '').trim();
    if (!label || !value) return { ok: false, error: 'Nothing to save yet.' };
    upsertAnswer({ label, value, patterns: [label] });
    return { ok: true };
  } catch (e) {
    log('[assistant] saveAnswer err', String(e));
    return { ok: false, error: failed(e) };
  }
});

// Attachments were never used (zero rows in the live database) and the renderer
// never called them. The `attachments` table stays where it is: nothing is dropped.

// Claude Operations IPC Handler

/**
 * Orchestrate the entire job listing ingestion workflow
 */
ipcMain.handle('claude:ingestJobListing', async (_event, jobListingText: string, company: string, jobSource: string | null = null) => {
  console.log('[Extract with AI] Starting job listing ingestion');
  try {
    // Step 1: extract the job listing. A failure here is a real failure: it
    // surfaces as an error the caller shows, never as an "Unknown Company" stub
    // row that has to be found and cleaned up later.
    console.log('[Extract with AI] Calling extractJobListing...');
    const extractedData: ExtractedJobData = await extractJobListing(jobListingText);
    console.log('[Extract with AI] Successfully extracted:', extractedData.company, extractedData.job_title);

    // A source the user explicitly picked in the form always wins over whatever
    // the AI inferred (or didn't).
    if (jobSource) {
      extractedData.job_source = jobSource;
    }

    // Step 2: Create application with extracted data (fixed STAGES, no workflow).
    const application = createApplication(extractedData);

    // Step 3b: keep the FULL original posting. The extraction summary is a
    // 150-word paraphrase; letters are written from this instead.
    try { setRawJobText(application.id, jobListingText); } catch (e) { log('[ingest] raw text save failed', String(e)); }

    // Step 4: Initial stage history entry. Adding a job means you've applied,
    // so 'applied' is the entry stage (no separate 'started' bucket).
    createStageHistory(application.id, 'applied', 'Application added');

    // Step 5: background prep (fit score, then a working letter draft).
    emitAppEvent({ type: 'application:added', id: application.id });

    console.log('[Extract with AI] Success! Created application:', application.id);
    return {
      success: true,
      application,
      workflow: STANDARD_WORKFLOW,
    };
  } catch (error) {
    console.error('[Extract with AI] Fatal error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMsg,
    };
  }
});

// Legacy auth checks are local status checks: opening a page never spends tokens.
ipcMain.handle('claude:checkAuth', async () => {
  const status = await aiStatus();
  return { authenticated: status.ready, error: status.ready ? undefined : status.message, method: status.provider };
});
const aiReply = async (work: () => Promise<unknown>) => {
  try { return { ok: true, data: await work() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'AI operation failed' }; }
};
ipcMain.handle('ai:status', () => aiReply(aiStatus));
ipcMain.handle('ai:configure', (_event, input: AIConfigure) => aiReply(() => configureAI(input)));
ipcMain.handle('ai:test', () => aiReply(testAI));
ipcMain.handle('ai:cancelAll', () => { cancelAllAI(); return { ok: true }; });
ipcMain.handle('system:getInfo', () => ({ ok: true, data: { dataDirectory: app.getPath('userData') } }));

/**
 * Preferred Claude model for quality-sensitive work (chat, letters, guidance).
 */
ipcMain.handle('model:get', async () => getPreferredModel());
ipcMain.handle('model:set', async (_event, model: string) => {
  if (!['fable', 'opus', 'sonnet', 'haiku'].includes(model)) {
    return { ok: false, error: `unknown model: ${model}` };
  }
  setSetting('model', model);
  return { ok: true, data: getPreferredModel() };
});

// The per-application chat panel is retired: the refine box on the letter is the
// conversation now. Its two handlers are gone with it, and so is the model chip's
// old home (the chip moved onto the letter section, where model:get/model:set
// still serve it). The chat_messages table and its accessors stay: their history
// is data, not code.

/**
 * Quick add an application with just company and job title
 */
ipcMain.handle('quickAddApplication', async (_event, company: string, jobTitle: string, jobSource: string | null = null) => {
  try {
    // Create minimal application entry
    const minimalData: ExtractedJobData = {
      company,
      job_title: jobTitle,
      location: '',
      job_url: '',
      job_source: jobSource,
      salary_min: null,
      salary_max: null,
      equity: null,
      benefits: null,
      // Honest placeholder, and detectable: the detail page refuses to write a
      // letter against it and asks for the posting instead.
      job_description: PLACEHOLDER_DESCRIPTION,
      key_responsibilities: '',
      required_skills: '',
      nice_to_have_skills: '',
      team_info: null,
      hiring_timeline: null,
      application_deadline: null,
    };

    const application = createApplication(minimalData);

    // Create initial stage history entry. Adding a job means you've applied.
    createStageHistory(application.id, 'applied', 'Quick added - details to be filled in');
    // Prep skips a placeholder row; it runs once the posting is attached.
    emitAppEvent({ type: 'application:added', id: application.id });

    return {
      success: true,
      application,
      workflow: STANDARD_WORKFLOW,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

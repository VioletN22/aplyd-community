// Quick add from anywhere: copy a job ad or link in any app, press the global
// shortcut, and the app adds it in the background with a notification either way.
//
// This file is only the Electron wiring (shortcut, clipboard, notifications,
// osascript, the in-app browser, the DB). The decisions live in quick-add-core.ts
// and the parsing in job-capture.ts, both unit-tested. The add itself is the
// same addApplicationFromText the Add modal uses, handed in by index.ts, so a
// quick-added row is indistinguishable from one added through the UI.
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Notification } from 'electron';
import { execFile } from 'child_process';
import {
  initializeDatabase, getAllApplications, getDefaultWorkflowForCompany, createWorkflow,
  createApplication, createStageHistory, updateApplication, deleteApplication, getSetting, setSetting,
} from './database';
import { fetchUrlRaw } from './autopilot-prompts';
import { loadDriverOn } from './autopilot-lazy';
import { emitApplicationAdded } from './events';
import { createQuickAdd, AddedRow, Notice, QuickAdd } from './quick-add-core';
import { readQuickAddClipboard } from './quick-add-clipboard';
import {
  acceleratorLabel, browserScriptFor, parseLsappinfoBundle, parseTabResult, siteSelectorsFor,
  GENERIC_SELECTORS, toCss, TabResult,
} from './job-capture';
import { PLACEHOLDER_DESCRIPTION } from '../shared/types';

export { onApplicationAdded } from './events';

/** app_settings keys. An empty shortcut value means quick add is switched off. */
export const SHORTCUT_KEY = 'quick_add_shortcut';
export const SHORTCUT_ERROR_KEY = 'quick_add_shortcut_error';

/**
 * ⌃⌘J: J for job. Chosen to stay clear of the browser and macOS defaults
 * (⌘⇧J is Chrome's Downloads, ⌥⌘J its JS console, ⌘⇧N/⌘⇧T are taken everywhere).
 */
export const DEFAULT_SHORTCUT = process.platform === 'darwin' ? 'Control+Command+J' : 'Control+Alt+J';

/** The in-app browser slot quick add reads pages in (research uses 2, setup 0). */
const RENDER_SLOT = 1;

export interface QuickAddInit {
  /** index.ts's addApplicationFromText: the one add pipeline. */
  addFromText(input: { text: string; jobSource?: string | null }): Promise<AddedRow>;
  getWindow(): BrowserWindow | null;
  log(...args: unknown[]): void;
}

let started = false;
let opts: QuickAddInit | null = null;
let qa: QuickAdd | null = null;
let current: string | null = null;
let lastError: string | null = null;
let scratchHost: BrowserWindow | null = null;
const liveNotes = new Set<Notification>();
let progressNote: Notification | null = null;

const log = (...a: unknown[]) => { try { opts?.log(...a); } catch { /* ignore */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(file: string, args: string[], timeout: number): Promise<{ stdout: string; error: (Error & { stderr?: string }) | null }> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ stdout: String(stdout || ''), error: error ? Object.assign(error, { stderr: String(stderr || '') }) : null });
      });
    } catch (e) { resolve({ stdout: '', error: e as Error }); }
  });
}

// ── The front browser tab ────────────────────────────────────────────────────

async function frontmostTab(): Promise<TabResult> {
  if (process.platform !== 'darwin') return { ok: false, reason: 'not-a-browser' };
  // lsappinfo needs no permission; only the browser question below does.
  const front = await run('/usr/bin/lsappinfo', ['front'], 2000);
  const asn = front.stdout.trim();
  if (!asn || front.error) return { ok: false, reason: 'not-a-browser' };
  const info = await run('/usr/bin/lsappinfo', ['info', '-only', 'bundleid', asn], 2000);
  const bundle = parseLsappinfoBundle(info.stdout);
  if (!bundle || bundle === 'io.github.VioletN22.aplyd-community') return { ok: false, reason: 'not-a-browser' };
  const script = browserScriptFor(bundle);
  if (!script) return { ok: false, reason: 'not-a-browser' };
  // The first ask shows macOS's Automation prompt and osascript waits on them
  // answer, hence the generous timeout; after that it answers in milliseconds.
  const r = await run('/usr/bin/osascript', ['-e', script], 20000);
  const res = parseTabResult(bundle, r.stdout, r.error);
  log('[quick-add] front tab', bundle, res.ok ? res.url : res.reason);
  return res;
}

// ── Page rendering in the existing in-app browser ────────────────────────────

/** A hidden window to park the driver on while the app window is closed. */
function ensureScratchHost(): BrowserWindow {
  if (!scratchHost || scratchHost.isDestroyed()) {
    scratchHost = new BrowserWindow({
      show: false, width: 1280, height: 900, skipTaskbar: true, title: 'Aplyd Community quick add',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    scratchHost.on('closed', () => { scratchHost = null; });
  }
  return scratchHost;
}

async function renderHtml(url: string): Promise<string> {
  let tab: any = null;
  let driver: Awaited<ReturnType<typeof loadDriverOn>> | null = null;
  try {
    driver = await loadDriverOn(ensureScratchHost);
    await driver.ensureBrowser(); // configures the permission-denying session
    tab = await driver.openJob(url, async () => ({ ok: false }), RENDER_SLOT);
    const css = [...siteSelectorsFor(url), ...GENERIC_SELECTORS].map(toCss);
    const probe = `(function(){try{var s=${JSON.stringify(css)};for(var i=0;i<s.length;i++){var e=document.querySelector(s[i]);if(e&&(e.innerText||e.textContent||'').length>200)return 'sel';}`
      + `var ld=document.querySelectorAll('script[type="application/ld+json"]');for(var j=0;j<ld.length;j++){if(/JobPosting/.test(ld[j].textContent||''))return 'ld';}`
      + `return String(document.body?(document.body.innerText||'').length:0);}catch(e){return '0';}})()`;
    // Wait for the description (or the JobPosting) to exist, or for the text to
    // stop growing: SPA boards render well after load fires.
    let prev = -1;
    let stable = 0;
    for (let i = 0; i < 24; i++) {
      const r = String(await driver.evalInTab(tab, probe).catch(() => '0'));
      if (r === 'sel' || r === 'ld') break;
      const n = Number(r) || 0;
      stable = n > 0 && n === prev ? stable + 1 : 0;
      prev = n;
      if (stable >= 3 && n > 800) break;
      await sleep(500);
    }
    const html = await driver.evalInTab(tab, '(document.documentElement ? document.documentElement.outerHTML : "").slice(0, 3000000)').catch(() => '');
    return String(html || '');
  } catch (e) {
    log('[quick-add] render failed', String(e));
    return '';
  } finally {
    if (tab && driver) { try { await driver.closeTab(tab); } catch { /* ignore */ } }
  }
}

// ── Notifications and opening the row ────────────────────────────────────────

function sendToRenderer(payload: { applicationId: string; open: boolean }): void {
  const win = opts?.getWindow();
  try { if (win && !win.isDestroyed()) win.webContents.send('quickadd:added', payload); } catch { /* window gone */ }
}

/** Bring the app up and ask the renderer to open this application. */
async function openOnApplication(applicationId: string): Promise<void> {
  let win = opts?.getWindow() || null;
  if (!win) {
    // index.ts's activate handler is what builds a new app window.
    try { (app as any).emit('activate'); } catch { /* ignore */ }
  }
  for (let i = 0; i < 75; i++) {
    win = opts?.getWindow() || null;
    const url = win && !win.isDestroyed() ? win.webContents.getURL() : '';
    if (win && url && !url.startsWith('data:') && !win.webContents.isLoading()) break;
    await sleep(200);
  }
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  try { app.focus({ steal: true }); } catch { /* ignore */ }
  sendToRenderer({ applicationId, open: true });
}

function notify(n: Notice): void {
  log('[quick-add]', n.kind, n.title, '|', n.body);
  if (n.kind === 'added' && n.applicationId) sendToRenderer({ applicationId: n.applicationId, open: false });
  if (!Notification.isSupported()) return;
  if (progressNote) { try { progressNote.close(); } catch { /* ignore */ } progressNote = null; }
  const note = new Notification({ title: n.title, body: n.body, silent: n.kind === 'progress' });
  const id = n.applicationId;
  note.on('click', () => { if (id) void openOnApplication(id); });
  // Held until it is dismissed: a collected Notification loses its click handler.
  liveNotes.add(note);
  note.on('close', () => liveNotes.delete(note));
  setTimeout(() => liveNotes.delete(note), 10 * 60 * 1000);
  note.show();
  if (n.kind === 'progress') progressNote = note;
}

// ── The shortcut ─────────────────────────────────────────────────────────────

function configuredShortcut(): string {
  try {
    const v = getSetting(SHORTCUT_KEY);
    return v == null ? DEFAULT_SHORTCUT : v.trim();
  } catch { return DEFAULT_SHORTCUT; }
}

function onPress(): void {
  try { initializeDatabase(); } catch (e) { log('[quick-add] db init failed', String(e)); }
  // A hidden window for the whole run: with it open, closing the app window
  // mid-add cannot fire window-all-closed (which closes the DB under us).
  try { ensureScratchHost(); } catch { /* rendering will retry */ }
  qa?.run().then((o) => log('[quick-add] done', o.status)).catch((e) => log('[quick-add] failed', String(e)));
}

function saveError(msg: string | null): void {
  lastError = msg;
  try { setSetting(SHORTCUT_ERROR_KEY, msg || ''); } catch { /* ignore */ }
}

/** Swap the global shortcut. An empty accelerator switches quick add off. */
function register(accel: string): { ok: boolean; error?: string } {
  if (current) { try { globalShortcut.unregister(current); } catch { /* ignore */ } current = null; }
  if (!accel) { saveError(null); log('[quick-add] shortcut off'); return { ok: true }; }
  let ok = false;
  try { ok = globalShortcut.register(accel, onPress); } catch (e) { log('[quick-add] register threw', String(e)); }
  if (!ok) {
    const msg = `${acceleratorLabel(accel)} is already used by another app (or is not a valid shortcut), so quick add is off. Pick a different shortcut.`;
    saveError(msg);
    log('[quick-add] could not register', accel);
    return { ok: false, error: msg };
  }
  current = accel;
  saveError(null);
  log('[quick-add] shortcut registered', accel);
  return { ok: true };
}

function shortcutState() {
  const shortcut = configuredShortcut();
  return { shortcut, label: shortcut ? acceleratorLabel(shortcut) : '', registered: !!current && current === shortcut, error: lastError, default: DEFAULT_SHORTCUT };
}

// ── Setup ────────────────────────────────────────────────────────────────────

/**
 * Register the quick-add shortcut and its settings IPC. Call once the DB is
 * initialized; safe to call again (window re-creation), later calls do nothing.
 */
export function initQuickAdd(init: QuickAddInit): void {
  opts = init;
  if (started) return;
  started = true;

  qa = createQuickAdd({
    readClipboard: () => readQuickAddClipboard(clipboard, process.platform),
    frontmostTab,
    fetchHtml: (url) => fetchUrlRaw(url, 10000),
    renderHtml,
    listApps: () => { initializeDatabase(); return getAllApplications().map((a) => ({ id: a.id, company: a.company, job_title: a.job_title, job_url: a.job_url })); },
    addFromText: (input) => { initializeDatabase(); return init.addFromText(input); },
    createPlaceholder: ({ company, role, jobUrl, jobSource, notes }) => {
      initializeDatabase();
      const workflow = getDefaultWorkflowForCompany(company)
        || createWorkflow(company, `${company} Default Workflow`, ['applied', 'phone_screen', 'interview', 'offer'], true);
      // Same shape as the in-app quick add: the placeholder description is what
      // makes the detail page ask for the posting before writing a letter.
      const row = createApplication({
        company, job_title: role, location: '', job_url: jobUrl, job_source: jobSource,
        salary_min: null, salary_max: null, equity: null, benefits: null,
        job_description: PLACEHOLDER_DESCRIPTION, key_responsibilities: '', required_skills: '', nice_to_have_skills: '',
        team_info: null, hiring_timeline: null, application_deadline: null,
      }, workflow.id, notes);
      createStageHistory(row.id, 'applied', 'Quick added from a link - details to be filled in');
      return { applicationId: row.id, company, role, jobUrl };
    },
    patchApp: (id, patch) => { initializeDatabase(); updateApplication(id, patch); },
    deleteApp: (id) => { initializeDatabase(); deleteApplication(id); },
    notify,
    emitAdded: emitApplicationAdded,
    log,
    shortcutLabel: () => (current ? acceleratorLabel(current) : 'the quick-add shortcut'),
  });
  qa.primeClipboard();

  register(configuredShortcut());

  ipcMain.handle('quickadd:getShortcut', async () => ({ ok: true, data: shortcutState() }));
  ipcMain.handle('quickadd:setShortcut', async (_e, accel: unknown) => {
    const next = typeof accel === 'string' ? accel.trim() : '';
    if (next.length > 64) return { ok: false, error: 'That shortcut is too long.' };
    const previous = current || '';
    const r = register(next);
    if (!r.ok) {
      register(previous);
      saveError(r.error || null); // the new one failed; say so even though the old one is back
      return { ok: false, error: r.error, data: shortcutState() };
    }
    try { setSetting(SHORTCUT_KEY, next); } catch (e) { return { ok: false, error: String(e) }; }
    return { ok: true, data: shortcutState() };
  });

  app.on('will-quit', () => {
    try { if (current) globalShortcut.unregister(current); } catch { /* ignore */ }
    current = null;
    try { scratchHost?.destroy(); } catch { /* ignore */ }
  });
}

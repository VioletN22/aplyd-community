// The in-app browser company research drives (sources.ts).
//
// Each "slot" is an Electron BrowserView attached to the main window with zero
// bounds, so the pages it loads are never shown. All slots share one persistent
// session partition (persist:autopilot) with every permission denied.
// ensureBrowser creates slot 0; research loads its pages in slot 2.
//
// Page work uses webContents.executeJavaScript / loadURL; the webContents
// debugger is used only to expose the __aplydBind page->Node binding.
import { BrowserView, BrowserWindow, session } from 'electron';

export interface Tab { wc: Electron.WebContents; slot: number; }
export interface BridgeMsg { id: string; path: string; method: string; body: any; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_SLOTS = 3;

// Deny mic/camera/geolocation/etc. on the research session: reading a page never
// needs them, and otherwise every site that asks pops an OS permission prompt.
let sessionConfigured = false;
function configureSession(): void {
  if (sessionConfigured) return;
  try {
    const ses = session.fromPartition('persist:autopilot');
    ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    // Research only ever reads a page: a site must never be able to start a
    // download onto the user's disk.
    ses.on('will-download', (event) => event.preventDefault());
    sessionConfigured = true;
  } catch { /* ignore */ }
}

interface Slot {
  view: BrowserView;
  bounds: { x: number; y: number; width: number; height: number };
  bridge: (m: BridgeMsg) => Promise<any>;
}

let hostWin: BrowserWindow | null = null;
const slots: (Slot | null)[] = [null, null, null];

// Called from createWindow so the views can attach to the real app window.
export function attachHost(win: BrowserWindow): void { hostWin = win; }

const ZERO = { x: 0, y: 0, width: 0, height: 0 };

function makeSlot(index: number): Slot {
  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:autopilot', // shared, persistent login across slots
      contextIsolation: true,
      // These views load third-party sites, so they get the OS sandbox. The
      // page bridge does not care: __aplydBind is installed through the CDP
      // debugger (Runtime.addBinding) and the page work runs through
      // executeJavaScript, neither of which needs a privileged renderer.
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const slot: Slot = { view, bounds: { ...ZERO }, bridge: async () => ({ ok: false }) };
  const wc = view.webContents;
  // target=_blank / window.open links load IN this view instead of spawning a
  // new window.
  wc.setWindowOpenHandler(({ url }) => { try { if (/^https?:/.test(url)) wc.loadURL(url); } catch { /* ignore */ } return { action: 'deny' }; });
  try {
    wc.debugger.attach('1.3');
    wc.debugger.on('message', async (_e, method, params) => {
      if (method !== 'Runtime.bindingCalled' || params.name !== '__aplydBind') return;
      let msg: BridgeMsg;
      try { msg = JSON.parse(params.payload); } catch { return; }
      let result: any = { ok: false };
      try { result = await slot.bridge(msg); } catch (err) { result = { ok: false, error: String(err) }; }
      try { await wc.executeJavaScript(`window.__aplydResolve(${JSON.stringify(msg.id)}, ${JSON.stringify(result)})`, true); } catch { /* navigated */ }
    });
    wc.debugger.sendCommand('Runtime.enable');
  } catch { /* debugger may fail; bridge degrades */ }
  return slot;
}

// Ensure a slot's BrowserView exists and is attached to the window.
function ensureSlot(index: number): Slot {
  if (!hostWin) throw new Error('autopilot host window not attached');
  let s = slots[index];
  if (!s) { s = makeSlot(index); slots[index] = s; }
  if (!hostWin.getBrowserViews().includes(s.view)) hostWin.addBrowserView(s.view);
  applyBounds(index);
  return s;
}

function applyBounds(index: number): void {
  const s = slots[index];
  if (!s) return;
  s.view.setBounds(s.bounds);
}

// ── public driver API (slot-aware; slot defaults to 0) ───────────────────────
export async function ensureBrowser(): Promise<void> { configureSession(); ensureSlot(0); }

export async function openJob(url: string, onBridge: (m: BridgeMsg) => Promise<any>, slot = 0): Promise<Tab> {
  const s = ensureSlot(slot);
  s.bridge = onBridge;
  // make sure this slot is on top + correctly positioned before it loads
  if (hostWin) { try { hostWin.setTopBrowserView(s.view); } catch { /* ignore */ } }
  applyBounds(slot);
  const wc = s.view.webContents;
  // Load with a hard timeout so a slow / never-finishing page can't hang the run.
  await Promise.race([wc.loadURL(url).catch(() => {}), sleep(18000)]);
  await sleep(700);
  try { await wc.debugger.sendCommand('Runtime.addBinding', { name: '__aplydBind' }); } catch { /* present */ }
  return { wc, slot };
}

export async function evalInTab(tab: Tab, expression: string): Promise<any> {
  return tab.wc.executeJavaScript(expression, true);
}

// Single reused view per slot; "closing" a tab navigates it idle (keeps login).
export async function closeTab(tab: Tab): Promise<void> {
  try { await tab.wc.loadURL('about:blank'); } catch { /* ignore */ }
}

export function shutdown(): void {
  for (let i = 0; i < MAX_SLOTS; i++) {
    const s = slots[i];
    if (s) { try { (s.view.webContents as any).destroy?.(); } catch { /* ignore */ } }
    slots[i] = null;
  }
}

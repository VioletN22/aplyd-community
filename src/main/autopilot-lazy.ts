// The company-research chain, loaded on first use.
//
// sources → driver pulls in Electron's BrowserView machinery, and nothing at boot
// needs it: company research only runs while a letter is being written. Loading
// it from here, behind a dynamic import, keeps it off cold start.
//
// Every entry point goes through this module for one other reason: the driver
// parks its BrowserView inside the app window and throws if it has not been
// given one, so whoever loads it must also hand it the current window. index.ts
// owns that window, letter-context.ts does not, and neither may import the other.
// (The file name is historical.)
import type { BrowserWindow } from 'electron';

type DriverModule = typeof import('./autopilot/driver');
type SourcesModule = typeof import('./autopilot/sources');

let host: () => BrowserWindow | null = () => null;
let driverMod: DriverModule | null = null;
let sourcesMod: SourcesModule | null = null;

/** How the driver finds the app window. Set once, by index.ts. */
export function setAutopilotHost(provider: () => BrowserWindow | null): void {
  host = provider;
}

async function loadDriver(): Promise<DriverModule> {
  if (!driverMod) driverMod = await import('./autopilot/driver');
  // Re-attached on every load, not just the first: the window may have been
  // closed and recreated since (macOS activate).
  const win = host();
  if (win) driverMod.attachHost(win);
  return driverMod;
}

/** Company research, with the driver ready under it. */
export async function loadSources(): Promise<SourcesModule> {
  await loadDriver();
  if (!sourcesMod) sourcesMod = await import('./autopilot/sources');
  return sourcesMod;
}

/**
 * The driver itself, for quick add's page reads. Those can run with the app
 * window closed (the global shortcut), so when there is no window the driver is
 * parked on `fallback()` instead, a hidden host the caller owns.
 */
export async function loadDriverOn(fallback: () => BrowserWindow): Promise<DriverModule> {
  const d = await loadDriver();
  const win = host();
  if (!win || win.isDestroyed()) d.attachHost(fallback());
  return d;
}

/** Point the research view at a new window, only if the driver was ever loaded. */
export function attachHostIfLoaded(win: BrowserWindow): void {
  try { driverMod?.attachHost(win); } catch { /* ignore */ }
}

/** Close the research browser, only if the driver was ever loaded. */
export function shutdownDriveIfLoaded(): void {
  try { driverMod?.shutdown(); } catch { /* ignore */ }
}

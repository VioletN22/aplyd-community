// Startup and shutdown decisions that do not need Electron, kept apart from
// index.ts so they can be tested on their own.

// ── Locale ─────────────────────────────────────────────────────────────────

export interface LocaleSources {
  /** app.getSystemLocale(): the regional format the OS uses for dates and numbers. */
  systemLocale?: () => string;
  /** app.getPreferredSystemLanguages(): display languages, most preferred first. */
  preferredLanguages?: () => string[];
}

/**
 * The locale for dates and numbers. On Windows the preferred language list is
 * the display language, which can differ from the regional format (English
 * menus with German dates), so the system locale wins.
 */
export function chooseFormatLocale(src: LocaleSources): string {
  const usable = (s: unknown): string => {
    const t = typeof s === 'string' ? s.trim().replace(/_/g, '-') : '';
    if (!t) return '';
    try { return Intl.getCanonicalLocales(t)[0] || ''; } catch { return ''; }
  };
  let fromSystem = '';
  try { fromSystem = usable(src.systemLocale?.()); } catch { /* fall through */ }
  if (fromSystem) return fromSystem;
  let fromPreferred = '';
  try { fromPreferred = usable(src.preferredLanguages?.()[0]); } catch { /* fall through */ }
  return fromPreferred || 'en';
}

// ── Startup steps ──────────────────────────────────────────────────────────

export interface StartupStep {
  name: string;
  run: () => void;
}

/**
 * Run the required steps (the database), then the optional ones. A required
 * step that throws stops everything and calls onFatal. An optional step that
 * throws is logged and the rest still run, so a broken calendar or inbox
 * setting never keeps the app from opening.
 * Returns false when a required step failed.
 */
export function runStartupSteps(
  required: StartupStep[],
  optional: StartupStep[],
  hooks: { onFatal: (reason: string, step: string) => void; log: (...args: unknown[]) => void },
): boolean {
  for (const step of required) {
    try { step.run(); } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      hooks.log(`[startup] ${step.name} failed:`, reason);
      hooks.onFatal(reason, step.name);
      return false;
    }
  }
  for (const step of optional) {
    try { step.run(); } catch (err) {
      hooks.log(`[startup] ${step.name} failed, continuing:`, err instanceof Error ? err.message : String(err));
    }
  }
  return true;
}

// ── Messages ───────────────────────────────────────────────────────────────

export function databaseErrorText(reason: string, backupsDir: string): { title: string; body: string } {
  return {
    title: 'Aplyd Community cannot open its database',
    body: `${reason}\n\nDaily backups are kept in:\n${backupsDir}\n\n`
      + 'To restore one:\n'
      + '1. Quit Aplyd Community.\n'
      + '2. In the data folder, delete job-tracker.db-wal and job-tracker.db-shm if they exist.\n'
      + '3. Replace job-tracker.db with the backup copy (rename the copy to job-tracker.db).\n'
      + '4. Open Aplyd Community again.\n\n'
      + "Restoring a backup loses everything added since that backup's date.",
  };
}

export function versionMenuLabel(version: string): string {
  return `Aplyd Community ${version}`;
}

// ── Shutdown ───────────────────────────────────────────────────────────────

interface QuitEvents {
  on(event: 'will-quit', listener: () => void): unknown;
}

/**
 * Close the database on every quit path (menu, Cmd+Q, app.quit() from code, OS
 * logout). 'will-quit' fires after the windows have closed, so no renderer call
 * can reach the database after it closes. closeDb must be safe to call twice.
 */
export function closeOnQuit(app: QuitEvents, closeDb: () => void): void {
  app.on('will-quit', closeDb);
}

import fs from 'node:fs';
import path from 'node:path';

export const COMMUNITY_APP_ID = 'io.github.VioletN22.aplyd-community';
export const COMMUNITY_DATA_NAME = 'aplyd-community';

/** Source installs load the built app unless development is explicitly requested. */
export function isDevelopmentMode(packaged: boolean, environment: string | undefined, args: string[]): boolean {
  return !packaged && (environment === 'development' || args.includes('--dev'));
}

const MARKER_NAME = '.aplyd-community.json';
const DB_NAME = 'job-tracker.db';

function foreignMarker(directory: string, marker: string): Error {
  return new Error(
    `The data folder ${directory} does not belong to a compatible Aplyd Community installation. `
    + `To start fresh, quit Aplyd Community and move that folder somewhere else (or rename it). `
    + `If you are sure it holds Aplyd Community data, delete the file ${marker} instead and open the app again.`,
  );
}

function unrecognizedDatabase(directory: string): Error {
  return new Error(
    `An unrecognized database (${DB_NAME}) is in the data folder ${directory}. `
    + 'Nothing was changed. Quit Aplyd Community and move that folder somewhere else (or rename it), then open the app again to start with an empty folder.',
  );
}

// Write to a temporary file in the same folder, then rename it into place, so
// a crash can never leave a half-written marker behind.
function writeMarker(marker: string): void {
  const tmp = `${marker}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ appId: COMMUNITY_APP_ID, schemaVersion: 1 }) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, marker);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* already renamed */ }
  }
}

/** Refuse to adopt an existing unmarked database from another installation. */
export function initializeCommunityData(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const marker = path.join(directory, MARKER_NAME);
  const hasDatabase = fs.existsSync(path.join(directory, DB_NAME));
  if (fs.existsSync(marker)) {
    // Any marker we cannot read as our own object (truncated, a BOM, a
    // directory, plain junk) is a refusal with a message that says what to do.
    let raw: string;
    try {
      raw = fs.readFileSync(marker, 'utf8').replace(/^\uFEFF/, '').trim();
    } catch {
      throw foreignMarker(directory, marker);
    }
    // An empty marker next to no database is what an interrupted first run
    // leaves behind (older versions did not write it atomically): finish it.
    if (!raw && !hasDatabase) {
      fs.rmSync(marker, { force: true });
      writeMarker(marker);
      return;
    }
    let value: { appId?: unknown; schemaVersion?: unknown };
    try {
      value = JSON.parse(raw || '{}');
    } catch {
      throw foreignMarker(directory, marker);
    }
    if (!value || typeof value !== 'object' || value.appId !== COMMUNITY_APP_ID || value.schemaVersion !== 1) {
      throw foreignMarker(directory, marker);
    }
    return;
  }
  if (hasDatabase) throw unrecognizedDatabase(directory);
  writeMarker(marker);
}

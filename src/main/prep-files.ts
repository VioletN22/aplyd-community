// Prep sheets saved as files (PDF, HTML, Markdown, Word), shown on the
// application they are for. Two ways a file belongs to an application:
//
//   1. A row in `attachments` (file_type 'prep'): an explicit link, for a file
//      kept anywhere on disk.
//   2. A folder under the community data folder's interview-prep directory whose name is the
//      company's: every sheet in it is picked up on read, so a new prep sheet
//      saved there shows up without anyone recording it.
//
// The matching is pure and unit tested; listing touches the disk.
import fs from 'fs';
import { app } from 'electron';
import path from 'path';
import type { MigrationDb } from './database';

export const interviewsDirectory = () => path.join(app.getPath('userData'), 'interview-prep');
const SHEET_EXT = new Set(['.pdf', '.html', '.htm', '.md', '.docx', '.txt']);

export interface PrepFile { path: string; name: string; kind: string; modifiedAt: string; linked: boolean }

/** "Massive Dynamic (via Harbor Ventures)" -> "massivedynamic"; legal suffixes and brackets go. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(pty|ltd|limited|inc|group|australia|au|co)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Does an Interviews folder name belong to this company? Equal keys, or one begins with the other (5+ characters). */
export function folderMatches(company: string, folder: string): boolean {
  const a = companyKey(company);
  const b = companyKey(folder);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

/** Prep sheets first (name says prep, guide or brief), then newest. */
export function sortPrepFiles(files: PrepFile[]): PrepFile[] {
  const rank = (f: PrepFile) => (/prep|guide|brief|cheat|one-?pager/i.test(f.name) ? 0 : 1);
  return [...files].sort((x, y) => rank(x) - rank(y) || y.modifiedAt.localeCompare(x.modifiedAt));
}

function describe(file: string, linked: boolean): PrepFile | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const ext = path.extname(file).toLowerCase();
    return { path: file, name: path.basename(file), kind: ext.replace('.', '').toUpperCase(), modifiedAt: st.mtime.toISOString(), linked };
  } catch {
    return null;
  }
}

/** Every prep file for one application: explicit links plus its Interviews folder. Missing files are skipped. */
export function listPrepFiles(db: MigrationDb, applicationId: string, interviewsDir: string = interviewsDirectory()): PrepFile[] {
  const app = db.prepare('SELECT company FROM applications WHERE id = ?').get(applicationId) as { company: string } | undefined;
  if (!app) return [];
  const out = new Map<string, PrepFile>();
  const rows = db.prepare(`SELECT file_path FROM attachments WHERE application_id = ? AND file_type = 'prep'`).all(applicationId) as { file_path: string }[];
  for (const r of rows) {
    const f = describe(r.file_path, true);
    if (f) out.set(f.path, f);
  }
  let folders: string[] = [];
  try { folders = fs.readdirSync(interviewsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* no folder yet */ }
  for (const folder of folders.filter((name) => folderMatches(app.company, name))) {
    const dir = path.join(interviewsDir, folder);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (name.startsWith('.') || !SHEET_EXT.has(path.extname(name).toLowerCase())) continue;
      const full = path.join(dir, name);
      if (!out.has(full)) { const f = describe(full, false); if (f) out.set(full, f); }
    }
  }
  return sortPrepFiles([...out.values()]);
}

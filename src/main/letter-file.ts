// Saved cover-letter PDF naming. Pure (fs is injected for the collision check),
// so it is unit tested without a disk.
//
//   "<Company> - <Role> - <Full Name>.pdf"
//
// Company first, so Finder's middle truncation keeps it visible. The legal
// suffix ("Pty Ltd" and friends) is noise in a file name and is stripped. The
// name comes from their profile, never a literal here; with no name on file the
// last segment is simply left off.
import path from 'path';

/** Strip anything that would fight the filesystem, keep it readable. */
export const safeDocName = (s: string): string =>
  (s || '').replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled';

/** "Acme Pty Ltd" -> "Acme". Also "Pty. Ltd.", "Proprietary Limited", "Limited", "Ltd". */
export function stripCompanySuffix(company: string): string {
  const s = String(company || '').trim();
  const stripped = s
    .replace(/[\s,]+\(?(?:pty\.?\s*ltd\.?|proprietary\s+limited|pty\.?\s+limited|limited|ltd\.?)\)?\s*$/i, '')
    .trim();
  return stripped || s;
}

/**
 * The name a letter's file carries: "Full name" from the profile, else the
 * preferred (or legal) first name plus the legal last name. '' when unknown.
 */
export function profileFullName(profile: Record<string, string> | null | undefined): string {
  const p = profile || {};
  const get = (k: string) => String(p[k] ?? '').replace(/\s+/g, ' ').trim();
  const full = get('Full name');
  if (full) return full;
  const first = get('Preferred name') || get('Legal first name');
  return [first, get('Legal last name')].filter(Boolean).join(' ');
}

/** The file name without extension or collision suffix. */
export function letterPdfBase(company: string, role: string, fullName: string): string {
  const parts = [safeDocName(stripCompanySuffix(company)), safeDocName(role)];
  const name = String(fullName || '').trim();
  if (name) {
    const n = safeDocName(name);
    if (n !== 'Untitled') parts.push(n);
  }
  return parts.join(' - ');
}

/**
 * `<dir>/<base>.pdf`, or `<base> (2).pdf`, `(3)` and so on when that name is
 * taken. A saved version is a thing the user chose to keep, so writing over one is
 * never the right answer.
 */
export function uniquePdfPath(dir: string, base: string, exists: (p: string) => boolean): string {
  const file = path.join(dir, `${base}.pdf`);
  if (!exists(file)) return file;
  let n = 2;
  while (exists(path.join(dir, `${base} (${n}).pdf`))) n++;
  return path.join(dir, `${base} (${n}).pdf`);
}

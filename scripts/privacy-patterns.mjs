// Patterns and path rules shared by privacy-check.mjs and its tests.

/** Secret and identity patterns, looked up by label. */
export const PATTERNS = Object.freeze({
  'private key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'provider token': /(?:sk-(?:ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,})/,
  'aws access key id': /\bAKIA[0-9A-Z]{16}\b/,
  'google oauth client secret': /\bGOCSPX-[A-Za-z0-9_-]{20,}/,
  'google oauth client id': /\b\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/,
  'slack token': /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  'absolute personal home': /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Z]:\\Users\\[A-Za-z0-9._-]+\\)/,
});

/** The token patterns: every pattern except the home-folder path. */
export const TOKEN_LABELS = Object.freeze(Object.keys(PATTERNS).filter((label) => label !== 'absolute personal home'));

/** Forward slashes on every platform, so path rules work on Windows too. */
export function toSlashes(p) {
  return String(p).replace(/\\/g, '/');
}

/** True for files inside a node_modules folder, on any platform. */
export function isDependencyPath(p) {
  return /(?:^|\/)node_modules\//.test(toSlashes(p));
}

/** Labels of the patterns a piece of text matches, from the given labels. */
export function matchingLabels(content, labels = Object.keys(PATTERNS)) {
  return labels.filter((label) => PATTERNS[label].test(content));
}

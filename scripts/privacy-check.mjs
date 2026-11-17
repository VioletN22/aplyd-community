// Supplements manual source, fixture and asset review.
//
// Modes:
//   node scripts/privacy-check.mjs              scan tracked files (default)
//   node scripts/privacy-check.mjs --history    also scan all git history (git log --all -p)
//   node scripts/privacy-check.mjs --package D   scan an extracted app build under D
//
// An optional, gitignored local file scripts/privacy-denylist.local.txt adds one
// regular expression per line (blank lines and # comments ignored). It never ships;
// keep real personal identifiers there, not in the repository.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PATTERNS, TOKEN_LABELS, isDependencyPath, matchingLabels } from './privacy-patterns.mjs';

const root = process.cwd();
const argv = process.argv.slice(2);
const historyMode = argv.includes('--history');
const packageIndex = argv.indexOf('--package');
const packageDir = packageIndex >= 0 ? argv[packageIndex + 1] : null;
if (packageIndex >= 0 && (!packageDir || packageDir.startsWith('--'))) {
  console.error('--package requires a directory to scan.');
  process.exit(1);
}

const failures = [];

// ── Secret and identity patterns ─────────────────────────────────────────────
const patterns = Object.entries(PATTERNS);

// Fixed regional settings that should not ship in product source; the app uses
// the timezone the user configures.
const SOURCE_SMELLS = [
  ['fixed regional timezone', /\bAustralia\//],
  ['fixed +10/+11 hour offset', /["'`][+-]1[01]:00["'`]|T\d\d:\d\d:\d\d[+-]1[01]:00/],
];

// Load the optional local denylist (never committed).
const denylist = [];
try {
  const text = fs.readFileSync(path.join(root, 'scripts', 'privacy-denylist.local.txt'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try { denylist.push(new RegExp(trimmed, 'i')); } catch { console.error(`denylist: invalid regex ignored: ${trimmed}`); }
  }
} catch { /* no local denylist: fine */ }

// ── Email allowlist (applied to shipped, non-test files only) ────────────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const ALLOWED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'users.noreply.github.com',
  // The app is Gmail-only, so placeholder provider domains are expected in UI copy.
  'gmail.com', 'googlemail.com', 'outlook.com',
  // Known ATS / job-board no-reply domains that appear in documentation examples.
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkday.com', 'wd3.myworkday.com',
  'smartrecruiters.com', 'jobadder.com', 'pageuppeople.com', 'livehire.com',
  'indeed.com', 'linkedin.com', 'seek.com.au',
]);
const isTestPath = (p) => /(?:^|\/)(?:__tests__|tests)\//.test(p) || /\.test\.[cm]?[jt]sx?$/.test(p);
const isLockPath = (p) => /(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p);

const forbiddenFile = /(?:^|\/)(?:\.env(?:\..*)?|credentials(?:\..*)?|auth\.json|.*\.(?:db(?:-.*)?|sqlite\d?(?:-.*)?|pem|key|p12|pfx|mobileprovision))$/i;

// ── Unexpected tooling files: editor and tool settings folders, generated-by footers ──
// The markers are assembled from parts so this file does not match itself.
const join = (...parts) => parts.join('');
const TOOLING_PATHS = [
  new RegExp(join('^docs/', 'super', 'powers/')),
  new RegExp(join('(?:^|/)', 'CLA', 'UDE', '\\.md$'), 'i'),
  new RegExp(join('(?:^|/)\\.(?:', 'cla', 'ude|', 'co', 'dex|', 'cur', 'sor)/'), 'i'),
];
const TOOLING_TEXT = [
  join('Co-Authored-By: ', 'Cla', 'ude'),
  join('Generated with [', 'Cla', 'ude'),
  join('noreply@', 'anth', 'ropic.com'),
  join('co', 'dex', '-generated'),
].map((marker) => marker.toLowerCase());

function scanText(relative, content) {
  for (const [label, pattern] of patterns) if (pattern.test(content)) failures.push(`${relative}: ${label}`);
  for (const re of denylist) if (re.test(content)) failures.push(`${relative}: matches local denylist (${re.source})`);
}

// ── Default: tracked files ───────────────────────────────────────────────────
const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!paths.length) { console.error('No tracked files: stage the intended public source before checking.'); process.exit(1); }

for (const relative of paths) {
  if (TOOLING_PATHS.some((re) => re.test(relative))) { failures.push(`${relative}: unexpected tooling file`); continue; }
  if (forbiddenFile.test(relative) && relative !== '.env.example') { failures.push(`${relative}: forbidden runtime/credential file`); continue; }
  const stat = fs.lstatSync(path.join(root, relative));
  if (stat.isSymbolicLink()) { failures.push(`${relative}: symlink requires explicit review`); continue; }
  if (stat.size > 5 * 1024 * 1024) failures.push(`${relative}: unexpected file over 5 MB`);
  if (/\.(?:png|icns|woff2|ico)$/.test(relative)) continue;
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  scanText(relative, content);
  const lower = content.toLowerCase();
  for (const marker of TOOLING_TEXT) if (lower.includes(marker)) failures.push(`${relative}: unexpected tooling text (${marker})`);
  // Product source (not tests) must not carry a fixed regional setting.
  if (!isTestPath(relative) && /^src\//.test(relative)) {
    for (const [label, pattern] of SOURCE_SMELLS) if (pattern.test(content)) failures.push(`${relative}: ${label}`);
  }
  // A real email address should never appear in shipped, non-test source or docs.
  if (!isTestPath(relative) && !isLockPath(relative)) {
    for (const m of content.matchAll(EMAIL_RE)) {
      const domain = m[1].toLowerCase();
      if (!ALLOWED_EMAIL_DOMAINS.has(domain)) failures.push(`${relative}: email with unexpected domain (${m[0]})`);
    }
  }
}

// ── --history: scan every version ever committed ─────────────────────────────
if (historyMode) {
  let log = '';
  try { log = execFileSync('git', ['log', '--all', '-p', '--no-color'], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }); }
  catch (e) { failures.push(`--history: could not read git log (${e.message})`); }
  for (const [label, pattern] of patterns) if (pattern.test(log)) failures.push(`git history: ${label}`);
  for (const re of denylist) if (re.test(log)) failures.push(`git history: matches local denylist (${re.source})`);
}

// ── --package: scan an extracted build (app.asar contents, Resources) ────────
if (packageDir) {
  if (!fs.existsSync(packageDir)) { failures.push(`--package: ${packageDir} does not exist`); }
  else {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { walk(full); continue; }
        // A shipped database is always wrong, wherever it sits.
        if (/\.(?:db|sqlite\d?)(?:-wal|-shm)?$/i.test(entry.name)) { failures.push(`package: database shipped (${full})`); continue; }
        // Dependency files and third-party licenses carry their own authors'
        // build paths and brand names; only the app's own code is checked.
        if (isDependencyPath(full) || /LICENSES?\.chromium/i.test(entry.name)) continue;
        if (/\.js\.map$/i.test(entry.name)) { failures.push(`package: app source map shipped (${full})`); continue; }
        // An app.asar bundles dependencies too, so a flat text scan of it is
        // noisy. Flag it for a deep scan: extract it and re-run against the tree.
        if (/\.asar$/i.test(entry.name)) { console.error(`note: ${full} not scanned in place; extract it (npx asar extract) and re-run --package on the output for a deep check.`); continue; }
        if (!/\.(?:js|cjs|mjs|json|html|css|txt|md)$/i.test(entry.name)) continue;
        let content = '';
        try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (PATTERNS['absolute personal home'].test(content)) failures.push(`package: absolute personal home path in ${full}`);
        for (const label of matchingLabels(content, TOKEN_LABELS)) failures.push(`package: ${label} in ${full}`);
        for (const re of denylist) if (re.test(content)) failures.push(`package: matches local denylist (${re.source}) in ${full}`);
      }
    };
    walk(packageDir);
  }
}

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
const scope = [`${paths.length} tracked files`, historyMode && 'git history', packageDir && `package ${packageDir}`].filter(Boolean).join(', ');
console.log(`Public-source hygiene passed for ${scope}. Manual fixture and asset review remains required.`);

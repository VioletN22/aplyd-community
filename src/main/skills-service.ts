/** Runs only the bundled skill installer; renderer input cannot select paths or commands. */
import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Python = { command: string; prefix: string[] };
type Target = 'codex' | 'claude' | 'both' | 'auto';
type PlanRow = { destination: string; action: 'install' | 'update'; version: string; files: number };
type InstallResult = { dry_run: boolean; plan: PlanRow[]; next?: string };
const MAX_OUTPUT = 512 * 1024;

type IsFile = (candidate: string) => boolean;

function defaultIsFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    // Windows app execution aliases (WindowsApps\py.exe) are reparse points that stat cannot follow.
    if (process.platform !== 'win32') return false;
    try { fs.lstatSync(candidate); return true; } catch { return false; }
  }
}

/** Absolute path of an executable on PATH. Relative PATH entries are skipped: they would resolve against the working directory. */
export function findOnPath(name: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, isFile: IsFile = defaultIsFile): string | null {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const file = platform === 'win32' && !/\.exe$/i.test(name) ? `${name}.exe` : name;
  for (const directory of (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (!directory || !paths.isAbsolute(directory)) continue;
    const candidate = paths.join(directory, file);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Interpreters to try, all as absolute paths, so the installer never runs through a shell or a bare command name. */
export function pythonCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env, isFile: IsFile = defaultIsFile): Python[] {
  const candidates: Python[] = [];
  const add = (command: string | null, prefix: string[] = []) => {
    if (command && !candidates.some(item => item.command === command)) candidates.push({ command, prefix });
  };
  const fixed = (command: string, prefix: string[] = []) => add(isFile(command) ? command : null, prefix);
  if (platform === 'win32') {
    add(findOnPath('py', platform, env, isFile), ['-3']);
    // The documented launcher locations: per user, then all users.
    const local = env.LOCALAPPDATA;
    if (local && path.win32.isAbsolute(local)) {
      fixed(path.win32.join(local, 'Programs', 'Python', 'Launcher', 'py.exe'), ['-3']);
      fixed(path.win32.join(local, 'Python', 'bin', 'py.exe'), ['-3']);
    }
    const root = env.SystemRoot ?? env.windir;
    if (root && path.win32.isAbsolute(root)) fixed(path.win32.join(root, 'py.exe'), ['-3']);
    add(findOnPath('python', platform, env, isFile));
    add(findOnPath('python3', platform, env, isFile));
    return candidates;
  }
  // Finder-launched macOS apps get a PATH without Homebrew, and /usr/bin/python3 is often 3.9 or a
  // stub that opens the developer tools installer, so the usual install locations come first.
  if (platform === 'darwin') {
    for (const command of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/Library/Frameworks/Python.framework/Versions/Current/bin/python3']) fixed(command);
  }
  add(findOnPath('python3', platform, env, isFile));
  add(findOnPath('python', platform, env, isFile));
  return candidates;
}

export function parsePythonVersion(stdout: string): string {
  const v: unknown = JSON.parse(stdout.trim());
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isInteger) || v[0] !== 3 || v[1] < 10) {
    throw new Error('Python 3.10 or newer is required.');
  }
  return v.join('.');
}

/** What the Skills section shows when no usable Python was found; `older` lists interpreters that were too old. */
export function pythonMissingMessage(platform: NodeJS.Platform, older: string[]): string {
  const install = platform === 'win32'
    ? 'Install Python 3.10 or newer from python.org, then restart Aplyd Community.'
    : platform === 'darwin'
      ? 'Install Python 3.10 or newer from python.org or with Homebrew (brew install python), then restart Aplyd Community.'
      : 'Install Python 3.10 or newer with your package manager (the package is usually python3), then restart Aplyd Community.';
  return older.length
    ? `Found ${older.join(', ')}, but the skills need Python 3.10 or newer. ${install}`
    : `Python 3.10 or newer was not found. ${install}`;
}

/** Only what Python needs to start and find the user's home folder; app secrets and PYTHON* settings stay behind. */
export function childEnv(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keys = platform === 'win32'
    ? ['PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']
    : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE'];
  const result: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = env[key] ?? (key === 'PATH' ? env.Path : undefined);
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

export function skillSourceRoot(packaged: boolean, appPath: string, resourcesPath: string): string {
  return packaged ? path.join(resourcesPath, 'community') : appPath;
}

export function installerArgs(root: string, target: unknown, preview: boolean, update: unknown): string[] {
  if (typeof target !== 'string' || !['codex', 'claude', 'both', 'auto'].includes(target)) throw new Error('Choose Codex, Claude Code, or both.');
  if (typeof update !== 'boolean') throw new Error('Invalid update option.');
  return ['-I', path.join(root, 'scripts', 'install-skills.py'), '--target', target,
    ...(preview ? ['--dry-run'] : []), ...(update ? ['--update'] : [])];
}

export function parseInstallerOutput(stdout: string): InstallResult {
  if (stdout.length > MAX_OUTPUT) throw new Error('Installer returned too much output.');
  const result = JSON.parse(stdout.trim()) as InstallResult;
  if (!result || typeof result.dry_run !== 'boolean' || !Array.isArray(result.plan) || result.plan.length > 20 ||
    !result.plan.every(row => row && typeof row.destination === 'string' && row.destination.length < 4096 &&
      ['install', 'update'].includes(row.action) && typeof row.version === 'string' && Number.isInteger(row.files))) {
    throw new Error('Installer returned an invalid result.');
  }
  return result;
}

function run(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT, shell: false, env: childEnv(process.platform) }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return; }
      // Only the installer's explicit JSON error reaches the UI, never a subprocess env/argv dump.
      try {
        const parsed = JSON.parse(stderr.trim());
        if (typeof parsed.error === 'string') { reject(new Error(parsed.error.slice(0, 3000))); return; }
      } catch { /* use the bounded neutral error below */ }
      reject(new Error(error.killed ? 'The skill installer timed out. Try again: the next run finishes or undoes the interrupted one.' : 'Could not run the skill installer. Check that Python 3.10+ is installed.'));
    });
  });
}

async function python(): Promise<Python & { version: string }> {
  const older: string[] = [];
  for (const candidate of pythonCandidates(process.platform)) {
    let stdout: string;
    try {
      stdout = await run(candidate.command, [...candidate.prefix, '-I', '-c', 'import json,sys; print(json.dumps(list(sys.version_info[:3])))'], 5000);
    } catch { continue; /* try the next known executable */ }
    try { return { ...candidate, version: parsePythonVersion(stdout) }; } catch {
      try {
        const v: unknown = JSON.parse(stdout.trim());
        if (Array.isArray(v) && v.every(Number.isInteger)) older.push(`Python ${v.join('.')} at ${candidate.command}`);
      } catch { /* not a version reply */ }
    }
  }
  throw new Error(pythonMissingMessage(process.platform, older));
}

export function registerSkillIpc(getDataDir: () => string): void {
  const source = () => skillSourceRoot(app.isPackaged, app.getAppPath(), process.resourcesPath);
  let busy = false;
  const envelope = async <T>(fn: () => Promise<T>) => {
    try { return { ok: true, data: await fn() }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Skill setup failed.' }; }
  };
  ipcMain.handle('skills:status', () => envelope(async () => {
    const found = await python();
    return { dataDir: getDataDir(), pythonVersion: found.version,
      installerAvailable: fs.existsSync(path.join(source(), 'scripts', 'install-skills.py')) };
  }));
  const install = async (target: unknown, update: unknown, preview: boolean) => envelope(async () => {
    const args = installerArgs(source(), target, preview, update);
    if (busy) throw new Error('A skill installation is already running.');
    busy = true;
    try {
      const found = await python();
      return parseInstallerOutput(await run(found.command, [...found.prefix, ...args], 45000));
    } finally { busy = false; }
  });
  ipcMain.handle('skills:preview', (_event, target: Target, update: boolean = false) => install(target, update, true));
  ipcMain.handle('skills:install', (_event, target: Target, update: boolean = false) => install(target, update, false));
}

import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/release' }, ipcMain: { handle: vi.fn() } }));
import { childEnv, findOnPath, installerArgs, parseInstallerOutput, pythonCandidates, pythonMissingMessage, parsePythonVersion, skillSourceRoot } from '../skills-service';

describe('skills installer boundary', () => {
  it('resolves Python to absolute paths on each platform', () => {
    const present = (...files: string[]) => (candidate: string) => files.includes(candidate);
    const win = { PATH: 'relative\\bin;C:\\Windows;C:\\Python312', LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local', SystemRoot: 'C:\\Windows' };
    expect(pythonCandidates('win32', win, present('C:\\Windows\\py.exe', 'C:\\Python312\\python.exe', 'relative\\bin\\py.exe',
      'C:\\Users\\Example\\AppData\\Local\\Programs\\Python\\Launcher\\py.exe'))).toEqual([
      { command: 'C:\\Windows\\py.exe', prefix: ['-3'] },
      { command: 'C:\\Users\\Example\\AppData\\Local\\Programs\\Python\\Launcher\\py.exe', prefix: ['-3'] },
      { command: 'C:\\Python312\\python.exe', prefix: [] },
    ]);
    expect(pythonCandidates('darwin', { PATH: '/usr/bin:/bin' }, present('/usr/bin/python3', '/opt/homebrew/bin/python3')).map(item => item.command))
      .toEqual(['/opt/homebrew/bin/python3', '/usr/bin/python3']);
    expect(pythonCandidates('linux', { PATH: '.:bin:/usr/bin' }, present('./python3', 'bin/python3', '/usr/bin/python3')).map(item => item.command))
      .toEqual(['/usr/bin/python3']);
    expect(pythonCandidates('linux', {}, present()).length).toBe(0);
  });
  it('finds executables only in absolute PATH entries', () => {
    expect(findOnPath('python3', 'linux', { PATH: ':.:/opt/bin' }, candidate => candidate !== '/nowhere')).toBe('/opt/bin/python3');
    expect(findOnPath('py', 'win32', { Path: 'C:\\Tools' }, () => true)).toBe('C:\\Tools\\py.exe');
  });
  it('says what to do when Python is missing or too old', () => {
    expect(pythonMissingMessage('darwin', ['Python 3.9.6 at /usr/bin/python3'])).toMatch(/^Found Python 3\.9\.6 at \/usr\/bin\/python3, but the skills need Python 3\.10 or newer\. .*brew install python/);
    expect(pythonMissingMessage('win32', [])).toMatch(/^Python 3\.10 or newer was not found\. Install .*python\.org/);
    expect(pythonMissingMessage('linux', [])).toMatch(/package manager/);
  });
  it('passes the installer a minimal environment', () => {
    const env = childEnv('linux', { PATH: '/usr/bin', HOME: '/home/example', OPENAI_API_KEY: 'secret', PYTHONPATH: '/evil', NODE_OPTIONS: '--x' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/example' });
    expect(childEnv('win32', { Path: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Example', ANTHROPIC_API_KEY: 'secret' }))
      .toEqual({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Example' });
  });
  it('requires Python 3.10 or newer', () => {
    expect(parsePythonVersion('[3, 10, 1]')).toBe('3.10.1');
    expect(() => parsePythonVersion('[3, 9, 9]')).toThrow();
    expect(() => parsePythonVersion('Python 3.14')).toThrow();
  });
  it('uses a fixed script and allowlists renderer options', () => {
    expect(installerArgs('/release', 'both', true, true)).toEqual(['-I',path.join('/release','scripts','install-skills.py'),'--target','both','--dry-run','--update']);
    expect(() => installerArgs('/release', '--home=/elsewhere', false, false)).toThrow();
    expect(() => installerArgs('/release', 'codex', false, 'true')).toThrow();
  });
  it('keeps packaged resources outside asar', () => {
    expect(skillSourceRoot(true,'/app','/resources')).toBe(path.join('/resources','community'));
    expect(skillSourceRoot(false,'/app','/resources')).toBe('/app');
  });
  it('refuses malformed or oversized installer results', () => {
    expect(parseInstallerOutput('{"dry_run":true,"plan":[{"destination":"/example","action":"install","version":"0.1.0","files":6}]}').plan).toHaveLength(1);
    expect(() => parseInstallerOutput('{}')).toThrow();
    expect(() => parseInstallerOutput('x'.repeat(600_000))).toThrow();
    expect(() => parseInstallerOutput('{"dry_run":true,"plan":[{"destination":3}]}')).toThrow();
  });
});

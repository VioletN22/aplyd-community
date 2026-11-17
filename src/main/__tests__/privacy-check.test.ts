import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
// @ts-expect-error plain JavaScript module without type declarations
import { PATTERNS, TOKEN_LABELS, isDependencyPath, matchingLabels } from '../../../scripts/privacy-patterns.mjs';

const repo = path.resolve(__dirname, '../../..');
// Built from parts so this file does not trip the check it tests.
const fakeToken = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const fakeHome = '/Us' + 'ers/someone/project/file.js';

describe('privacy patterns', () => {
  it('looks patterns up by label', () => {
    expect(PATTERNS['absolute personal home'].test(fakeHome)).toBe(true);
    expect(TOKEN_LABELS).toContain('provider token');
    expect(TOKEN_LABELS).not.toContain('absolute personal home');
    expect(matchingLabels(`token=${fakeToken}`, TOKEN_LABELS)).toEqual(['provider token']);
  });

  it('skips node_modules with either path separator', () => {
    expect(isDependencyPath('/build/app/node_modules/x/index.js')).toBe(true);
    expect(isDependencyPath('C:\\build\\app\\node_modules\\x\\index.js')).toBe(true);
    expect(isDependencyPath('node_modules\\x\\index.js')).toBe(true);
    expect(isDependencyPath('C:\\build\\app\\dist\\main\\index.js')).toBe(false);
    expect(isDependencyPath('/build/app/my_node_modules_notes/x.js')).toBe(false);
  });
});

describe('privacy check --package', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const tree = (files: Record<string, string>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aplyd-package-'));
    dirs.push(dir);
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    }
    return dir;
  };
  const run = (dir: string) => spawnSync(process.execPath, ['scripts/privacy-check.mjs', '--package', dir], { cwd: repo, encoding: 'utf8' });

  it('passes a clean build and ignores dependencies', () => {
    const dir = tree({ 'dist/main/index.js': 'console.log(1)', 'node_modules/dep/index.js': `const t = '${fakeToken}';` });
    const r = run(dir);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('fails on a token in the app code', () => {
    const dir = tree({ 'dist/main/index.js': `const t = '${fakeToken}';` });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('package: provider token in');
  });

  it('fails on a personal home path in the app code', () => {
    const dir = tree({ 'dist/main/index.js': `require('${fakeHome}')` });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('absolute personal home path');
  });
});

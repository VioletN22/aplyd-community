import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeCommunityData, COMMUNITY_APP_ID, isDevelopmentMode } from '../community-data';

it('uses built renderer for source start and packaged launches, and Vite only for explicit source development', () => {
  expect(isDevelopmentMode(false, undefined, ['electron', 'dist/main/index.js'])).toBe(false);
  expect(isDevelopmentMode(false, undefined, ['electron', 'dist/main/index.js', '--dev'])).toBe(true);
  expect(isDevelopmentMode(false, 'development', [])).toBe(true);
  expect(isDevelopmentMode(true, 'development', ['--dev'])).toBe(false);
});
const directories: string[] = [];
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aplyd-community-test-')); directories.push(dir); return dir; }
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
it('initializes an empty directory and is idempotent', () => {
  const dir = directory(); initializeCommunityData(dir); initializeCommunityData(dir);
  expect(JSON.parse(fs.readFileSync(path.join(dir, '.aplyd-community.json'), 'utf8')).appId).toBe(COMMUNITY_APP_ID);
});
it('does not silently adopt an unmarked existing database', () => {
  const dir = directory(); fs.writeFileSync(path.join(dir, 'job-tracker.db'), 'private');
  expect(() => initializeCommunityData(dir)).toThrow(/unrecognized/);
  expect(fs.readFileSync(path.join(dir, 'job-tracker.db'), 'utf8')).toBe('private');
  expect(fs.existsSync(path.join(dir, '.aplyd-community.json'))).toBe(false);
});
it('rejects foreign and malformed ownership markers without overwriting', () => {
  const dir = directory(); const file = path.join(dir, '.aplyd-community.json');
  for (const value of ['{', '{"appId":"different","schemaVersion":1}']) {
    fs.writeFileSync(file, value); expect(() => initializeCommunityData(dir)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(value);
  }
});
it('refuses empty, BOM-prefixed, and non-object markers with a friendly message', () => {
  const dir = directory(); const file = path.join(dir, '.aplyd-community.json');
  const good = JSON.stringify({ appId: COMMUNITY_APP_ID, schemaVersion: 1 });
  for (const value of ['null', '[]', '42', '﻿' + '{bad']) {
    fs.writeFileSync(file, value);
    expect(() => initializeCommunityData(dir)).toThrow(/compatible Aplyd Community/);
    expect(fs.readFileSync(file, 'utf8')).toBe(value);
  }
  // A valid marker with a UTF-8 BOM is still accepted.
  fs.writeFileSync(file, '﻿' + good);
  expect(() => initializeCommunityData(dir)).not.toThrow();
});
it('refuses when the marker is a directory rather than a file', () => {
  const dir = directory();
  fs.mkdirSync(path.join(dir, '.aplyd-community.json'));
  expect(() => initializeCommunityData(dir)).toThrow(/compatible Aplyd Community/);
});
it('finishes an empty marker left by an interrupted first run', () => {
  const dir = directory(); const file = path.join(dir, '.aplyd-community.json');
  for (const value of ['', '  \n']) {
    fs.writeFileSync(file, value);
    expect(() => initializeCommunityData(dir)).not.toThrow();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ appId: COMMUNITY_APP_ID, schemaVersion: 1 });
  }
  expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
});
it('still refuses an empty marker when a database is already there', () => {
  const dir = directory(); const file = path.join(dir, '.aplyd-community.json');
  fs.writeFileSync(file, '');
  fs.writeFileSync(path.join(dir, 'job-tracker.db'), 'private');
  expect(() => initializeCommunityData(dir)).toThrow(/compatible Aplyd Community/);
  expect(fs.readFileSync(file, 'utf8')).toBe('');
});
it('names the folder and the way out in every refusal', () => {
  const dir = directory(); const file = path.join(dir, '.aplyd-community.json');
  fs.writeFileSync(file, '{"appId":"different","schemaVersion":1}');
  let message = '';
  try { initializeCommunityData(dir); } catch (e) { message = (e as Error).message; }
  expect(message).toContain(dir);
  expect(message).toContain(file);
  expect(message).toMatch(/move that folder somewhere else/);
  expect(message).toMatch(/delete the file/);

  const other = directory();
  fs.writeFileSync(path.join(other, 'job-tracker.db'), 'private');
  try { initializeCommunityData(other); } catch (e) { message = (e as Error).message; }
  expect(message).toContain(other);
  expect(message).toMatch(/move that folder somewhere else/);
});
it('writes the marker in one step without leaving temporary files', () => {
  const dir = directory();
  initializeCommunityData(dir);
  expect(fs.readdirSync(dir)).toEqual(['.aplyd-community.json']);
});

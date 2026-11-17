import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  chooseFormatLocale, runStartupSteps, databaseErrorText, versionMenuLabel, closeOnQuit,
} from '../startup';

describe('chooseFormatLocale', () => {
  it('prefers the regional format over the display language', () => {
    expect(chooseFormatLocale({ systemLocale: () => 'de-DE', preferredLanguages: () => ['en-US'] })).toBe('de-DE');
  });
  it('accepts underscores from the OS', () => {
    expect(chooseFormatLocale({ systemLocale: () => 'en_AU', preferredLanguages: () => [] })).toBe('en-AU');
  });
  it('falls back to the first preferred language', () => {
    expect(chooseFormatLocale({ systemLocale: () => '', preferredLanguages: () => ['fr-CA', 'en'] })).toBe('fr-CA');
    expect(chooseFormatLocale({ systemLocale: () => { throw new Error('no'); }, preferredLanguages: () => ['ja-JP'] })).toBe('ja-JP');
  });
  it('falls back to English when nothing usable is there', () => {
    expect(chooseFormatLocale({ systemLocale: () => '', preferredLanguages: () => [] })).toBe('en');
    expect(chooseFormatLocale({ systemLocale: () => '!!', preferredLanguages: () => ['??'] })).toBe('en');
    expect(chooseFormatLocale({})).toBe('en');
  });
});

describe('runStartupSteps', () => {
  it('keeps going when an optional step fails', () => {
    const onFatal = vi.fn();
    const log = vi.fn();
    const ran: string[] = [];
    const ok = runStartupSteps(
      [{ name: 'database', run: () => ran.push('database') }],
      [
        { name: 'calendar sync', run: () => { throw new Error('calendar is down'); } },
        { name: 'inbox sync', run: () => { throw new Error('bad inbox setting'); } },
        { name: 'quick add', run: () => ran.push('quick add') },
      ],
      { onFatal, log },
    );
    expect(ok).toBe(true);
    expect(onFatal).not.toHaveBeenCalled();
    expect(ran).toEqual(['database', 'quick add']);
    expect(log).toHaveBeenCalledWith('[startup] calendar sync failed, continuing:', 'calendar is down');
  });

  it('stops and reports when the database fails', () => {
    const onFatal = vi.fn();
    const later = vi.fn();
    const ok = runStartupSteps(
      [{ name: 'database', run: () => { throw new Error('file is not a database'); } }],
      [{ name: 'prep', run: later }],
      { onFatal, log: () => {} },
    );
    expect(ok).toBe(false);
    expect(onFatal).toHaveBeenCalledWith('file is not a database', 'database');
    expect(later).not.toHaveBeenCalled();
  });
});

describe('databaseErrorText', () => {
  it('gives the restore steps in order, including the WAL files', () => {
    const { title, body } = databaseErrorText('boom', '/data/backups');
    expect(title).toBe('Aplyd Community cannot open its database');
    const quit = body.indexOf('Quit Aplyd Community');
    const wal = body.indexOf('job-tracker.db-wal and job-tracker.db-shm');
    const replace = body.indexOf('Replace job-tracker.db with the backup copy');
    expect(quit).toBeGreaterThan(0);
    expect(wal).toBeGreaterThan(quit);
    expect(replace).toBeGreaterThan(wal);
    expect(body).toContain('/data/backups');
  });
});

describe('versionMenuLabel', () => {
  it('names the app and version', () => {
    expect(versionMenuLabel('0.2.0')).toBe('Aplyd Community 0.2.0');
  });
});

describe('closeOnQuit', () => {
  it('closes the database when the app quits', () => {
    const app = new EventEmitter();
    const close = vi.fn();
    closeOnQuit(app, close);
    app.emit('will-quit');
    expect(close).toHaveBeenCalledTimes(1);
  });
});

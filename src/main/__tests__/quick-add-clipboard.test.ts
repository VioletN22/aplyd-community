import { describe, expect, it } from 'vitest';
import { readQuickAddClipboard } from '../quick-add-clipboard';

describe('Quick Add asynchronous clipboard', () => {
  it('uses a bookmark-only macOS clipboard as the captured job URL', async () => {
    const source = {
      readText: async () => '  ',
      read: async () => [{
        types: ['electron application/bookmark'],
        getType: async () => ({ title: 'Example vacancy', url: 'https://example.org/jobs/1' }),
      }],
    };
    expect(await readQuickAddClipboard(source, 'darwin')).toEqual({ text: '  ', bookmarkUrl: 'https://example.org/jobs/1' });
  });

  it('keeps copied text ahead of a different bookmark', async () => {
    const source = {
      readText: async () => 'https://example.org/jobs/text',
      read: async () => [{ types: ['electron application/bookmark'], getType: async () => ({ title: '', url: 'https://example.org/jobs/bookmark' }) }],
    };
    expect(await readQuickAddClipboard(source, 'darwin')).toEqual({ text: 'https://example.org/jobs/text' });
  });

  it.each(['win32', 'linux'] as const)('does not treat platform bookmark data as a URL on %s', async platform => {
    const source = {
      readText: async () => '',
      read: async () => [{ types: ['electron application/bookmark'], getType: async () => ({ title: '', url: 'https://example.org/jobs/bookmark' }) }],
    };
    expect(await readQuickAddClipboard(source, platform)).toEqual({ text: '' });
  });

  it('skips non-bookmark and unreadable entries to find a usable bookmark', async () => {
    const source = {
      readText: async () => '',
      read: async () => [
        { types: ['text/html'], getType: async () => { throw new Error('No bookmark here'); } },
        { types: ['electron application/bookmark'], getType: async () => { throw new Error('Clipboard changed'); } },
        { types: ['electron application/bookmark'], getType: async () => ({ title: '', url: 'https://example.org/jobs/2' }) },
      ],
    };
    expect(await readQuickAddClipboard(source, 'darwin')).toEqual({ text: '', bookmarkUrl: 'https://example.org/jobs/2' });
  });

  it('leaves an unavailable bookmark clipboard empty so browser-tab capture can continue', async () => {
    expect(await readQuickAddClipboard({ readText: async () => '', read: async () => { throw new Error('Unavailable'); } }, 'darwin')).toEqual({ text: '' });
  });
});

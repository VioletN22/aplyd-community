interface ClipboardReader {
  readText(): Promise<string>;
  read(): Promise<Array<{
    readonly types: readonly string[];
    getType(type: 'electron application/bookmark'): Promise<{ url: string; title: string }>;
  }>>;
}

/** Normalize Electron's asynchronous clipboard for the Quick Add pipeline. */
export async function readQuickAddClipboard(source: ClipboardReader, platform: NodeJS.Platform): Promise<{ text: string; bookmarkUrl?: string | null }> {
  const text = await source.readText();
  if (text.trim() || platform !== 'darwin') return { text };
  try {
    for (const item of await source.read()) {
      if (!item.types.includes('electron application/bookmark')) continue;
      try {
        const bookmark = await item.getType('electron application/bookmark');
        if (typeof bookmark.url === 'string' && bookmark.url.trim()) return { text, bookmarkUrl: bookmark.url };
      } catch { /* Clipboard contents can change between reading items and their data. */ }
    }
  } catch { /* Missing bookmark access must not prevent frontmost-tab capture. */ }
  return { text };
}

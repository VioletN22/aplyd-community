/**
 * A deliberately small markdown reader for model-written sheets (interview
 * prep): headings, bullet and numbered lists, bold, italic, paragraphs. It
 * returns plain data, and the component renders that as React text nodes, so
 * nothing the model writes is ever parsed as HTML.
 */

export interface Span { text: string; bold?: boolean; italic?: boolean }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'para'; spans: Span[] };

/** **bold**, __bold__, *italic*, _italic_. Anything unmatched stays literal. */
export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else out.push({ text: m[4], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: '' }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'para', spans: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const h = HEADING.exec(line.trim());
    if (h) {
      flushPara(); flushList();
      const level = Math.min(3, h[1].length) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, spans: parseInline(h[2].replace(/\s+#+\s*$/, '')) });
      continue;
    }

    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const ordered = !!n;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((b || n)![1]);
      continue;
    }

    // An indented line right after a list item continues that item.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks;
}

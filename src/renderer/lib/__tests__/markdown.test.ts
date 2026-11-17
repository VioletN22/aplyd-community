import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline } from '../markdown';

describe('parseInline', () => {
  it('splits bold and italic', () => {
    expect(parseInline('a **b** c *d*')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' c ' }, { text: 'd', italic: true },
    ]);
  });
  it('leaves stray markers and html alone as text', () => {
    expect(parseInline('2 * 3 <b>x</b>')).toEqual([{ text: '2 * 3 <b>x</b>' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, lists and paragraphs', () => {
    const md = '# Acme\n\nWhat they do.\nSecond line.\n\n## Questions\n- One\n- **Two**\n\n1. First\n2) Second';
    const b = parseMarkdown(md);
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'heading', 'list', 'list']);
    expect(b[1]).toEqual({ kind: 'para', spans: [{ text: 'What they do. Second line.' }] });
    expect(b[3]).toMatchObject({ ordered: false, items: [[{ text: 'One' }], [{ text: 'Two', bold: true }]] });
    expect(b[4]).toMatchObject({ ordered: true });
  });
  it('caps deep headings at level 3 and joins continued list items', () => {
    const b = parseMarkdown('#### Deep\n- item\n  more');
    expect(b[0]).toMatchObject({ kind: 'heading', level: 3 });
    expect(b[1]).toMatchObject({ items: [[{ text: 'item more' }]] });
  });
  it('handles empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});

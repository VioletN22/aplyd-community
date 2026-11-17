import React, { useMemo } from 'react';
import { parseMarkdown, Span } from '../lib/markdown';

// Every piece of text goes through React as a text node: nothing here is HTML.
const Spans: React.FC<{ spans: Span[] }> = ({ spans }) => (
  <>
    {spans.map((s, i) =>
      s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : <React.Fragment key={i}>{s.text}</React.Fragment>,
    )}
  </>
);

const HEADING_SIZE = { 1: 'var(--fs-4)', 2: '15px', 3: 'var(--fs-3)' } as const;

/** Headings, lists, bold, paragraphs. Enough for a prep sheet, nothing more. */
export const Markdown: React.FC<{ text: string }> = ({ text }) => {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <p key={i} style={{ fontSize: HEADING_SIZE[b.level], fontWeight: 700, color: 'var(--ink)', margin: i === 0 ? '0 0 6px' : '16px 0 6px' }}>
              <Spans spans={b.spans} />
            </p>
          );
        }
        if (b.kind === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} style={{ margin: '0 0 10px', paddingLeft: 20 }}>
              {b.items.map((item, j) => (
                <li key={j} style={{ marginBottom: 4 }}><Spans spans={item} /></li>
              ))}
            </Tag>
          );
        }
        return <p key={i} style={{ margin: '0 0 10px' }}><Spans spans={b.spans} /></p>;
      })}
    </div>
  );
};

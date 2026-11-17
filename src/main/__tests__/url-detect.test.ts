import { describe, it, expect } from 'vitest';
import { detectUrls } from '../claude';
import { bareUrl, isSingleUrlInput, splitAddItems } from '../../shared/add-input';

describe('detectUrls', () => {
  it('finds a bare URL', () => {
    expect(detectUrls('https://www.seek.com.au/job/12345')).toEqual(['https://www.seek.com.au/job/12345']);
  });

  it('finds a URL sitting inside other text', () => {
    const text = 'Saw this one today (https://jobs.lever.co/acme/abc-123) and it looks decent.';
    expect(detectUrls(text)).toEqual(['https://jobs.lever.co/acme/abc-123']);
  });

  it('finds every URL when they are one per line, in order, deduped', () => {
    const text = 'https://a.example.com/1\nhttps://b.example.com/2\nhttps://a.example.com/1\n';
    expect(detectUrls(text)).toEqual(['https://a.example.com/1', 'https://b.example.com/2']);
  });

  it('returns nothing when there is no URL', () => {
    expect(detectUrls('Frontend Engineer at Acme. React, TypeScript, Sydney.')).toEqual([]);
  });

  it('drops trailing sentence punctuation', () => {
    expect(detectUrls('Apply here: https://acme.com/careers/42.')).toEqual(['https://acme.com/careers/42']);
  });

  it('ignores bare domains and other schemes', () => {
    expect(detectUrls('acme.com and mailto:jobs@acme.com and ftp://acme.com/x')).toEqual([]);
  });
});

describe('bareUrl', () => {
  it('accepts a line that is only a URL', () => {
    expect(bareUrl('  https://acme.com/jobs/1  ')).toBe('https://acme.com/jobs/1');
  });
  it('rejects a line with words around the URL', () => {
    expect(bareUrl('see https://acme.com/jobs/1')).toBeNull();
  });
  it('rejects a line with two URLs', () => {
    expect(bareUrl('https://a.com/1 https://b.com/2')).toBeNull();
  });
});

describe('isSingleUrlInput', () => {
  it('is true for the whole input being one URL', () => {
    expect(isSingleUrlInput('https://acme.com/jobs/1')).toBe(true);
  });
  it('is true when the URL is on its own first line, with notes below', () => {
    expect(isSingleUrlInput('https://acme.com/jobs/1\nremember: referred by Sam')).toBe(true);
  });
  it('is false for a posting that merely mentions a URL', () => {
    expect(isSingleUrlInput('Frontend Engineer at Acme.\nApply at https://acme.com/jobs/1')).toBe(false);
  });
  it('is false for two URL lines', () => {
    expect(isSingleUrlInput('https://a.com/1\nhttps://b.com/2')).toBe(false);
  });
});

describe('splitAddItems', () => {
  it('splits URL-per-line input into one item per URL', () => {
    expect(splitAddItems('https://a.com/1\n\nhttps://b.com/2\nhttps://c.com/3')).toEqual([
      'https://a.com/1', 'https://b.com/2', 'https://c.com/3',
    ]);
  });

  it('keeps a single URL as one item', () => {
    expect(splitAddItems('https://a.com/1')).toEqual(['https://a.com/1']);
  });

  it('keeps one pasted posting whole, blank lines and all', () => {
    const posting = [
      'Frontend Engineer',
      '',
      'Acme is hiring. ' + 'x'.repeat(600),
      '',
      'Responsibilities:',
      '',
      'Build things. ' + 'y'.repeat(600),
    ].join('\n');
    expect(splitAddItems(posting)).toEqual([posting.trim()]);
  });

  it('splits two long blank-line-separated postings into two items', () => {
    const one = 'Frontend Engineer at Acme. ' + 'a'.repeat(500);
    const two = 'Backend Engineer at Globex. ' + 'b'.repeat(500);
    expect(splitAddItems(one + '\n\n' + two)).toEqual([one, two]);
  });

  it('returns nothing for empty input', () => {
    expect(splitAddItems('   \n  ')).toEqual([]);
  });
});

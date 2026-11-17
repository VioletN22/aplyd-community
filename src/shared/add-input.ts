// What did the user just paste? Both halves of the app have to agree on the answer:
// the modal decides what the submit button says, the main process decides what it
// actually does, and if those two ever disagreed the button would lie. So the
// rules live here, pure and shared, with no DB, network, or Electron in sight.

// Anything with an http(s) scheme. Whitespace and quote-ish characters end it;
// trailing sentence punctuation is trimmed afterwards.
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCT = /[.,;:!?"'`)\]}>]+$/;

/** A single blank-line block only counts as its own posting once it is this long. */
const BLOCK_MIN_CHARS = 400;

/**
 * Every http(s) URL in the text, in the order they appear, deduped.
 * Pure: no fetching, no validation beyond the shape.
 */
export function detectUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text || '').matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT, '');
    // "https://" on its own is not a link.
    if (url.length <= 9 || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * The URL of a line that is nothing but a URL, else null. This is the test that
 * separates "here is a link to the job" from "the posting happens to mention a
 * link": a posting line always has words around its URL.
 */
export function bareUrl(line: string): string | null {
  const t = String(line || '').trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  const url = t.replace(TRAILING_PUNCT, '');
  return url.length > 9 ? url : null;
}

/**
 * True when the input is one link (the whole thing, or the first line with notes
 * under it). That is the case where we fetch the page instead of asking the model
 * to extract a job from a URL string.
 */
export function isSingleUrlInput(text: string): boolean {
  return singleUrlOf(text) !== null;
}

/** The link to fetch when isSingleUrlInput is true, else null. */
export function singleUrlOf(text: string): string | null {
  const t = String(text || '').trim();
  if (!t) return null;
  if (detectUrls(t).length !== 1) return null;
  const whole = bareUrl(t);
  if (whole) return whole;
  const firstLine = t.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  return bareUrl(firstLine);
}

/**
 * Split a paste into the applications it represents.
 *
 * Two shapes count as several applications:
 *   1. Two or more lines that are each nothing but a URL (a burst of links).
 *   2. Two or more blank-line-separated blocks that are ALL long (>= 400 chars),
 *      which is what several full postings pasted back to back looks like.
 *
 * Everything else is one application. Rule 2 is deliberately strict: one posting
 * with paragraphs also has blank lines in it, but it always carries a short block
 * somewhere (a heading, a location line), so it stays whole.
 */
export function splitAddItems(text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];

  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const urls = lines.map(bareUrl);
  if (lines.length >= 2 && urls.every((u): u is string => u !== null)) {
    const seen = new Set<string>();
    return urls.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  }

  const blocks = t.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length >= 2 && blocks.every((b) => b.length >= BLOCK_MIN_CHARS)) return blocks;

  return [t];
}

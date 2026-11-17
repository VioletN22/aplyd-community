/**
 * Colour for every chip on the Applications page, in one place.
 *
 * Each chip category has its own shape (see components/Chips.tsx) and, within
 * a category, each value has its own colour: stages by meaning, sources by the
 * job board or ATS they name, locations by metro. Anything unknown (a legacy
 * stage, a new board) takes a colour from a curated palette picked by a hash of
 * its label, so the same value is always the same colour across renders and
 * launches, never random.
 *
 * Every pair is a dark foreground on a light tint and clears WCAG AA (4.5:1)
 * for small text; __tests__/chipColors.test.ts checks every entry. The app is
 * light-only (no dark theme exists), so there is one set.
 */

import { sourceFamily } from '../../shared/source';

export interface ChipTone {
  /** Tint behind the text. */
  bg: string;
  /** Text and icon colour. */
  fg: string;
  /** Border or dot: a mid tone of the same hue. */
  dot: string;
}

// Tailwind-style 100 / 800 / 400 steps, written out (the shipped Chromium is
// too old for color-mix()).
const T = {
  blue:    { bg: '#dbeafe', fg: '#1e40af', dot: '#60a5fa' },
  sky:     { bg: '#e0f2fe', fg: '#075985', dot: '#38bdf8' },
  cyan:    { bg: '#cffafe', fg: '#155e75', dot: '#22d3ee' },
  teal:    { bg: '#ccfbf1', fg: '#115e59', dot: '#2dd4bf' },
  emerald: { bg: '#d1fae5', fg: '#065f46', dot: '#34d399' },
  green:   { bg: '#dcfce7', fg: '#166534', dot: '#22c55e' },
  lime:    { bg: '#ecfccb', fg: '#3f6212', dot: '#84cc16' },
  yellow:  { bg: '#fef9c3', fg: '#854d0e', dot: '#facc15' },
  amber:   { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  orange:  { bg: '#ffedd5', fg: '#9a3412', dot: '#fb923c' },
  red:     { bg: '#fee2e2', fg: '#991b1b', dot: '#ef4444' },
  rose:    { bg: '#ffe4e6', fg: '#9f1239', dot: '#fb7185' },
  pink:    { bg: '#fce7f3', fg: '#9d174d', dot: '#f472b6' },
  fuchsia: { bg: '#fae8ff', fg: '#86198f', dot: '#e879f9' },
  purple:  { bg: '#f3e8ff', fg: '#6b21a8', dot: '#c084fc' },
  lavender:  { bg: '#ede9fe', fg: '#5b21b6', dot: '#8b5cf6' },
  indigo:  { bg: '#e0e7ff', fg: '#3730a3', dot: '#818cf8' },
  slate:   { bg: '#e2e8f0', fg: '#334155', dot: '#94a3b8' },
  grey:    { bg: '#f3f4f6', fg: '#4b5563', dot: '#9ca3af' },
} satisfies Record<string, ChipTone>;

export const TONES: Readonly<Record<keyof typeof T, ChipTone>> = T;

/** The hash palette: distinct hues only, no greys, for values nothing names. */
export const HASH_PALETTE: readonly ChipTone[] = [
  T.blue, T.teal, T.amber, T.lavender, T.rose, T.lime, T.cyan, T.orange,
  T.fuchsia, T.emerald, T.indigo, T.pink, T.sky, T.yellow, T.purple,
];

/** FNV-1a over the normalised label: stable across renders, launches and machines. */
export const hashLabel = (label: string): number => {
  let h = 0x811c9dc5;
  for (const ch of label.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

export const hashTone = (label: string): ChipTone => HASH_PALETTE[hashLabel(label) % HASH_PALETTE.length];

// ── Stages ────────────────────────────────────────────────────────────────────
// The funnel reads left to right: blue (sent), amber (being tested), sky/purple
// (talking), green (won), red/grey (over).
const STAGE_TONE: Record<string, ChipTone> = {
  applied: T.blue,
  oa: T.orange,
  assessment: T.orange,
  take_home: T.amber,
  assessed: T.yellow,
  phone_screen: T.rose,
  interview: T.red,
  offer: T.green,
  rejected: T.grey,
  withdrawn: T.slate,
};

export const stageTone = (stage: string): ChipTone => STAGE_TONE[stage] ?? hashTone(stage);

// ── Sources ───────────────────────────────────────────────────────────────────
// Sources are free text ("SEEK Quick apply (Hays)", "Official Greenhouse
// employer job board"), so colour follows the board or ATS the text names.
// The earliest mention wins: "Workable employer listing; employer LinkedIn
// post..." is Workable.
// The family itself (which board or ATS the free text names, earliest mention
// wins) lives in shared/source.ts, which "What's working" groups by too.
const SOURCE_TONE: Record<string, ChipTone> = {
  SEEK: T.pink,
  LinkedIn: T.indigo,
  Indeed: T.fuchsia,
  Greenhouse: T.emerald,
  Lever: T.teal,
  Workable: T.cyan,
  Ashby: T.purple,
  Breezy: T.lime,
  SmartRecruiters: T.orange,
  Jora: T.amber,
  Teamtailor: T.rose,
  PageUp: T.rose,
  Rippling: T.yellow,
  Email: T.sky,
  // Straight from the employer, no board in between: neutral on purpose.
  Employer: T.slate,
};

export interface SourceChip { label: string; tone: ChipTone }

/** The short label and colour for a free-text job source, or null when there is none. */
export const sourceChip = (source: string | null | undefined): SourceChip | null => {
  const label = sourceFamily(source);
  if (!label) return null;
  return { label, tone: SOURCE_TONE[label] ?? hashTone(label) };
};

// ── Locations ─────────────────────────────────────────────────────────────────
const LOCATION_TONE: Record<string, ChipTone> = {
  Sydney: T.sky,
  Melbourne: T.rose,
  Regional: T.lime,
};

export const locationTone = (place: string): ChipTone => LOCATION_TONE[place] ?? hashTone(place);

// ── Activity flags ────────────────────────────────────────────────────────────
// Things that want their attention on a row, each its own colour.
export const FLAG_TONE = {
  interview: T.red,
  drafting: T.sky,
  draftReady: T.teal,
  noResponse: T.amber,
} as const;

// ── Fit ───────────────────────────────────────────────────────────────────────
export const fitTone = (score: number): ChipTone =>
  score >= 7 ? T.blue : score >= 5 ? T.slate : T.grey;

// ── Contrast (used by the test, kept here so the maths lives with the colours) ─
const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

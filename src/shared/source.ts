// Job sources are free text ("SEEK Quick apply (Hays)", "Official Greenhouse
// employer job board", "linkedin"), so both the Applications chips and the
// "What's working" table group them by the board or ATS the text names. One
// list, here, so the two can never disagree.

/** Named boards and ATSs. The earliest mention in the text wins. */
export const SOURCE_FAMILIES: readonly { re: RegExp; label: string }[] = [
  { re: /seek/i, label: 'SEEK' },
  { re: /linked\s*in/i, label: 'LinkedIn' },
  { re: /indeed/i, label: 'Indeed' },
  { re: /greenhouse/i, label: 'Greenhouse' },
  { re: /\blever\b/i, label: 'Lever' },
  { re: /workable/i, label: 'Workable' },
  { re: /ashby/i, label: 'Ashby' },
  { re: /breezy/i, label: 'Breezy' },
  { re: /smart\s*recruiters/i, label: 'SmartRecruiters' },
  { re: /\bjora\b/i, label: 'Jora' },
  { re: /teamtailor/i, label: 'Teamtailor' },
  { re: /pageup/i, label: 'PageUp' },
  { re: /rippling/i, label: 'Rippling' },
  { re: /\bemail\b/i, label: 'Email' },
];

/** Straight from the employer, no board in between. Only when nothing above matched. */
export const EMPLOYER_SOURCE = { re: /employer|careers|official|direct|company site/i, label: 'Employer' } as const;

/**
 * The family label for a free-text source ("SEEK Quick Apply" -> "SEEK"), the
 * trimmed text itself when it names nothing known, or null when it is empty.
 * "Workable employer listing; employer LinkedIn post..." is Workable: the
 * earliest named platform wins, and "Employer" only when none is named.
 */
export function sourceFamily(source: string | null | undefined): string | null {
  const text = source?.trim();
  if (!text) return null;
  let best: { at: number; label: string } | null = null;
  for (const p of SOURCE_FAMILIES) {
    const m = p.re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, label: p.label };
  }
  if (best) return best.label;
  if (EMPLOYER_SOURCE.re.test(text)) return EMPLOYER_SOURCE.label;
  return text;
}

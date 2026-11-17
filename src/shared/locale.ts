// The one locale every displayed date, time and number goes through.
//
// Nothing here forces a country: with no locale set, Intl uses the runtime's
// own default, which is the system locale. The main process sets it once from
// the OS preference list at startup and hands the same value to the renderer,
// so both halves format alike. A later Settings option only has to call
// setDisplayLocale. Machine formats (ISO dates, keys, file names, parsing)
// never go through this: they stay fixed.

let displayLocaleValue: string | undefined;

/** A canonical BCP 47 tag, or undefined when the input is empty or not a valid tag. */
export function normalizeLocale(locale: string | null | undefined): string | undefined {
  const raw = (locale || '').trim().replace(/_/g, '-');
  if (!raw) return undefined;
  try {
    const [tag] = Intl.getCanonicalLocales(raw);
    return tag || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The locale to pass to toLocaleString / Intl. undefined means the system
 * default, which is what Intl does with undefined.
 */
export function displayLocale(): string | undefined {
  return displayLocaleValue;
}

/** Set (or clear, with null / '') the display locale. Invalid tags clear it. */
export function setDisplayLocale(locale: string | null | undefined): void {
  displayLocaleValue = normalizeLocale(locale);
}

/** A number for display, grouped the way the user's locale groups it. No currency symbol. */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(displayLocale(), options);
}

/**
 * An Accept-Language header value for a locale: its own tag first, then its
 * language, then English as the fallback a job board will always have.
 * "en-AU" -> "en-AU,en;q=0.9", "de-DE" -> "de-DE,de;q=0.9,en;q=0.8", none -> "en".
 */
export function acceptLanguage(locale: string | null | undefined): string {
  const tag = normalizeLocale(locale);
  if (!tag) return 'en';
  const lang = tag.split('-')[0].toLowerCase();
  const parts = [tag];
  if (lang !== tag.toLowerCase()) parts.push(`${lang};q=0.9`);
  if (lang !== 'en') parts.push('en;q=0.8');
  return parts.join(',');
}

/**
 * A short clock time for calendar chips: "9 am" and "9:30 am" where the locale
 * uses a 12-hour clock, the full "22:00" or "9:00" where it does not. Only the
 * am/pm form drops ":00", since "22" alone does not read as a time.
 */
export function shortClock(when: Date | string | number, opts: { locale?: string; timeZone?: string } = {}): string {
  const date = when instanceof Date ? when : new Date(when);
  const parts = new Intl.DateTimeFormat(opts.locale ?? displayLocale(), {
    timeZone: opts.timeZone, hour: 'numeric', minute: '2-digit',
  }).formatToParts(date);
  if (!parts.some((p) => p.type === 'dayPeriod')) return parts.map((p) => p.value).join('');
  const onTheHour = parts.find((p) => p.type === 'minute')?.value === '00';
  return parts
    .filter((p, i) => !(onTheHour && (p.type === 'minute' || (p.type === 'literal' && parts[i + 1]?.type === 'minute'))))
    .map((p) => (p.type === 'dayPeriod' ? p.value.toLowerCase() : p.value))
    .join('');
}

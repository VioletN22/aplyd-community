import { describe, it, expect } from 'vitest';
import { shortClock } from '../locale';

// Intl puts a narrow or plain no-break space before am/pm depending on the ICU
// version. Compare with ordinary spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const at = (hhmm: string) => `2026-11-17T${hhmm}:00Z`;
const clock = (hhmm: string, locale: string) => plain(shortClock(at(hhmm), { locale, timeZone: 'UTC' }));

describe('shortClock', () => {
  it.each([
    ['en-AU', '09:00', '9 am'],
    ['en-AU', '09:30', '9:30 am'],
    ['en-AU', '22:00', '10 pm'],
    ['en-US', '09:00', '9 am'],
    ['en-US', '22:00', '10 pm'],
    ['en-US', '22:15', '10:15 pm'],
    ['de-DE', '22:00', '22:00'],
    ['de-DE', '09:00', '9:00'],
    ['de-DE', '09:30', '9:30'],
    ['en-US-u-hc-h23', '22:00', '22:00'],
    ['en-US-u-hc-h23', '00:00', '00:00'],
  ])('%s at %s reads %s', (locale, hhmm, expected) => {
    expect(clock(hhmm, locale)).toBe(expected);
  });

  it('never cuts a 24-hour time down to the hour alone', () => {
    for (const locale of ['de-DE', 'fr-FR', 'en-GB', 'en-US-u-hc-h23']) {
      expect(clock('22:00', locale)).toMatch(/22.00/);
    }
  });

  it('follows the time zone it is given', () => {
    expect(plain(shortClock(at('22:00'), { locale: 'en-AU', timeZone: 'Australia/Sydney' }))).toBe('9 am');
  });
});

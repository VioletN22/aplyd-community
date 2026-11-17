// Pure detection: does this email ask them to do something outside Aplyd that
// isn't itself a stage change - pick an interview time, or verify their SEEK
// Pass Digital Identity? Everything else (captchas, portal accounts, stalled
// applications, one-off questions) still comes from the ACTION-NEEDED.md
// hand-off for now; this covers the two patterns worth catching automatically
// because they show up over and over, worded slightly differently every time.

export type DetectedAction =
  | { type: 'schedule'; url: string | null }
  | { type: 'seek_pass_verify' };

/** A scheduling link from the usual booking tools. */
const SCHEDULE_LINK_RE = /https?:\/\/(?:calendar\.app\.google|[a-z0-9-]+\.calendly\.com|calendly\.com)\/\S+/gi;
/**
 * Calendly's own confirmation email ("you're booked") carries cancel and
 * reschedule links, not a booking page: seeing one means the user already booked.
 */
const CALENDLY_MANAGE_RE = /calendly\.com\/(?:cancellations|reschedulings)\//i;
/** Phrasing that asks them to pick a slot, without necessarily linking one (e.g. "reply with times that suit you"). */
const SCHEDULE_PHRASE_RE = /\b(book a time|book your (?:30-minute |15-minute |)?(?:intro |interview )?call|select a time|schedule your interview|pick a time)\b/i;

const SEEK_PASS_RE = /seek\s*pass/i;
const DIGITAL_IDENTITY_RE = /digital\s+identity/i;

/** Trim trailing punctuation a sentence would leave stuck to a bare URL. */
function cleanUrl(url: string): string {
  return url.replace(/[),.!?;:]+$/, '');
}

/**
 * What one email (subject + body, already known to be job-related) asks them
 * to do outside the app. null when it matches neither recognised pattern.
 */
export function detectActionEmail(input: { subject: string; body: string }): DetectedAction | null {
  const text = `${input.subject}\n${input.body}`;
  if (SEEK_PASS_RE.test(text) && DIGITAL_IDENTITY_RE.test(text)) return { type: 'seek_pass_verify' };
  const link = (text.match(SCHEDULE_LINK_RE) ?? []).find((u) => !CALENDLY_MANAGE_RE.test(u));
  if (link) return { type: 'schedule', url: cleanUrl(link) };
  if (SCHEDULE_PHRASE_RE.test(text)) return { type: 'schedule', url: null };
  return null;
}

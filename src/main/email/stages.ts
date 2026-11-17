// What an email kind does to an application's stage. Pure. The one rule that
// matters most: an email never moves an application backwards, and never out
// of a final stage. A late "thanks for applying" must not undo a rejection.

import type { EmailKind } from '../../shared/types';

/** Stages nothing automatic may leave. The user can still move them by hand. */
export const FINAL_STAGES = new Set(['rejected', 'offer', 'withdrawn']);

/**
 * Funnel order, matching flow.ts. A truly unknown custom stage (one the app
 * doesn't recognise, e.g. a made-up "final_round") sits above all of these,
 * so an automatic email never guesses whether it is earlier or later in the
 * funnel and leaves it alone. The Today custom stages are ones we DO
 * recognise, so they get real ranks below interview/offer: an interview,
 * offer or rejection email must still be able to move them forward.
 */
const RANK: Record<string, number> = {
  started: 0, applied: 1, oa: 2,
  // assessment and its legacy alias are the to-do; assessed (done) ranks above
  // them, so an assessment email can never move a finished one back to to-do.
  assessment: 2, take_home: 2, assessed: 2.5,
  phone_screen: 3, interview: 4, offer: 5,
};
const rankOf = (stage: string) => (stage in RANK ? RANK[stage] : 50);

/** "a quick phone call", "screening call", "phone screen": the phone_screen stage. */
export function isPhoneScreen(text: string): boolean {
  return /\b(phone|telephone)\s+(screen|screening|call|chat|interview|conversation)\b|\bscreening\s+(call|chat|interview)\b|\b(quick|brief|short|initial)\s+(phone\s+)?(call|chat)\b/i.test(text || '');
}

/** The stage an email of this kind points at, before looking at the application. */
export function targetStage(kind: EmailKind, text = ''): string | null {
  switch (kind) {
    case 'rejection': return 'rejected';
    case 'offer': return 'offer';
    case 'interview': return isPhoneScreen(text) ? 'phone_screen' : 'interview';
    // Only forward from applied (No response is applied too): never back from
    // assessed, phone_screen, interview or a final stage (see decideStage).
    case 'assessment': return 'assessment';
    default: return null; // received, other: no stage change
  }
}

export interface StageDecision {
  /** The stage to move to; null when nothing moves. */
  proposedStage: string | null;
  /** Why nothing moves, when nothing does. */
  blocked: 'final' | 'backwards' | 'same' | 'no-change' | null;
}

/** Given where the application is now, what this email may do to it. */
export function decideStage(kind: EmailKind, currentStage: string, text = ''): StageDecision {
  const target = targetStage(kind, text);
  if (!target) return { proposedStage: null, blocked: 'no-change' };
  if (FINAL_STAGES.has(currentStage)) return { proposedStage: null, blocked: 'final' };
  if (target === currentStage) return { proposedStage: null, blocked: 'same' };
  // Rejections and offers end the funnel from anywhere that is not already final.
  if (FINAL_STAGES.has(target)) return { proposedStage: target, blocked: null };
  if (rankOf(target) <= rankOf(currentStage)) return { proposedStage: null, blocked: 'backwards' };
  return { proposedStage: target, blocked: null };
}

/** Does applying an email of this kind change anything on the application? */
export function changesSomething(kind: EmailKind, decision: StageDecision): boolean {
  return decision.proposedStage !== null || kind === 'assessment';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "From email: <subject> (<d Mon>)", the note on the stage history row. */
export function emailNote(subject: string, sentAt: string): string {
  const d = new Date(sentAt);
  const when = Number.isFinite(d.getTime()) ? ` (${d.getDate()} ${MONTHS[d.getMonth()]})` : '';
  const clean = (subject || '(no subject)').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `From email: ${clean}${when}`;
}

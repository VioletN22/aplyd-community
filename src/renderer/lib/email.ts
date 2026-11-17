// Pure helpers for the inbox sync screens (Settings > Email, the per-application
// email list). No window, no React, so they can be tested offline.
import type { EmailEvent, EmailKind, EmailSyncStatus } from '../../shared/types';
import { displayLocale } from '../../shared/locale';

/** Google shows app passwords as four groups of four. The user may paste either form. */
export function cleanAppPassword(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** App passwords are always 16 letters once the spaces are gone. */
export function looksLikeAppPassword(raw: string): boolean {
  return /^[a-zA-Z]{16}$/.test(cleanAppPassword(raw));
}

export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago", then a date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return shortDate(iso);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(displayLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The stage change an applied event made. Null when it moved no stage (a log or a note). */
export function stageChange(e: EmailEvent): { from: string | null; to: string } | null {
  if (e.status !== 'applied' || !e.proposedStage) return null;
  if (e.fromStage && e.fromStage === e.proposedStage) return null;
  return { from: e.fromStage, to: e.proposedStage };
}

const KIND_LABEL: Record<EmailKind, string> = {
  received: 'Received',
  rejection: 'Rejection',
  interview: 'Interview',
  assessment: 'Assessment',
  offer: 'Offer',
  other: 'Other',
};
export const kindLabel = (k: EmailKind): string => KIND_LABEL[k] ?? k;

/** Which stage colour a kind borrows, so chips read the same as the stage badges. */
const KIND_STAGE: Record<EmailKind, string> = {
  received: 'applied',
  rejection: 'rejected',
  interview: 'interview',
  assessment: 'oa',
  offer: 'offer',
  other: 'withdrawn',
};
export const kindStage = (k: EmailKind): string => KIND_STAGE[k] ?? 'withdrawn';

export const plural = (n: number, one: string, many = one + 's'): string =>
  `${n.toLocaleString(displayLocale())} ${n === 1 ? one : many}`;

/** The line under a finished sync: what it checked, what it changed, what is still waiting to be read. */
export function syncSummary(s: Pick<EmailSyncStatus, 'seen' | 'autoApplied' | 'pendingCount'>): string {
  const parts = [`${plural(s.seen, 'email')} checked`];
  if (s.autoApplied > 0) parts.push(`${s.autoApplied.toLocaleString(displayLocale())} updated`);
  if (s.pendingCount > 0) parts.push(`${s.pendingCount.toLocaleString(displayLocale())} waiting to be read`);
  return `Done. ${parts.join(', ')}.`;
}

/** For an email waiting to be read: the application it most likely belongs to, if matching found one. */
export function waitingLine(e: EmailEvent): string {
  const c = e.candidates[0];
  if (!c) return '';
  return `Probably ${c.company}${c.role ? `, ${c.role}` : ''}`;
}

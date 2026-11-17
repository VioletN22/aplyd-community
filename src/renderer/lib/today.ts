import { CALENDAR_ZONE, addDays, dateKey, zoneMidnight } from '../../shared/calendar';
import type { TodayActionItem, TodayData } from '../../shared/types';
import { displayLocale } from '../../shared/locale';

/** Nothing on any list: the calm "All caught up." state. */
export function isCaughtUp(d: TodayData): boolean {
  return d.draftsReady.length === 0 && d.interviewsSoon.length === 0
    && (d.assessmentsDue?.length ?? 0) === 0 && (d.actionItems?.length ?? 0) === 0 && d.goingQuiet.length === 0;
}

const startOfDay = (t: number) => Date.parse(zoneMidnight(dateKey(new Date(t))));

/**
 * "Today, 2:30 pm", "Tomorrow, 10:00 am", "Thu 1 Oct, 9:00 am". Local time,
 * which is how interview_at is stored. Empty for an unreadable value.
 */
export function interviewWhen(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (!Number.isFinite(t)) return '';
  const time = d.toLocaleTimeString(displayLocale(), { timeZone: CALENDAR_ZONE, hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${dayLabel(t, now)}, ${time}`;
}

/** "Today", "Tomorrow", "Thu 1 Oct" for a local instant. */
function dayLabel(t: number, now: number): string {
  const days = Math.round((startOfDay(t) - startOfDay(now)) / 86_400_000);
  return days === 0 ? 'Today'
    : days === 1 ? 'Tomorrow'
    : new Date(t).toLocaleDateString(displayLocale(), { timeZone: CALENDAR_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A due date as a local instant, NaN when unreadable. A bare date
 * ("2026-10-03", how a deadline is often captured) means the end of that
 * configured calendar day, including daylight saving transitions.
 */
export function dueInstant(dueAt: string | null | undefined): number {
  if (!dueAt) return NaN;
  const m = DATE_ONLY_RE.exec(dueAt.trim());
  if (m) {
    try { zoneMidnight(dueAt.trim()); return Date.parse(zoneMidnight(addDays(dueAt.trim(),1))) - 1; } catch { return NaN; }
  }
  return new Date(dueAt).getTime();
}

/** "Due Tomorrow, 9:45 am", or "Due Thu 1 Oct" for a bare date; '' when there is no readable due date. */
export function dueWhen(dueAt: string | null | undefined, now: number = Date.now()): string {
  const t = dueInstant(dueAt);
  if (!Number.isFinite(t)) return '';
  return 'Due ' + (DATE_ONLY_RE.test(dueAt!.trim()) ? dayLabel(t, now) : interviewWhen(dueAt!, now));
}

/** Sort key: soonest first, undated or unreadable after every dated one. */
const dueSortKey = (dueAt: string | null): number => {
  const t = dueInstant(dueAt);
  return Number.isFinite(t) ? t : Infinity;
};
/** Comparator on due dates that never returns NaN (Infinity - Infinity). */
const byDue = (a: string | null, b: string | null): number => {
  const at = dueSortKey(a), bt = dueSortKey(b);
  return at === bt ? 0 : at < bt ? -1 : 1;
};

/** One thing on Today, already worded, in the order to do it. */
export interface TodayItem {
  key: string;
  kind: 'interview' | 'assessment' | 'action' | 'draft' | 'quiet';
  /** What to do, as a short imperative: "Prepare for your interview". */
  action: string;
  /** The job it is about (the linked application's company), or a stand-in when the item spans several. */
  title: string;
  subtitle: string;
  when: string;
  applicationId?: string;
  /** Gmail deep link to the email worth reading, when there is one. */
  emailUrl?: string | null;
  /** The card's own primary link: applications.job_url for interview/assessment cards, the action item's own link for action cards. */
  jobUrl?: string | null;
  /** Link text for jobUrl; 'Job listing' when omitted. */
  jobUrlLabel?: string;
  /** Set only for kind 'action': the action_items.id a Done control marks done. */
  actionItemId?: string;
}

const HOURS_36 = 36 * 3_600_000;

/** Priority order for two action items with the same (or no) due date: high, then normal, then low. */
const PRIORITY_RANK: Record<TodayActionItem['priority'], number> = { high: 0, normal: 1, low: 2 };

/**
 * Pure: order action items among themselves. Soonest due date first; among
 * undated items, high priority sorts before normal; low priority always sinks
 * to the very end, dated or not - "get to it eventually" is the whole point
 * of low priority.
 */
export function sortActionItems(items: TodayActionItem[]): TodayActionItem[] {
  return [...items].sort((a, b) => {
    if ((a.priority === 'low') !== (b.priority === 'low')) return a.priority === 'low' ? 1 : -1;
    const due = byDue(a.dueAt, b.dueAt);
    if (due !== 0) return due;
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

/**
 * Everything on Today as one list, most urgent first:
 *   interviews in the next 36 hours, assessments due in the next 36 hours, action items due
 *   in the next 36 hours (or high priority with no due date), other interviews this week,
 *   other assessments (soonest due date first, undated last), other action items (same rule),
 *   drafts ready (newest first), applications going quiet (quietest first), then low-priority
 *   action items at the very end. The first item is the one the page makes big.
 */
export function todayItems(raw: TodayData, now: number = Date.now()): TodayItem[] {
  // Tolerate a partial payload: a missing list is an empty list, never a crash.
  const d: TodayData = {
    draftsReady: raw?.draftsReady ?? [],
    interviewsSoon: raw?.interviewsSoon ?? [], assessmentsDue: raw?.assessmentsDue ?? [],
    actionItems: raw?.actionItems ?? [], goingQuiet: raw?.goingQuiet ?? [],
  };
  const interviews = [...d.interviewsSoon]
    .sort((a, b) => new Date(a.interviewAt).getTime() - new Date(b.interviewAt).getTime())
    .map((i): TodayItem => ({
      key: 'iv-' + i.applicationId, kind: 'interview', action: 'Prepare for your interview',
      title: i.company, subtitle: i.role, when: interviewWhen(i.interviewAt, now), applicationId: i.applicationId,
      emailUrl: i.emailUrl, jobUrl: i.jobUrl,
    }));
  const isSoon = (it: TodayItem) => {
    const src = d.interviewsSoon.find((i) => i.applicationId === it.applicationId);
    const t = src ? new Date(src.interviewAt).getTime() : NaN;
    return Number.isFinite(t) && t - now <= HOURS_36;
  };
  const soonInterviews = interviews.filter(isSoon);
  const laterInterviews = interviews.filter((i) => !isSoon(i));
  // Undated (or unreadable) due dates sort after every dated one, soonest first among the rest.
  const assessments = [...d.assessmentsDue]
    .sort((a, b) => byDue(a.dueAt, b.dueAt))
    .map((a): TodayItem => ({
      key: 'as-' + a.applicationId, kind: 'assessment',
      action: a.stage === 'take_home' ? 'Finish your take-home' : 'Finish your assessment',
      title: a.company, subtitle: a.role, when: dueWhen(a.dueAt, now), applicationId: a.applicationId,
      emailUrl: a.emailUrl, jobUrl: a.jobUrl,
    }));
  const isSoonAssessment = (it: TodayItem) => {
    const src = d.assessmentsDue.find((a) => a.applicationId === it.applicationId);
    const t = dueInstant(src?.dueAt);
    return Number.isFinite(t) && t - now <= HOURS_36;
  };
  const soonAssessments = assessments.filter(isSoonAssessment);
  const laterAssessments = assessments.filter((a) => !isSoonAssessment(a));

  // company/role already carry the linked application's over the item's own
  // (listOpenActionItems does that merge). Only a genuinely grouped item - no
  // company at all, but a group_label - reads "Several employers"; anything
  // else unlinked-but-uncategorised is worded generically instead of guessing.
  const toActionItem = (a: TodayActionItem): TodayItem => ({
    key: 'ai-' + a.id, kind: 'action', action: a.title,
    title: a.company ?? (a.groupLabel ? 'Several employers' : 'Action needed'),
    subtitle: a.company ? (a.role ?? '') : (a.groupLabel ?? ''),
    when: dueWhen(a.dueAt, now), applicationId: a.applicationId ?? undefined,
    emailUrl: a.emailUrl, jobUrl: a.url, jobUrlLabel: 'Open', actionItemId: a.id,
  });
  const isSoonAction = (a: TodayActionItem) => {
    const t = dueInstant(a.dueAt);
    if (!Number.isFinite(t)) return a.priority === 'high';
    return Number.isFinite(t) && t - now <= HOURS_36;
  };
  const actionsSorted = sortActionItems(d.actionItems);
  const actionsOpen = actionsSorted.filter((a) => a.priority !== 'low');
  const actionsLow = actionsSorted.filter((a) => a.priority === 'low');
  const soonActions = actionsOpen.filter(isSoonAction).map(toActionItem);
  const laterActions = actionsOpen.filter((a) => !isSoonAction(a)).map(toActionItem);
  const lowActions = actionsLow.map(toActionItem);

  const drafts = [...d.draftsReady]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((x): TodayItem => ({
      key: 'dr-' + x.applicationId, kind: 'draft', action: 'Review your cover letter',
      title: x.company, subtitle: x.role, when: '', applicationId: x.applicationId,
    }));
  const quiet = [...d.goingQuiet]
    .sort((a, b) => b.daysQuiet - a.daysQuiet)
    .map((x): TodayItem => ({
      key: 'q-' + x.applicationId, kind: 'quiet', action: 'Follow up or let it go',
      title: x.company, subtitle: x.role, when: `${x.daysQuiet} days quiet`, applicationId: x.applicationId,
    }));
  return [
    ...soonInterviews, ...soonAssessments, ...soonActions,
    ...laterInterviews, ...laterAssessments, ...laterActions,
    ...drafts, ...quiet, ...lowActions,
  ];
}

/** "3 things need you" / "1 thing needs you". */
export function todayHeadline(count: number): string {
  if (count === 0) return 'All caught up.';
  return count === 1 ? '1 thing needs you' : `${count} things need you`;
}

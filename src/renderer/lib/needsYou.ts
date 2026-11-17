import { CALENDAR_ZONE } from '../../shared/calendar';
// The dashboard's "Needs you" numbers, pure so they can be tested: what is
// waiting on them, counted once per application, from the applications list and
// the open action items (the same live set Today shows).
import { ASSESSMENT_TODO_STAGES, type TodayActionItem } from '../../shared/types';
import { dueInstant } from './today';
import { displayLocale } from '../../shared/locale';

/**
 * Stages that mean an assessment is waiting on them: 'assessment', its legacy
 * alias 'take_home', and the older 'oa'. "assessed" is done, so it is not one.
 */
export const ASSESSMENT_STAGES: readonly string[] = [...ASSESSMENT_TODO_STAGES, 'oa'];
export const DEADLINE_WINDOW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export interface NeedsYouApp {
  id: string;
  company: string;
  job_title?: string | null;
  current_stage: string;
  interview_at?: string | null;
  application_deadline?: string | null;
}

/** One thing to do: an application, an action item, or both merged (same application). */
export interface NeedEntry {
  /** application id, or `item:<id>` for an item with no application. */
  key: string;
  applicationId: string | null;
  /** Company when known, else the item's title. */
  label: string;
  /** Soonest due instant across what merged into it; NaN when nothing is dated. */
  due: number;
}

export interface UpcomingInterview { applicationId: string; company: string; role: string; at: number }

export interface NeedsYou {
  interviews: number;
  assessments: NeedEntry[];
  deadlines: NeedEntry[];
  /** Future interviews, soonest first. */
  upcoming: UpcomingInterview[];
}

const add = (map: Map<string, NeedEntry>, e: NeedEntry) => {
  const had = map.get(e.key);
  if (!had) { map.set(e.key, e); return; }
  // Keep the soonest due date, and the more specific label (a company beats nothing).
  if (Number.isFinite(e.due) && (!Number.isFinite(had.due) || e.due < had.due)) had.due = e.due;
};

const itemEntry = (i: TodayActionItem, due: number): NeedEntry => ({
  key: i.applicationId ?? `item:${i.id}`,
  applicationId: i.applicationId,
  label: (i.company && i.company.trim()) || i.title,
  due,
});

/** Soonest dated first, undated last; ties keep insertion order. */
const bySoonest = (a: NeedEntry, b: NeedEntry) => {
  const at = Number.isFinite(a.due) ? a.due : Infinity;
  const bt = Number.isFinite(b.due) ? b.due : Infinity;
  return at === bt ? 0 : at < bt ? -1 : 1;
};

export function computeNeedsYou(apps: NeedsYouApp[], items: TodayActionItem[], now: number = Date.now()): NeedsYou {
  const until = now + DEADLINE_WINDOW_DAYS * DAY;
  const inWindow = (t: number) => Number.isFinite(t) && t >= now && t <= until;

  // Assessments: every application on an assessment stage, plus every open
  // assessment item, once per application. Overdue ones still count: still to do.
  const assessments = new Map<string, NeedEntry>();
  for (const a of apps) {
    if (!ASSESSMENT_STAGES.includes(a.current_stage)) continue;
    add(assessments, { key: a.id, applicationId: a.id, label: a.company, due: dueInstant(a.application_deadline) });
  }
  for (const i of items) {
    if (i.kind === 'assessment') add(assessments, itemEntry(i, dueInstant(i.dueAt)));
  }

  // Deadlines in the coming week: application deadlines plus any open item's due date.
  const deadlines = new Map<string, NeedEntry>();
  for (const a of apps) {
    const t = dueInstant(a.application_deadline);
    if (inWindow(t)) add(deadlines, { key: a.id, applicationId: a.id, label: a.company, due: t });
  }
  for (const i of items) {
    const t = dueInstant(i.dueAt);
    if (inWindow(t)) add(deadlines, itemEntry(i, t));
  }

  const upcoming = apps
    .map((a) => ({ a, t: a.interview_at ? new Date(a.interview_at).getTime() : NaN }))
    .filter(({ t }) => Number.isFinite(t) && t > now)
    .sort((x, y) => x.t - y.t)
    .map(({ a, t }) => ({ applicationId: a.id, company: a.company, role: a.job_title || '', at: t }));

  return {
    interviews: apps.filter((a) => a.current_stage === 'interview').length,
    assessments: Array.from(assessments.values()).sort(bySoonest),
    deadlines: Array.from(deadlines.values()).sort(bySoonest),
    upcoming,
  };
}

/** Short configured-zone label, including a date for events more than a week away. */
export function shortWhen(t: number, now: number = Date.now(), tz = CALENDAR_ZONE): string {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const time = d.toLocaleTimeString(displayLocale(), { timeZone: tz, hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const near = t - now < 6 * DAY;
  const day = d.toLocaleDateString(displayLocale(), near
    ? { timeZone: tz, weekday: 'short' }
    : { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  return `${day} ${time}`;
}

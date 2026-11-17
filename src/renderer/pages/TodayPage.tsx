import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Link as LinkIcon, ArrowRight } from 'lucide-react';
import type { TodayData, TodayActionItem } from '../../shared/types';
import type { CockpitData } from '../../shared/cockpit';
import { approvalKind, approvalSnapshot, type Approval, type ApprovalDecision } from '../../shared/approvals';
import { CALENDAR_ZONE, compactTitle, dateKey, isTodo, type CalendarEvent } from '../../shared/calendar';
import { InboxBanner } from '../components/InboxBanner';
import { ApprovalEditor } from '../components/ApprovalEditor';
import { Toast, useToast } from '../components/Toast';
import { useCalendarEvents, onDay } from '../hooks/useCalendarEvents';
import { useEmailSync } from '../hooks/useEmailSync';
import { usePrepFinished } from '../hooks/usePrepStatus';
import { todayItems, dueInstant, type TodayItem } from '../lib/today';
import { displayLocale, shortClock } from '../../shared/locale';

const todayApi = () => window.electronAPI?.today;

interface Props {
  cockpit: CockpitData | null;
  reloadCockpit: () => Promise<void> | void;
  /** Open one application; `focus: 'letter'` scrolls it to the cover letter. */
  onOpenApplication: (id: string, focus?: 'letter') => void;
  onOpenApplications: () => void;
  onOpenSettings: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
}

const EVENT_COLOR: Record<CalendarEvent['category'], string> = {
  interview: 'var(--red)', deadline: 'var(--orange)', shift: '#4f9a6c', outreach: 'var(--purple)', google: 'var(--faint)', class: 'var(--faint)',
};

const ACTION_KIND: Record<string, [string, string]> = {
  assessment: ['Assessment', 'ass'], quiz: ['Assessment', 'ass'], 'take-home': ['Assessment', 'ass'], take_home: ['Assessment', 'ass'],
  interview: ['Interview', 'int'], reply: ['Reply', 'you'], apply: ['Apply', 'you'], verify: ['Verify', 'you'],
  review: ['Review', 'Outreach'], practice: ['Practice', ''], application_task: ['Only you', 'you'],
};

const isPractice = (a?: TodayActionItem) => !!a && (a.kind === 'practice' || /interview practice/i.test(a.title));

const clock = (iso: string) => shortClock(iso, { timeZone: CALENDAR_ZONE });

const APPROVAL_KIND: Record<Approval['kind'], [string, string]> = {
  reply: ['Job reply', 'you'], outreach_email: ['Outreach', 'outreach'], outreach_followup: ['Outreach follow-up', 'outreach'], platform_bid: ['Bid', 'outreach'],
};

/** The landing page: today's events, what needs them, the drafts to approve, nothing else. */
export const TodayPage: React.FC<Props> = ({ cockpit, reloadCockpit, onOpenApplication, onOpenApplications, onOpenSettings, onOpenEvent }) => {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Approval | null>(null);
  const [doneHere, setDoneHere] = useState<Set<string>>(new Set());
  const prepFinished = usePrepFinished();
  const { status } = useEmailSync();
  const toast = useToast();

  const load = useCallback(async () => {
    const api = todayApi();
    if (!api) { setData({ draftsReady: [], interviewsSoon: [], assessmentsDue: [], actionItems: [], goingQuiet: [] }); return; }
    try {
      const res = await api.get();
      if (!res.ok || !res.data) throw new Error(res.error || 'Could not load today.');
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load, prepFinished, status?.phase]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    const off = window.electronAPI.cockpit.onChanged(() => { void load(); });
    return () => { window.removeEventListener('focus', onFocus); off(); };
  }, [load]);

  const today = dateKey();
  const days = useMemo(() => [today], [today]);
  const { events } = useCalendarEvents(cockpit?.events ?? [], days);
  const dayKeyOf = (iso: string) => dateKey(new Date(iso));
  // The strip is what happens at a set time today; to-dos are the list below it.
  const todaysEvents = events.filter((e) => !isTodo(e) && onDay(e, today, dayKeyOf))
    .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));

  const actionsById = useMemo(() => new Map((cockpit?.actions ?? []).concat(data?.actionItems ?? []).map((a) => [a.id, a])), [cockpit, data]);
  const items = data ? todayItems(data) : [];
  const practice = items.filter((it) => it.actionItemId && isPractice(actionsById.get(it.actionItemId)));
  // A task due within three hours of that application's interview is the same meeting, recorded twice.
  const sameMeeting = (it: TodayItem) => {
    if (it.kind !== 'action' || !it.applicationId) return false;
    const due = dueInstant(actionsById.get(it.actionItemId!)?.dueAt ?? null);
    const iv = data?.interviewsSoon.find((i) => i.applicationId === it.applicationId);
    return !!iv && Number.isFinite(due) && Math.abs(new Date(iv.interviewAt).getTime() - due) <= 3 * 3_600_000;
  };
  const main = items.filter((it) => (it.kind === 'interview' || it.kind === 'assessment' || it.kind === 'action') && !practice.includes(it) && !sameMeeting(it));
  const letters = items.filter((it) => it.kind === 'draft');
  const quiet = items.filter((it) => it.kind === 'quiet');
  const approvals = cockpit?.approvals ?? [];
  const companyOf = (id: string | null) => (id ? cockpit?.applications.find((a) => a.id === id)?.company ?? '' : '');

  // Split the list the way Things does: what is due now, what is dated later, and anytime.
  const endOfToday = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  const dueOf = (it: TodayItem): number => {
    if (it.kind === 'interview') return data?.interviewsSoon.find((i) => i.applicationId === it.applicationId) ? new Date(data!.interviewsSoon.find((i) => i.applicationId === it.applicationId)!.interviewAt).getTime() : NaN;
    if (it.kind === 'assessment') return dueInstant(data?.assessmentsDue.find((a) => a.applicationId === it.applicationId)?.dueAt ?? null);
    return dueInstant(it.actionItemId ? actionsById.get(it.actionItemId)?.dueAt ?? null : null);
  };
  const nowItems = main.filter((it) => { const t = dueOf(it); return Number.isFinite(t) && t <= endOfToday + (it.kind === 'interview' ? 36 * 3_600_000 : 0); });
  const laterItems = main.filter((it) => !nowItems.includes(it) && Number.isFinite(dueOf(it)));
  const anytimeItems = main.filter((it) => !nowItems.includes(it) && !laterItems.includes(it));
  const [showAll, setShowAll] = useState(false);
  const ANYTIME_CAP = 8;

  const left = main.length + practice.length + approvals.length + letters.length;
  const done = (cockpit?.doneToday ?? 0);

  const markDone = async (id: string) => {
    setDoneHere((s) => new Set(s).add(id));
    try {
      const res = await todayApi()?.markActionItemDone(id);
      if (res && !res.ok) throw new Error(res.error || 'Could not mark that done.');
      toast.show('Done. It drops off Today.');
      await Promise.all([load(), reloadCockpit()]);
    } catch (e) {
      setDoneHere((s) => { const n = new Set(s); n.delete(id); return n; });
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const decide = async (draft: Approval, decision: ApprovalDecision) => {
    const result = await window.electronAPI.approvals.decide(draft.id, { ...decision, expected: approvalSnapshot(draft) });
    if (!result.ok) throw new Error(result.error || 'Could not save decision.');
    await reloadCockpit();
  };
  const decideRow = async (draft: Approval, status: 'approved' | 'skipped') => {
    setBusy(draft.id);
    try {
      await decide(draft, { status });
      toast.show(status === 'approved' ? 'Approved. Your agent sends it on its next run.' : 'Skipped. It stays in the history.');
      const next = approvals.find((a) => a.id !== draft.id);
      setOpen(next ? `ap-${next.id}` : null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const approveAll = async () => {
    setBusy('all');
    try {
      const result = await window.electronAPI.approvals.approveAll(approvals.map((d) => ({ id: d.id, expected: approvalSnapshot(d) })));
      if (!result.ok) throw new Error(result.error);
      toast.show(`${approvals.length} drafts approved. Your agent sends them on its next run.`);
      await reloadCockpit();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const toggle = (key: string) => setOpen((k) => (k === key ? null : key));
  const dateLine = new Date().toLocaleDateString(displayLocale(), { weekday: 'long', day: 'numeric', month: 'long' });

  const renderItem = (it: TodayItem) => {
    const action = it.actionItemId ? actionsById.get(it.actionItemId) : undefined;
    const key = it.key;
    const isOpen = open === key;
    const checked = !!it.actionItemId && doneHere.has(it.actionItemId);
    const due = it.kind === 'action' ? action?.dueAt : null;
    const overdue = Number.isFinite(dueInstant(due ?? null)) && dueInstant(due ?? null) < Date.now();
    const [pill, pillCls] = it.kind === 'interview' ? ['Interview', 'int'] : it.kind === 'assessment' ? ['Assessment', 'ass']
      : it.kind === 'draft' ? ['Letter ready', 'you'] : it.kind === 'quiet' ? ['Quiet', ''] : (ACTION_KIND[action?.kind ?? ''] ?? ['Only you', 'you']);
    const title = it.kind === 'interview' ? `${it.title} interview`
      : it.kind === 'assessment' ? `${it.action.replace('your', 'the')} for ${it.title}`
      : it.kind === 'draft' ? `Read the ${it.title} cover letter`
      : it.kind === 'quiet' ? `Follow up ${it.title}, or let it go`
      : it.action;
    const project = it.kind === 'action' ? (action?.company ?? action?.groupLabel ?? '') : it.title;
    const flag = overdue ? 'Overdue' : it.when.replace(/^Due /, '');
    const flagHot = overdue || /^Today/.test(flag) || it.kind === 'interview';
    const detail = action?.detail || (it.subtitle && it.kind !== 'action' ? it.subtitle : '');
    return (
      <div key={key} className={`todo ${isOpen ? 'open' : ''} ${checked ? 'done' : ''}`}>
        <div className="todo-row">
          {it.actionItemId ? (
            <button className="todo-box" aria-label={`Mark done: ${title}`} disabled={checked} onClick={() => void markDone(it.actionItemId!)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </button>
          ) : (
            <span className={`todo-glyph g-${it.kind}`} aria-hidden="true" />
          )}
          <button className="todo-main" onClick={() => toggle(key)} aria-expanded={isOpen}>
            <span className="todo-title">{title}</span>
            <span className="todo-meta">
              {detail && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" role="img" aria-label="Has notes"><path d="M5 6h14 M5 11h14 M5 16h9" /></svg>}
              <span className={`pill ${pillCls}`}>{pill}</span>
              {flag && <span className={`flag ${flagHot ? '' : 'soft'}`}>{flag}</span>}
            </span>
          </button>
          {project && <span className="todo-proj">{project}</span>}
        </div>
        {isOpen && (
          <div className="todo-expand">
            {detail && <p className="todo-notes">{detail}</p>}
            {it.kind !== 'action' && it.subtitle && detail !== it.subtitle && <p className="todo-notes">{it.subtitle}</p>}
            <div className="todo-foot">
              {it.emailUrl && <a className="btn" href={it.emailUrl} target="_blank" rel="noreferrer"><Mail size={13} /> Open email</a>}
              {it.jobUrl && <a className="btn" href={it.jobUrl} target="_blank" rel="noreferrer"><LinkIcon size={13} /> {it.jobUrlLabel ?? 'Job listing'}</a>}
              <span className="spacer" />
              {it.applicationId && (
                <button className="btn" onClick={() => onOpenApplication(it.applicationId!, it.kind === 'draft' ? 'letter' : undefined)}>
                  Open {it.kind === 'action' ? (action?.company ?? 'application') : it.title} <ArrowRight size={13} />
                </button>
              )}
              {it.actionItemId && <button className="btn btn-primary" disabled={checked} onClick={() => void markDone(it.actionItemId!)}>Mark done</button>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderApproval = (draft: Approval) => {
    const key = `ap-${draft.id}`;
    const isOpen = open === key;
    const [pill, pillCls] = APPROVAL_KIND[approvalKind(draft.kind) as Approval['kind']] ?? [draft.kind.replace(/_/g, ' '), ''];
    const title = draft.subject || draft.to_address || pill;
    return (
      <div key={key} className={`todo ${isOpen ? 'open' : ''}`}>
        <div className="todo-row">
          <span className="todo-glyph g-draft" aria-hidden="true" />
          <button className="todo-main" onClick={() => toggle(key)} aria-expanded={isOpen}>
            <span className="todo-title">{title}</span>
            <span className="todo-meta"><span className={`pill ${pillCls}`}>{pill}</span><span>{draft.channel}{draft.to_address ? `, to ${draft.to_address}` : ''}</span></span>
          </button>
          <span className="todo-proj">{companyOf(draft.application_id)}</span>
        </div>
        {isOpen && (
          <div className="todo-expand">
            <dl className="draft-meta">
              <dt>To</dt><dd>{draft.to_address || 'Set by the agent'}</dd>
              <dt>From</dt><dd>{draft.from_account || 'Set by the agent'}</dd>
              {draft.subject && <><dt>Subject</dt><dd>{draft.subject}</dd></>}
            </dl>
            <p className="draft-body">{draft.body}</p>
            <div className="todo-foot">
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void decideRow(draft, 'approved')}>Approve</button>
              <button className="btn" disabled={!!busy} onClick={() => setEditing(draft)}>Edit</button>
              <button className="btn btn-quiet" disabled={!!busy} onClick={() => void decideRow(draft, 'skipped')}>Skip</button>
              <span className="spacer" />
              <span className="todo-hint">Aplyd never sends. Your agent sends approved drafts.</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const heading = (label: string, count: number, action?: React.ReactNode, cls = '') => (
    <div className={`list-heading ${cls}`}>{label}<span className="n">{count}</span><span className="spacer" />{action}</div>
  );

  return (
    <div className="page">
      <div className="page-title">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.75 5.6l6.15.9l-4.45 4.33l1.05 6.12L12 16.87l-5.5 2.88l1.05-6.12L3.1 9.3l6.15-.9z" fill="var(--star)" /></svg>
        <h1>Today</h1>
      </div>
      <p className="page-lede">
        {dateLine}. {data && cockpit ? (left === 0 ? 'All caught up.' : [
          `${nowItems.length} due today`,
          approvals.length ? `${approvals.length} draft${approvals.length > 1 ? 's' : ''} to approve` : '',
          `${laterItems.length + anytimeItems.length + letters.length + practice.length + quiet.length} more on your list`,
        ].filter(Boolean).join(', ') + (done ? `. ${done} done today.` : '.')) : ''}
      </p>

      <div className="page-indent"><InboxBanner onOpenApplications={onOpenApplications} onOpenSettings={onOpenSettings} /></div>
      {error && <p role="alert" className="page-error">{error}</p>}

      {todaysEvents.length > 0 && (
        <div className="events-strip">
          {todaysEvents.map((e) => (
            <button key={e.id} className="evt" onClick={() => onOpenEvent(e)} title={e.title}>
              <i style={{ background: EVENT_COLOR[e.category] }} />
              <time>{e.allDay ? 'All day' : clock(e.start)}</time>
              <b>{compactTitle(e.title)}</b>
              <span>{e.category === 'google' ? 'Google Calendar' : e.category === 'class' ? 'Every week' : ''}</span>
            </button>
          ))}
        </div>
      )}

      {!data && !error && <p className="page-empty">Loading your day…</p>}

      {nowItems.map(renderItem)}
      {data && nowItems.length === 0 && <p className="page-empty">Nothing is due today.</p>}

      {approvals.length > 0 && <>
        {heading('Drafts to approve', approvals.length, <button className="list-heading-act" disabled={!!busy} onClick={() => void approveAll()}>Approve all</button>)}
        {approvals.map(renderApproval)}
      </>}

      {laterItems.length > 0 && <>{heading('Coming up', laterItems.length, undefined, 'plain')}{laterItems.map(renderItem)}</>}
      {anytimeItems.length > 0 && <>
        {heading('Anytime', anytimeItems.length, undefined, 'plain')}
        {(showAll ? anytimeItems : anytimeItems.slice(0, ANYTIME_CAP)).map(renderItem)}
        {anytimeItems.length > ANYTIME_CAP && <button className="more-link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show ${anytimeItems.length - ANYTIME_CAP} more`}</button>}
      </>}

      {letters.length > 0 && <>{heading('Cover letters to read', letters.length)}{letters.map(renderItem)}</>}
      {practice.length > 0 && <>{heading('Practice', practice.length, undefined, 'plain')}{practice.map(renderItem)}</>}
      {quiet.length > 0 && <>{heading('Going quiet', quiet.length, undefined, 'plain')}{quiet.map(renderItem)}</>}

      {cockpit && (
        <div className="today-foot">
          <div><b>{cockpit.yesterday.applied}</b><span>applied yesterday</span></div>
          <div><b>{cockpit.yesterday.jobReplies}</b><span>job replies</span></div>
          <div><b>{cockpit.yesterday.outreachSent}</b><span>Outreach sent</span></div>
          <div><b>{cockpit.yesterday.outreachReplies}</b><span>Outreach replies</span></div>
          {cockpit.lastRun && (
            <p className="today-run">
              Last agent run: <strong>{cockpit.lastRun.agent}</strong>, {new Date(cockpit.lastRun.started_at).toLocaleString(displayLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
              {cockpit.lastRun.summary ? ` ${cockpit.lastRun.summary}` : ' Still running.'}
            </p>
          )}
        </div>
      )}

      {editing && <ApprovalEditor draft={editing} onSave={(decision) => decide(editing, decision)} onClose={() => setEditing(null)} />}
      <Toast state={toast} />
    </div>
  );
};

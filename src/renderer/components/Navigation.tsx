import React from 'react';
import type { CockpitData } from '../../shared/cockpit';
import { dateKey, addDays, groupOutreachFollowUps } from '../../shared/calendar';
import { Pie, stagePie, stageColor } from './Pie';
import { dueInstant } from '../lib/today';
import { displayLocale } from '../../shared/locale';

export type Page = 'home' | 'upcoming' | 'calendar' | 'outreach' | 'stats' | 'today' | 'dashboard' | 'list' | 'detail' | 'settings';

interface NavigationProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  collapsed?: boolean;
  cockpit: CockpitData | null;
  /** The application open on the detail page, so its project row shows selected. */
  selectedApplicationId?: string | null;
  /** The list is showing the waiting pile (applied, not quiet). */
  waitingActive?: boolean;
  onOpenApplication: (id: string) => void;
  onOpenWaiting: () => void;
  onAdd: () => void;
}

/** Applications that are moving: they show as projects under Jobs. */
const SIDE_CAP = 8;
const IN_PLAY = ['offer', 'interview', 'phone_screen', 'assessment', 'take_home', 'oa', 'assessed'];
const PLAY_ORDER: Record<string, number> = { offer: 0, interview: 1, phone_screen: 1, assessment: 2, take_home: 2, oa: 2, assessed: 3 };

const Icon: React.FC<{ d: string; fill: string; stroke: string }> = ({ d, fill, stroke }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d={d} fill={fill} stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Cube: React.FC<{ color: string }> = ({ color }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" fill={color} />
    <path d="M3.5 7.25L12 12l8.5-4.75 M12 12v9.5" fill="none" stroke="#fff" strokeWidth={1.4} />
  </svg>
);

const STAR = 'M12 2.8l2.75 5.6l6.15.9l-4.45 4.33l1.05 6.12L12 16.87l-5.5 2.88l1.05-6.12L3.1 9.3l6.15-.9z';
const CAL = 'M4 6h16v14H4z M8 3v4 M16 3v4 M4 10h16';
const GRID = 'M4 5h16v15H4z M4 10h16 M8 14h2 M12 14h2 M16 14h2 M8 17h2 M12 17h2';
const LAYERS = 'M12 3l9 5l-9 5l-9-5z M3 13l9 5l9-5';
const BOOK = 'M5 3h14v18H5z M8.5 12.5l2.5 2.5l4.5-5';

export const Navigation: React.FC<NavigationProps> = ({
  currentPage, onNavigate, collapsed, cockpit, selectedApplicationId, waitingActive, onOpenApplication, onOpenWaiting, onAdd,
}) => {
  // The in-play list grows with the search: it folds away, and shows the first few until asked for more.
  const [foldJobs, setFoldJobs] = React.useState(() => { try { return localStorage.getItem('aplyd.sideJobsFolded') === '1'; } catch { return false; } });
  const [showAllJobs, setShowAllJobs] = React.useState(false);
  const toggleFold = () => setFoldJobs((v) => { const n = !v; try { localStorage.setItem('aplyd.sideJobsFolded', n ? '1' : '0'); } catch { /* fine */ } return n; });
  if (collapsed) return null;
  const apps = cockpit?.applications ?? [];
  // Today's badge counts what is due today (or overdue), today's interviews, and drafts to approve.
  const endOfToday = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  const todayCount = cockpit ? cockpit.approvals.length
    + cockpit.actions.filter((a) => { const t = dueInstant(a.dueAt); return Number.isFinite(t) && t <= endOfToday; }).length
    + cockpit.events.filter((e) => e.category === 'interview' && !e.allDay && dateKey(new Date(e.start)) === dateKey()).length : null;
  const today = dateKey();
  const weekOut = addDays(today, 7);
  const upcomingCount = cockpit ? groupOutreachFollowUps(cockpit.events).filter((e) => {
    const d = e.allDay ? e.start : dateKey(new Date(e.start));
    return d >= today && d < weekOut;
  }).length : null;
  const projects = apps
    .filter((a) => IN_PLAY.includes(a.current_stage))
    .sort((a, b) => (PLAY_ORDER[a.current_stage] ?? 9) - (PLAY_ORDER[b.current_stage] ?? 9) || a.company.localeCompare(b.company));

  const seen = new Map<string, number>();
  for (const p of projects) seen.set(p.company, (seen.get(p.company) ?? 0) + 1);
  const dupes = new Set([...seen].filter(([, n]) => n > 1).map(([c]) => c));

  const item = (page: Page, label: string, icon: React.ReactNode, count?: number | null, extra?: { on?: boolean; due?: boolean; onClick?: () => void }) => (
    <button
      className={`side-item ${extra?.on ?? currentPage === page ? 'on' : ''}`}
      onClick={extra?.onClick ?? (() => onNavigate(page))}
      aria-current={(extra?.on ?? currentPage === page) ? 'page' : undefined}
    >
      {icon}<span className="side-label">{label}</span>
      {count != null && count > 0 && <span className={`side-count ${extra?.due ? 'due' : ''}`}>{count.toLocaleString(displayLocale())}</span>}
    </button>
  );

  const onToday = currentPage === 'home' || currentPage === 'today';
  const onJobs = (currentPage === 'list' && !waitingActive);

  return (
    <aside className="side" aria-label="Lists">
      <div className="side-drag" />
      {item('home', 'Today', <Icon d={STAR} fill="var(--star)" stroke="var(--star)" />, todayCount, { on: onToday })}
      {item('upcoming', 'Upcoming', <Icon d={CAL} fill="#fff" stroke="var(--red)" />, upcomingCount, { due: true })}
      {item('calendar', 'Calendar', <Icon d={GRID} fill="var(--red-tint)" stroke="var(--red)" />)}
      {item('list', 'Waiting', <Icon d={LAYERS} fill="#d6f2ee" stroke="var(--teal)" />, null, { on: currentPage === 'list' && !!waitingActive, onClick: onOpenWaiting })}
      {item('stats', 'Stats', <Icon d={BOOK} fill="var(--green-tint)" stroke="var(--green)" />, null, { on: currentPage === 'stats' || currentPage === 'dashboard' })}

      <div className="side-gap" />
      <div className="side-area-row">
        <button className={`side-area ${onJobs ? 'on' : ''}`} onClick={() => onNavigate('list')}><Cube color="var(--accent)" />Jobs<span className="side-count">{foldJobs ? `${projects.length} moving` : apps.length ? apps.length.toLocaleString(displayLocale()) : ''}</span></button>
        <button className="side-fold" onClick={toggleFold} aria-expanded={!foldJobs} aria-label={foldJobs ? 'Show jobs in play' : 'Hide jobs in play'} title={foldJobs ? 'Show jobs in play' : 'Hide jobs in play'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: foldJobs ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6l6-6" /></svg>
        </button>
      </div>
      {!foldJobs && <div className="side-projects">
        {(showAllJobs ? projects : projects.slice(0, SIDE_CAP)).map((p) => (
          <button
            key={p.id}
            className={`side-proj ${currentPage === 'detail' && selectedApplicationId === p.id ? 'on' : ''}`}
            onClick={() => onOpenApplication(p.id)}
            title={`${p.company}, ${p.job_title}`}
          >
            <Pie value={stagePie(p.current_stage)} color={stageColor(p.current_stage)} size={16} />
            <span className="side-label">{p.company}{dupes.has(p.company) && <span className="side-sub"> {p.job_title}</span>}</span>
          </button>
        ))}
        {projects.length > SIDE_CAP && (
          <button className="side-more" onClick={() => setShowAllJobs((v) => !v)}>
            {showAllJobs ? 'Show fewer' : `Show ${projects.length - SIDE_CAP} more`}
          </button>
        )}
        {cockpit && projects.length === 0 && <p className="side-empty">Nothing moving yet.</p>}
      </div>}

      <div className="side-gap" />
      <button className={`side-area ${currentPage === 'outreach' ? 'on' : ''}`} onClick={() => onNavigate('outreach')}><Cube color="var(--purple)" />Outreach</button>

      <div className="side-foot">
        <button className="side-new" onClick={onAdd}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14 M5 12h14" /></svg>
          New job
        </button>
        <button className={`side-settings ${currentPage === 'settings' ? 'on' : ''}`} aria-label="Settings" title="Settings" onClick={() => onNavigate('settings')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M4 7h10 M18 7h2 M4 17h4 M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
        </button>
      </div>
    </aside>
  );
};

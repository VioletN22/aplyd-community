import { useCalendarPreferences } from './hooks/useCalendarPreferences';
import {StatsPage} from './pages/StatsPage';
import {LeadsPage} from './pages/LeadsPage';
import React, { useState, useEffect, Suspense } from 'react';
import { Navigation, Page } from './components/Navigation';
import { DashboardPage } from './pages/DashboardPage';
import { ListPage } from './pages/ListPage';
import type { Filters } from './components/FilterBar';
import { DetailPage } from './pages/DetailPage';
import { TodayPage } from './pages/TodayPage';
import { UpcomingPage } from './pages/UpcomingPage';
import { CalendarPage } from './pages/CalendarPage';
import { PrepProvider } from './hooks/usePrepStatus';
import { announceApplicationsChanged } from './hooks/useApplications';
import { useCockpit } from './hooks/useCockpit';
import { quickAddApi } from './lib/quickAdd';
import type { CalendarEvent } from '../shared/calendar';
import { readSetupProgress, reopenSetup, SETUP_KEY, type SettingsSection, type SetupProgress } from './lib/setupProgress';

// Load setup and settings only when they are opened. Returning users go straight
// to their workspace.
const SettingsPage = React.lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

const SetupWizard = React.lazy(() => import('./components/SetupWizard'));

/** The list filter the sidebar's Waiting row opens. */
export const WAITING_FILTER: Filters = { stages: ['applied'], drillDown: 'Waiting to hear back', fromView: true };

const App: React.FC = () => {
  useCalendarPreferences();
  const [setup, setSetup] = useState<SetupProgress>(() => {
    const stored = localStorage.getItem(SETUP_KEY);
    const progress = readSetupProgress(stored);
    // Existing users can open the guide from Settings without losing their workspace.
    if (!stored && localStorage.getItem('community-welcome-dismissed') === '1') progress.paused = true;
    return progress;
  });
  const [showSetup, setShowSetup] = useState(() => !setup.paused && !setup.finished);
  const [settingsTarget, setSettingsTarget] = useState<{ section?: SettingsSection; request: number }>({ request: 0 });
  const saveSetup = (next: SetupProgress) => { setSetup(next); localStorage.setItem(SETUP_KEY, JSON.stringify(next)); };
  const openSetup = () => { saveSetup(reopenSetup(setup)); setShowSetup(true); };
  const pauseSetup = () => { saveSetup({ ...setup, paused: true }); setShowSetup(false); };

  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [selectedLeadId,setSelectedLeadId]=useState<string|null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  // Where Back goes from an application, and what to scroll to on arrival.
  const [returnPage, setReturnPage] = useState<Page>('list');
  const [detailFocus, setDetailFocus] = useState<'letter' | undefined>(undefined);
  // collapsible sidebar (more room for the workspace), persisted
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => localStorage.getItem('navCollapsed') === '1');
  const toggleNav = () => setNavCollapsed((v) => { const n = !v; localStorage.setItem('navCollapsed', n ? '1' : '0'); return n; });
  // Cmd+N arrives from the application menu. The add modal belongs to ListPage,
  // so the shortcut lands us there and bumps a counter the page watches: every
  // press opens the modal, including a second press while the list is already up.
  const [openAddRequest, setOpenAddRequest] = useState(0);
  // What the list opens filtered to. Bumping the request number makes a
  // mounted list reset to it too; plain navigation clears it.
  // `from` is the page that sent them there, which gets a Back control on the list.
  const [listFilter, setListFilter] = useState<{ filters?: Filters; request: number; from?: Page }>({ request: 0 });
  const { data: cockpit, reload: reloadCockpit } = useCockpit();

  const openApplications = (filter?: Filters, from?: Page) => {
    setSelectedApplicationId(null);
    setListFilter((f) => ({ filters: filter, request: f.request + 1, from }));
    setCurrentPage('list');
  };
  const navigate = (page: Page) => {
    if (page === 'list') setListFilter((f) => (f.filters || f.from ? { filters: undefined, request: f.request + 1 } : f));
    if (page === 'settings') setSettingsTarget(value => ({ request: value.request + 1 }));
    setCurrentPage(page);
  };
  const openSettingsSection = (section: SettingsSection) => {
    setSettingsTarget(value => ({ section, request: value.request + 1 }));
    setCurrentPage('settings');
  };
  const openSettings = () => openSettingsSection('email');
  const openAdd = () => {
    setSelectedApplicationId(null);
    setListFilter((f) => (f.filters || f.from ? { filters: undefined, request: f.request + 1 } : f));
    setCurrentPage('list');
    setOpenAddRequest((n) => n + 1);
  };

  useEffect(() => {
    const off = window.electronAPI.nav?.onNew(openAdd);
    return () => { try { off && off(); } catch { /* already gone */ } };
  }, []);

  const openApplication = (id: string, from: Page, focus?: 'letter') => {
    setSelectedApplicationId(id);
    setReturnPage(from);
    setDetailFocus(focus);
    setCurrentPage('detail');
  };
  const handleSelectApplication = (id: string) => openApplication(id, 'list');
  const openLead = (id: string) => { setSelectedLeadId(id); navigate('outreach'); };
  /** A calendar event opens what it is about: an application, a lead, or Today for a task. */
  const openEvent = (from: Page) => (event: CalendarEvent) => {
    if (event.applicationId) openApplication(event.applicationId, from);
    else if (event.leadId) openLead(event.leadId);
    else if (event.id.startsWith('outreach-group:')) navigate('outreach');
    else if (event.actionItemId) navigate('home');
  };

  // Quick add from the global shortcut: the lists catch up every time, and an
  // add that asks to be opened lands on its page.
  useEffect(() => window.electronAPI.cockpit.onChanged(announceApplicationsChanged), []);

  useEffect(() => {
    const off = quickAddApi()?.onAdded(({ applicationId, open }) => {
      announceApplicationsChanged();
      void reloadCockpit();
      if (open && applicationId) openApplication(applicationId, 'list');
    });
    return () => { try { off && off(); } catch { /* already gone */ } };
  }, []);

  const handleBack = () => {
    setCurrentPage(returnPage);
    setSelectedApplicationId(null);
    setDetailFocus(undefined);
  };

  const waitingActive = currentPage === 'list' && listFilter.filters === WAITING_FILTER;

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
      case 'today':
        return (
          <TodayPage
            cockpit={cockpit}
            reloadCockpit={reloadCockpit}
            onOpenApplication={(id, focus) => openApplication(id, 'home', focus)}
            onOpenApplications={() => openApplications()}
            onOpenSettings={openSettings}
            onOpenEvent={openEvent('home')}
          />
        );
      case 'upcoming':
        return <UpcomingPage cockpit={cockpit} reloadCockpit={reloadCockpit} onOpenEvent={openEvent('upcoming')} onOpenCalendar={() => navigate('calendar')} />;
      case 'calendar':
        return <CalendarPage cockpit={cockpit} reloadCockpit={reloadCockpit} onOpenEvent={openEvent('calendar')} />;
      case 'outreach':
        return <LeadsPage initialLeadId={selectedLeadId} onClearSelection={()=>setSelectedLeadId(null)}/>;
      case 'stats':
        return <StatsPage onOpenApplications={filter=>openApplications(filter,'stats')} onOpenApplication={id=>openApplication(id,'stats')} onOpenSettings={openSettings}/>;
      case 'dashboard':
        return (
          <DashboardPage
            onOpenApplications={(filter) => openApplications(filter, 'dashboard')}
            onOpenApplication={(id) => openApplication(id, 'dashboard')}
            onOpenSettings={openSettings}
          />
        );
      case 'list':
        return (
          <ListPage
            onSelectApplication={handleSelectApplication}
            openAddRequest={openAddRequest}
            initialFilters={listFilter.filters}
            filtersRequest={listFilter.request}
            onBack={listFilter.from ? () => setCurrentPage(listFilter.from!) : undefined}
            backLabel="Back"
          />
        );
      case 'detail':
        return (
          <DetailPage
            applicationId={selectedApplicationId}
            onBack={handleBack}
            backLabel={returnPage === 'home' ? 'Today' : returnPage === 'list' ? 'Jobs' : returnPage === 'calendar' ? 'Calendar' : returnPage === 'upcoming' ? 'Upcoming' : 'Back'}
            focus={detailFocus}
          />
        );
      case 'settings':
        return (
          <Suspense fallback={<p style={{ padding: '56px 48px', fontSize: 'var(--fs-3)', color: 'var(--muted)' }}>Loading…</p>}>
            <SettingsPage onOpenSetup={openSetup} initialSection={settingsTarget.section} sectionRequest={settingsTarget.request} />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <PrepProvider>
    <div className="screen-main">
      {!showSetup && <Navigation
        currentPage={currentPage}
        onNavigate={navigate}
        collapsed={navCollapsed}
        cockpit={cockpit}
        selectedApplicationId={selectedApplicationId}
        waitingActive={waitingActive}
        onOpenApplication={(id) => openApplication(id, currentPage === 'detail' ? returnPage : currentPage)}
        onOpenWaiting={() => openApplications(WAITING_FILTER)}
        onAdd={openAdd}
      />}
      <div className="main-content">
        <div className="dragbar">
          {!showSetup && <button
            className="side-toggle"
            onClick={toggleNav}
            title={navCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-label="Toggle sidebar"
            style={navCollapsed ? { marginLeft: 76 } : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" />
            </svg>
          </button>}
        </div>
        <div className="content">
          {showSetup ? <Suspense fallback={<p style={{ padding: 32 }}>Opening setup…</p>}>
            <SetupWizard progress={setup} onChange={saveSetup} onPause={pauseSetup}
              onFinish={(addApplication) => {
                saveSetup({ ...setup, finished: true, paused: false });
                localStorage.setItem('community-welcome-dismissed', '1');
                setShowSetup(false);
                if (addApplication) openAdd(); else setCurrentPage('home');
              }}
              onOpenSettings={section => { pauseSetup(); openSettingsSection(section); }} />
          </Suspense> : renderPage()}
        </div>
      </div>
    </div>
    </PrepProvider>
  );
};

export default App;

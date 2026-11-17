import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FilterBar, Filters } from '../components/FilterBar';
import { ApplicationCard, ListDensity } from '../components/ApplicationCard';
import { AddApplicationModal } from '../modals/AddApplicationModal';
import { Dialog } from '../components/Dialog';
import { useApplications } from '../hooks/useApplications';
import { JobApplication, isQuiet } from '../../shared/types';
import { stageLabel, stageOptions } from '../lib/stages';
import { matchesLocationFilter } from '../../shared/location';
import { displayLocale } from '../../shared/locale';

const DENSITY_KEY = 'aplyd.listDensity';

/** Stages that mean the application is moving: the In play view. */
const IN_PLAY = ['assessment', 'take_home', 'oa', 'assessed', 'phone_screen', 'interview', 'offer'];

const readDensity = (): ListDensity => {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
};

interface ListPageProps {
  onSelectApplication: (id: string) => void;
  /** Bumped by App every time Cmd+N fires. Any change opens the add modal. */
  openAddRequest?: number;
  /** Filters to open on (from a dashboard card or stage row). */
  initialFilters?: Filters;
  /** Bumped by App with every new initialFilters request. */
  filtersRequest?: number;
  /** Set when another page (the dashboard) sent them here: shows a Back control at the top. */
  onBack?: () => void;
  backLabel?: string;
}

/** "Interview", "Assessment + Take-home", "No response": what a drill-down is showing. */
const drillDownLabel = (f?: Filters): string | null => {
  if (!f) return null;
  if (f.drillDown) return f.drillDown;
  if (f.noResponse) return 'No response';
  if (f.stages && f.stages.length > 0) return f.stages.map(stageLabel).join(' + ');
  if (f.stage) return stageLabel(f.stage);
  return null;
};

export const ListPage: React.FC<ListPageProps> = ({ onSelectApplication, openAddRequest = 0, initialFilters, filtersRequest = 0, onBack, backLabel = 'Back' }) => {
  const { applications, loading, refresh, patch } = useApplications();
  const [showAddModal, setShowAddModal] = useState(false);
  // Starts on the requested filters so the first paint is already narrowed.
  const [filters, setFilters] = useState<Filters>(() => initialFilters ?? {});
  // What the filter bar resets to: App's request (sidebar, dashboard) or a view tab here.
  const [bar, setBar] = useState<{ filters?: Filters; request: number }>({ filters: initialFilters, request: filtersRequest });
  useEffect(() => { setBar((b) => (b.request === filtersRequest && b.filters === initialFilters ? b : { filters: initialFilters, request: b.request + 1 })); }, [filtersRequest, initialFilters]);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);
  const [density, setDensity] = useState<ListDensity>(readDensity);

  // A batch add keeps running in the main process after the modal closes, so the
  // list itself watches for landed items and refreshes underneath.
  useEffect(() => {
    const off = window.electronAPI.apps.onBatchProgress((p) => { if (p.status === 'done') refresh(); });
    return () => { try { off(); } catch { /* already gone */ } };
  }, []);

  // Cmd+N from the application menu. Skips the initial 0 so a fresh list does
  // not open the modal on its own.
  useEffect(() => {
    if (openAddRequest > 0) setShowAddModal(true);
  }, [openAddRequest]);

  const changeDensity = useCallback((next: ListDensity) => {
    setDensity(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch { /* private mode, keep going */ }
  }, []);

  // The stages a given application can be set to: the fixed list (plus a legacy
  // current stage, so the badge can show it). Built once per list change and
  // handed to the rows as a stable array, which is what lets React.memo skip them.
  // Every stage actually in play right now, custom ones included, so a
  // picker offers "oa" (say) even on a row that isn't on it - and so the
  // filter dropdown below can offer the same list.
  const dataStages = useMemo(() => Array.from(new Set(applications.map((a) => a.current_stage))), [applications]);
  const stagesByApp = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const app of applications) map.set(app.id, stageOptions(app.current_stage, dataStages));
    return map;
  }, [applications, dataStages]);
  const allStageOptions = useMemo(() => stageOptions(undefined, dataStages), [dataStages]);

  // "No response" rows: hidden from the default list, counted on the chip.
  const noResponseIds = useMemo(
    () => new Set(applications.filter((a) => isQuiet(a)).map((a) => a.id)),
    [applications],
  );

  // Search text per application, joined once per list change instead of on every
  // keystroke: this was rebuilding 68 multi-KB strings per character typed.
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const app of applications) {
      map.set(
        app.id,
        [
          app.company,
          app.job_title,
          app.location,
          app.workplace_address,
          app.job_source,
          app.required_skills,
          app.nice_to_have_skills,
          app.key_responsibilities,
          app.notes,
          app.job_description,
          app.current_stage,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
      );
    }
    return map;
  }, [applications]);

  const handleChangeStage = useCallback(async (applicationId: string, stage: string) => {
    // Optimistic in-place update, keeps scroll position (no full reload).
    patch(applicationId, { current_stage: stage });
    try {
      const moved = await window.electronAPI.db.createStageHistory(applicationId, stage);
      const saved = moved.ok
        ? await window.electronAPI.db.updateApplication(applicationId, { current_stage: stage })
        : moved;
      if (!saved.ok) throw new Error(saved.error || 'Failed to update status');
    } catch (err) {
      await refresh(); // revert to server truth on failure
      setErrorDialog({
        title: 'Error Updating Status',
        message: err instanceof Error ? err.message : 'Failed to update status',
      });
    }
  }, []);

  // Filtering is done client-side (instant, fuzzy, multi-field), no DB round-trip
  // per keystroke. We keep the full list loaded and narrow it in `filteredApplications`.
  const handleFilterChange = useCallback((newFilters: Filters) => {
    setFilters(newFilters);
  }, []);

  const handleAddClick = useCallback(() => {
    setShowAddModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowAddModal(false);
  }, []);

  // A single add lands on its own page: that is where the letter, the assistant and
  // the posting live, and it is what the user wants to look at next.
  const handleCreated = useCallback((applicationId: string) => {
    setShowAddModal(false);
    refresh();
    onSelectApplication(applicationId);
  }, [onSelectApplication]);

  const handleDeleteApplication = useCallback(async (applicationId: string) => {
    try {
      const res = await window.electronAPI.db.deleteApplication(applicationId);
      if (!res.ok) throw new Error(res.error || 'Failed to delete application');
      await refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete application';
      setErrorDialog({
        title: 'Error Deleting Application',
        message: errorMessage,
      });
    }
  }, []);

  const handleSelect = useCallback((id: string) => onSelectApplication(id), [onSelectApplication]);

  // Filter applications based on current filters.
  // Search is multi-field + multi-keyword: every whitespace-separated term must appear
  // somewhere in the application (company, role, location, source, skills, notes…), so
  // you can find a job by the role, the company, or any keyword you remember.
  const filteredApplications = useMemo(() => {
    const terms = filters.search ? filters.search.toLowerCase().split(/\s+/).filter(Boolean) : [];
    return applications.filter((app: JobApplication) => {
      if (terms.length > 0) {
        const haystack = haystacks.get(app.id) ?? '';
        if (!terms.every((term) => haystack.includes(term))) return false;
      }
      // The chip shows only the silent pile. Otherwise it stays out of the way,
      // except under a search: a name the user types must always turn up.
      const silent = noResponseIds.has(app.id);
      // A hand-picked set (from the dashboard) shows its rows whether quiet or not.
      if (filters.ids) { if (!filters.ids.includes(app.id)) return false; }
      else if (filters.noResponse ? !silent : silent && terms.length === 0) return false;
      if (filters.stage && app.current_stage !== filters.stage) return false;
      if (filters.stages && !filters.stages.includes(app.current_stage)) return false;
      if (filters.city && !matchesLocationFilter(app.location, filters.city)) return false;
      if (filters.needsLetter && (app.has_letter || app.current_stage !== 'applied')) return false;
      return true;
    });
  }, [applications, filters, haystacks, noResponseIds]);

  // The view tabs: where in the funnel to look. Counts are over every application.
  const views = useMemo(() => {
    const inPlay = applications.filter((a) => IN_PLAY.includes(a.current_stage)).length;
    const waiting = applications.filter((a) => a.current_stage === 'applied' && !noResponseIds.has(a.id)).length;
    const closed = applications.filter((a) => a.current_stage === 'rejected' || a.current_stage === 'withdrawn').length;
    return [
      { key: 'play', label: 'In play', count: inPlay, filters: { stages: IN_PLAY, fromView: true } as Filters },
      { key: 'waiting', label: 'Waiting', count: waiting, filters: { stages: ['applied'], fromView: true } as Filters },
      { key: 'quiet', label: 'No response', count: noResponseIds.size, filters: { noResponse: true, fromView: true } as Filters },
      { key: 'closed', label: 'Closed', count: closed, filters: { stages: ['rejected', 'withdrawn'], fromView: true } as Filters },
      { key: 'all', label: 'Everything', count: applications.length - noResponseIds.size, filters: {} as Filters },
    ];
  }, [applications, noResponseIds]);
  const sameSet = (a?: string[], b?: string[]) => !!a && !!b && a.length === b.length && a.every((x) => b.includes(x));
  const activeView = filters.ids || filters.stage || filters.city || filters.needsLetter ? null
    : filters.noResponse ? 'quiet'
    : !filters.stages ? 'all'
    : views.find((v) => sameSet(v.filters.stages, filters.stages))?.key ?? null;
  const pickView = (f: Filters) => setBar((b) => ({ filters: f, request: b.request + 1 }));

  // The page itself adds no padding: `.content` in index.css already pads every
  // page, and the old Tailwind `p-8` was never compiled, so it never applied.
  return (
    <div className="page wide">
      {onBack && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              padding: '7px 12px',
              border: '1px solid var(--line)',
              backgroundColor: 'var(--bg)',
              color: 'var(--ink)',
              fontSize: '12.5px',
              fontWeight: 600,
              fontFamily: 'inherit',
              textTransform: 'none',
              letterSpacing: 'normal',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--panel)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg)')}
          >
            ← {backLabel}
          </button>
          {drillDownLabel(initialFilters) && (
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Showing: <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{drillDownLabel(initialFilters)}</strong>
            </span>
          )}
          {initialFilters?.unlinked && (
            <span style={{ flexBasis: '100%', fontSize: '12.5px', color: 'var(--muted)' }}>
              Also in this set, not tied to an application (see Today): {initialFilters.unlinked.join('; ')}
            </span>
          )}
        </div>
      )}
      <div className="page-title">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" fill="var(--accent)" /><path d="M3.5 7.25L12 12l8.5-4.75 M12 12v9.5" fill="none" stroke="#fff" strokeWidth={1.4} /></svg>
        <h1>Jobs</h1>
      </div>
      <p className="page-lede">
        {loading ? 'Loading applications…' : `${applications.length.toLocaleString(displayLocale())} applications. ${views[0].count} moving, ${views[1].count.toLocaleString(displayLocale())} waiting to hear back.`}
      </p>

      <div className="jobs-bar">
        <div className="view-tabs" role="tablist" aria-label="Views">
          {views.map((v) => (
            <button key={v.key} role="tab" aria-selected={activeView === v.key} className={`view-tab ${activeView === v.key ? 'on' : ''}`} onClick={() => pickView(v.filters)}>
              {v.label}<span>{v.count.toLocaleString(displayLocale())}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="jobs-filters">
        <FilterBar
          onFilterChange={handleFilterChange}
          onAddClick={handleAddClick}
          density={density}
          onDensityChange={changeDensity}
          stageOptions={allStageOptions}
          noResponseCount={noResponseIds.size}
          initialFilters={bar.filters}
          filtersRequest={bar.request}
        />
      </div>

      {/* Loading State */}
      {loading && (
        <p className="page-empty">Loading applications…</p>
      )}

      {/* Empty State */}
      {!loading && filteredApplications.length === 0 && (
        <div>
          <p className="page-empty">
            {applications.length === 0
              ? 'No applications yet. Add one to get started.'
              : !filters.search && !filters.stage && !filters.stages && !filters.ids && !filters.city && !filters.needsLetter && !filters.noResponse && noResponseIds.size > 0
              ? 'Nothing active. The rest are under No response.'
              : `No applications match${filters.search ? ` “${filters.search}”` : ' this filter'}.`}
          </p>
        </div>
      )}

      {/* Applications Grid */}
      {!loading && filteredApplications.length > 0 && (
        <div className={density === 'compact' ? 'jtable' : 'jcards'} role={density === 'compact' ? 'table' : undefined} aria-label="Applications">
          {density === 'compact' && (
            <div className="jhead" role="row">
              <span>Company</span>
              <span>Role</span>
              <span>Stage</span>
              <span>Fit</span>
              <span>Status</span>
              <span>Source</span>
              <span>Location</span>
              <span>Applied</span>
              <span />
            </div>
          )}
          {filteredApplications.map((app) => (
            <ApplicationCard
              key={app.id}
              application={app}
              onClick={handleSelect}
              onDelete={handleDeleteApplication}
              stages={stagesByApp.get(app.id)}
              onChangeStage={handleChangeStage}
              density={density}
            />
          ))}
        </div>
      )}

      {/* Add Application Modal */}
      {showAddModal && (
        <AddApplicationModal
          onClose={handleCloseModal}
          onCreated={handleCreated}
          onChanged={refresh}
        />
      )}

      {/* Error Dialog */}
      {errorDialog && (
        <Dialog
          isOpen={true}
          title={errorDialog.title}
          message={errorDialog.message}
          onConfirm={() => setErrorDialog(null)}
          onCancel={() => setErrorDialog(null)}
          confirmText="OK"
          isDangerous={false}
        />
      )}
    </div>
  );
};

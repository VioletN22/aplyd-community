import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Dropdown } from './Dropdown';
import { ListDensity } from './ApplicationCard';
import { stageLabel, stageOptions as allStageOptions } from '../lib/stages';
import { LocationFilter } from '../../shared/location';
import { ChipTone, FLAG_TONE, locationTone } from '../lib/chipColors';

export interface Filters {
  search?: string;
  stage?: string;
  /** Any of these stages (the dashboard's "Assessments to do" card). Cleared by picking a single stage. */
  stages?: string[];
  /** Exactly these applications (a dashboard "Needs you" set). Cleared from its chip. */
  ids?: string[];
  /** What a dashboard drill-down calls itself ("Assessments to do"); display only. */
  drillDown?: string;
  /** Items in that drill-down with no application to list (shown as a note, they live on Today). */
  unlinked?: string[];
  city?: LocationFilter;
  /** Applied, no cover letter drafted yet: the triage pile. */
  needsLetter?: boolean;
  /** Show only the applications that got no response (hidden otherwise). */
  noResponse?: boolean;
  /** Set by a Jobs view tab: the tab already says what is showing, so no stage chip. */
  fromView?: boolean;
}

interface FilterBarProps {
  onFilterChange: (filters: Filters) => void;
  onAddClick: () => void;
  density: ListDensity;
  onDensityChange: (density: ListDensity) => void;
  /** Every stage worth offering: the fixed funnel, the known custom stages, and any other seen in the data. Defaults to the fixed + known-custom list. */
  stageOptions?: string[];
  /** How many applications are in the No response pile. */
  noResponseCount?: number;
  /** Filters to start from (a dashboard card or stage row opened the list). */
  initialFilters?: Filters;
  /** Changes whenever a new initialFilters request arrives, so the bar resets to it even while mounted. */
  filtersRequest?: number;
}

// Typing is instant in the input; the list only re-filters once the user pauses.
const SEARCH_DEBOUNCE_MS = 120;

const chip = (active: boolean): React.CSSProperties => ({
  padding: '4px 11px',
  borderRadius: '14px',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--line-2)'}`,
  backgroundColor: active ? 'var(--accent-tint)' : 'var(--bg)',
  color: active ? '#1f56ba' : 'var(--muted)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
});

// A filter chip that matches the chips it filters for: outlined in its hue,
// tinted with it once on.
const toneChip = (active: boolean, tone: ChipTone): React.CSSProperties => ({
  ...chip(active),
  border: `1px solid ${active ? tone.fg : 'var(--line-2)'}`,
  backgroundColor: active ? tone.bg : 'var(--bg)',
  color: active ? tone.fg : 'var(--muted)',
});

export const FilterBar: React.FC<FilterBarProps> = ({ onFilterChange, onAddClick, density, onDensityChange, stageOptions, noResponseCount = 0, initialFilters, filtersRequest = 0 }) => {
  const init = initialFilters ?? {};
  const [search, setSearch] = useState(init.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(init.search ?? '');
  const [stage, setStageValue] = useState(init.stage ?? '');
  const [stages, setStages] = useState<string[]>(init.stages ?? []);
  const [ids, setIds] = useState<string[] | null>(init.ids ?? null);
  const [city, setCity] = useState<LocationFilter | ''>(init.city ?? '');
  const [needsLetter, setNeedsLetter] = useState(!!init.needsLetter);
  const [noResponse, setNoResponse] = useState(!!init.noResponse);

  // A new request from outside (the dashboard) replaces whatever was set. The
  // first run is the mount, which the useState initialisers already covered.
  const lastRequest = useRef(filtersRequest);
  useEffect(() => {
    if (lastRequest.current === filtersRequest) return;
    lastRequest.current = filtersRequest;
    const f = initialFilters ?? {};
    setSearch(f.search ?? '');
    setDebouncedSearch(f.search ?? '');
    setStageValue(f.stage ?? '');
    setStages(f.stages ?? []);
    setIds(f.ids ?? null);
    setCity(f.city ?? '');
    setNeedsLetter(!!f.needsLetter);
    setNoResponse(!!f.noResponse);
  }, [filtersRequest, initialFilters]);

  // Picking one stage replaces a multi-stage set from the dashboard.
  const setStage = (value: string) => { setStageValue(value); setStages([]); };

  const STAGE_OPTIONS = useMemo(() => [
    { value: '', label: 'All stages' },
    ...(stageOptions ?? allStageOptions()).map((st) => ({ value: st, label: stageLabel(st) })),
  ], [stageOptions]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  // Held in a ref so a fresh callback identity from the parent cannot re-fire the
  // emit effect (which would loop: emit, parent re-renders, new identity, emit).
  const emit = useRef(onFilterChange);
  emit.current = onFilterChange;

  useEffect(() => {
    emit.current({
      search: debouncedSearch || undefined,
      stage: stage || undefined,
      stages: stages.length > 0 ? stages : undefined,
      ids: ids ?? undefined,
      city: city || undefined,
      needsLetter: needsLetter || undefined,
      noResponse: noResponse || undefined,
    });
  }, [debouncedSearch, stage, stages, ids, city, needsLetter, noResponse]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
      {/* Company search */}
      <div style={{ position: 'relative', flex: 1, maxWidth: '320px', minWidth: '200px' }}>
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--muted)',
          }}
        />
        <input
          type="text"
          placeholder="Search role, company, keyword…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px 7px 30px',
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--line-2)',
            borderRadius: '8px',
            fontSize: '14px',
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
      </div>

      {/* Stage filter */}
      <Dropdown
        value={stage}
        options={STAGE_OPTIONS}
        onChange={setStage}
        placeholder="All stages"
        width="180px"
      />

      {/* A set of applications from the dashboard ("Assessments to do"): one chip, click to clear */}
      {ids && (
        <button type="button" onClick={() => setIds(null)} title="Clear this filter" aria-pressed style={chip(true)}>
          {initialFilters?.drillDown ?? 'Selected'} ({ids.length}) ×
        </button>
      )}

      {/* A stage set from the dashboard ("Assessments to do"): shown as one chip, click to clear */}
      {stages.length > 0 && !initialFilters?.fromView && (
        <button
          type="button"
          onClick={() => setStages([])}
          title="Clear this stage filter"
          aria-pressed
          style={chip(true)}
        >
          {stages.map(stageLabel).join(' + ')} ×
        </button>
      )}

      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>Location
        <input aria-label="Filter by location" value={city} onChange={event => setCity(event.target.value)} placeholder="Any city, region or remote" style={{padding:'5px 10px',border:'1px solid var(--line)',borderRadius:8,background:'var(--bg)',color:'var(--ink)',maxWidth:220}} />
      </label>

      {/* Triage: applied rows with no letter behind them yet */}
      <button
        type="button"
        onClick={() => setNeedsLetter((v) => !v)}
        title="Applied, with no cover letter drafted yet"
        style={chip(needsLetter)}
      >
        Needs letter
      </button>

      {/* No response: applied, then 21 days of nothing. Hidden from the list until asked for. */}
      {(noResponseCount > 0 || noResponse) && (
        <button
          type="button"
          onClick={() => setNoResponse((v) => !v)}
          title="Applied, with no email or change for 21 days"
          style={toneChip(noResponse, FLAG_TONE.noResponse)}
        >
          No response ({noResponseCount})
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Row density */}
      <div className="seg" role="group" aria-label="Layout">
        <button type="button" className={density === 'compact' ? 'on' : ''} onClick={() => onDensityChange('compact')} title="One row per application">Table</button>
        <button type="button" className={density === 'comfortable' ? 'on' : ''} onClick={() => onDensityChange('comfortable')} title="Full cards: location, salary, deadline">Cards</button>
      </div>

      {/* Add button */}
      <button className="btn btn-primary" onClick={onAddClick}>
        <Plus size={14} />
        Add job
      </button>
    </div>
  );
};

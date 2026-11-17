import { STAGES, Stage, EXTRA_STAGES } from '../../shared/types';

/** Display names for the one fixed stage list. */
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied',
  assessment: 'Assessment',
  phone_screen: 'Phone screen',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

/**
 * Readable names for the recognised stages outside the fixed STAGES funnel.
 * assessed = the assessment is done, waiting to hear back; take_home is the
 * legacy name for an assessment still to do.
 */
const CUSTOM_STAGE_LABEL: Record<string, string> = {
  take_home: 'Take-home (assessment)',
  assessed: 'Assessment done',
};

/** The extra stages every picker and filter offers, whether or not any application is on one right now. */
export const CUSTOM_STAGES: readonly string[] = [...EXTRA_STAGES];

/**
 * Display order for every recognised stage: the funnel, with the assessment
 * family together (to do, its legacy alias, done) right after applied.
 */
const RECOGNISED_ORDER: readonly string[] = (() => {
  const order: string[] = [...STAGES];
  order.splice(order.indexOf('assessment') + 1, 0, 'take_home', 'assessed');
  return order;
})();

/** A label for any stored stage, including a legacy one outside STAGES. */
export const stageLabel = (s: string): string =>
  (STAGE_LABEL as Record<string, string>)[s]
  ?? CUSTOM_STAGE_LABEL[s]
  ?? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * What a stage picker (or the stage filter) offers: every recognised stage in
 * funnel order (assessment, take-home and assessment done right after
 * applied), then any other stage value actually present in the data (a legacy
 * or hand-typed one) - `dataStages`, plus `current` in case it alone is legacy
 * and `dataStages` was not passed.
 */
export const stageOptions = (current?: string, dataStages: readonly string[] = []): string[] => {
  const known = new Set<string>(RECOGNISED_ORDER);
  const extra: string[] = [];
  for (const s of [...dataStages, ...(current ? [current] : [])]) {
    if (s && !known.has(s)) { known.add(s); extra.push(s); }
  }
  return [...RECOGNISED_ORDER, ...extra];
};

/** Stages where an interview prep sheet is worth showing. */
export const PREP_STAGES: readonly string[] = ['phone_screen', 'interview', 'offer'];

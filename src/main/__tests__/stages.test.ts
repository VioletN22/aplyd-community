import { describe, it, expect } from 'vitest';
import {
  STAGES, isStage, isNoResponse, silentDays, NO_RESPONSE_AFTER_DAYS, QUIET_AFTER_DAYS, isQuiet, type JobApplication,
} from '../../shared/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const app = (stage: string, touchedDaysAgo: number) => ({
  current_stage: stage, created_at: ago(touchedDaysAgo + 5), updated_at: ago(touchedDaysAgo),
});

describe('STAGES', () => {
  it('is the one fixed list, in funnel order', () => {
    expect([...STAGES]).toEqual(['applied', 'assessment', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn']);
    expect(isStage('interview')).toBe(true);
    expect(isStage('assessment')).toBe(true);
    // Recognised beyond the funnel: assessment done, and the legacy take-home.
    expect(isStage('assessed')).toBe(true);
    expect(isStage('take_home')).toBe(true);
    expect(isStage('oa')).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});

describe('isNoResponse', () => {
  it('needs 21 days of silence at applied', () => {
    expect(NO_RESPONSE_AFTER_DAYS).toBe(21);
    expect(QUIET_AFTER_DAYS).toBe(21);
    expect(isNoResponse(app('applied', 21), null, NOW)).toBe(true);
    expect(isNoResponse(app('applied', 20), null, NOW)).toBe(false);
  });

  it('only counts applications still at applied', () => {
    expect(isNoResponse(app('interview', 60), null, NOW)).toBe(false);
    expect(isNoResponse(app('rejected', 60), null, NOW)).toBe(false);
  });

  it('a recent email resets the clock, an old one does not', () => {
    expect(isNoResponse(app('applied', 40), ago(3), NOW)).toBe(false);
    expect(isNoResponse(app('applied', 40), ago(30), NOW)).toBe(true);
    expect(silentDays(app('applied', 40), ago(3), NOW)).toBe(3);
    expect(silentDays(app('applied', 40), 'garbage', NOW)).toBe(40);
  });

  it('a manual edit (updated_at) resets the clock', () => {
    expect(isNoResponse({ current_stage: 'applied', created_at: ago(90), updated_at: ago(2) }, null, NOW)).toBe(false);
  });

  it('isQuiet is the same rule, reading last_email_at off the row', () => {
    const row = { ...app('applied', 30), last_email_at: ago(1) } as unknown as JobApplication;
    expect(isQuiet(row, NOW)).toBe(false);
    expect(isQuiet({ ...row, last_email_at: null }, NOW)).toBe(true);
  });
});

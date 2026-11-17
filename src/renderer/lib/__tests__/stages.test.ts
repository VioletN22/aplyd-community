import { describe, it, expect } from 'vitest';
import { stageLabel, stageOptions } from '../stages';
import { isStage } from '../../../shared/types';

const KNOWN = ['applied', 'assessment', 'take_home', 'assessed', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn'];

describe('stageLabel', () => {
  it('names the fixed funnel stages', () => {
    expect(stageLabel('applied')).toBe('Applied');
    expect(stageLabel('phone_screen')).toBe('Phone screen');
    expect(stageLabel('interview')).toBe('Interview');
  });

  it('names the recognised custom Today stages', () => {
    expect(stageLabel('assessment')).toBe('Assessment');
    expect(stageLabel('take_home')).toBe('Take-home (assessment)');
    expect(stageLabel('assessed')).toBe('Assessment done');
  });

  it('title-cases anything else it has never heard of', () => {
    expect(stageLabel('final_round')).toBe('Final Round');
  });
});

describe('stageOptions', () => {
  it('always offers the fixed stages plus the known custom ones, even with no current/data stage', () => {
    expect(stageOptions()).toEqual(KNOWN);
  });

  it('adds a legacy current stage exactly once, after the known custom stages', () => {
    expect(stageOptions('final_round')).toEqual([...KNOWN, 'final_round']);
    // Already known: not duplicated.
    expect(stageOptions('assessment')).toEqual(KNOWN);
  });

  it('folds in every other stage value seen in the data, once each', () => {
    expect(stageOptions(undefined, ['applied', 'oa', 'oa', 'final_round']))
      .toEqual([...KNOWN, 'oa', 'final_round']);
  });
});

describe('isStage', () => {
  it('accepts the funnel, assessment done and the legacy take-home, nothing else', () => {
    for (const s of KNOWN) expect(isStage(s)).toBe(true);
    expect(isStage('oa')).toBe(false);
    expect(isStage('final_round')).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  FLAG_TONE, HASH_PALETTE, TONES, contrastRatio, fitTone, hashTone, locationTone, sourceChip, stageTone,
} from '../chipColors';

describe('contrast', () => {
  it('every tone clears WCAG AA for small text on its tint and on white', () => {
    for (const [name, t] of Object.entries(TONES)) {
      expect(contrastRatio(t.fg, t.bg), `${name} on tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.fg, '#ffffff'), `${name} on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#ffffff', t.fg), `white on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('stages', () => {
  it('gives every known stage its own colour', () => {
    const known = ['applied', 'assessment', 'take_home', 'assessed', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn'];
    const bgs = known.map((s) => stageTone(s).bg);
    expect(new Set(bgs).size).toBe(known.length);
  });
  it('maps meaning to colour', () => {
    expect(stageTone('applied')).toBe(TONES.blue);
    expect(stageTone('assessment')).toBe(TONES.orange);
    expect(stageTone('interview')).toBe(TONES.red);
    expect(stageTone('offer')).toBe(TONES.green);
    expect(stageTone('rejected')).toBe(TONES.grey);
    expect(stageTone('withdrawn')).toBe(TONES.slate);
  });
  it('hashes unknown stages to a stable palette colour', () => {
    expect(stageTone('reference_check')).toBe(stageTone('reference_check'));
    expect(HASH_PALETTE).toContain(stageTone('reference_check'));
    expect(hashTone('Foo')).toBe(hashTone(' foo '));
  });
});

describe('sources', () => {
  it('groups spelling variants under one board', () => {
    expect(sourceChip('SEEK')?.label).toBe('SEEK');
    expect(sourceChip('Seek')?.tone).toBe(sourceChip('SEEK Quick apply (Hays)')?.tone);
    expect(sourceChip('LinkedIn Easy Apply')?.label).toBe('LinkedIn');
    expect(sourceChip('au.linkedin.com')?.label).toBe('LinkedIn');
    expect(sourceChip('Official Greenhouse employer job board')?.label).toBe('Greenhouse');
    expect(sourceChip('job-boards.greenhouse.io')?.label).toBe('Greenhouse');
    expect(sourceChip('jobs.smartrecruiters.com')?.label).toBe('SmartRecruiters');
    expect(sourceChip('Official swipejobs Breezy posting')?.label).toBe('Breezy');
  });
  it('takes the earliest named board, then employer, then a hash', () => {
    expect(sourceChip('Workable employer listing; employer LinkedIn post also announces')?.label).toBe('Workable');
    expect(sourceChip('Official Snooze careers listing')?.label).toBe('Employer');
    expect(sourceChip('Other')).toEqual({ label: 'Other', tone: hashTone('Other') });
    expect(sourceChip('')).toBeNull();
    expect(sourceChip(null)).toBeNull();
  });
  it('gives the main boards distinct colours', () => {
    const boards = ['SEEK', 'LinkedIn', 'Indeed', 'Greenhouse', 'Lever', 'Workable', 'Ashby', 'Breezy', 'SmartRecruiters', 'Jora'];
    expect(new Set(boards.map((b) => sourceChip(b)!.tone)).size).toBe(boards.length);
  });
});

describe('locations, flags, fit', () => {
  it('colours each location filter differently', () => {
    expect(new Set(['Sydney', 'Melbourne', 'Regional'].map(locationTone)).size).toBe(3);
  });
  it('colours each flag differently', () => {
    expect(new Set(Object.values(FLAG_TONE)).size).toBe(Object.keys(FLAG_TONE).length);
  });
  it('bands fit', () => {
    expect(fitTone(9)).toBe(TONES.blue);
    expect(fitTone(6)).toBe(TONES.slate);
    expect(fitTone(2)).toBe(TONES.grey);
  });
});

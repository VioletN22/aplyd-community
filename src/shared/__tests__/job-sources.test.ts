import { describe, expect, it } from 'vitest';
import { JOB_SOURCES, jobSourceOptions } from '../types';

describe('job sources', () => {
  it('lists the channels used everywhere first and keeps Other last', () => {
    expect(JOB_SOURCES.slice(0, 6)).toEqual(['LinkedIn', 'Indeed', 'Glassdoor', 'Company website', 'Referral', 'Recruiter / Agency']);
    expect(JOB_SOURCES[JOB_SOURCES.length - 1]).toBe('Other');
  });
  it('still offers every value earlier versions stored', () => {
    for (const value of ['Seek', 'LinkedIn', 'Indeed', 'Prosple', 'GradConnection', 'Jora', 'Glassdoor', 'CareerOne',
      'Workforce Australia', 'Hatch', 'Company website', 'Referral', 'Recruiter / Agency', 'Email', 'Other']) {
      expect(JOB_SOURCES).toContain(value);
    }
  });
  it('keeps a stored value that is not in the list so it still shows', () => {
    expect(jobSourceOptions('SEEK Quick apply (Hays)')).toEqual([...JOB_SOURCES, 'SEEK Quick apply (Hays)']);
    expect(jobSourceOptions('Indeed')).toEqual([...JOB_SOURCES]);
    expect(jobSourceOptions(null)).toEqual([...JOB_SOURCES]);
  });
});

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { letterPdfBase, stripCompanySuffix, profileFullName, uniquePdfPath, safeDocName } from '../letter-file';

describe('stripCompanySuffix', () => {
  it.each([
    ['Acme Pty Ltd', 'Acme'],
    ['Acme Pty. Ltd.', 'Acme'],
    ['Acme Pty Ltd.', 'Acme'],
    ['Acme Limited', 'Acme'],
    ['Acme Proprietary Limited', 'Acme'],
    ['Acme, Pty Ltd', 'Acme'],
    ['Acme Ltd', 'Acme'],
    ['Atlassian', 'Atlassian'],
    ['Limited Edition Co', 'Limited Edition Co'],
    ['Limited', 'Limited'],
  ])('%s -> %s', (input, out) => {
    expect(stripCompanySuffix(input)).toBe(out);
  });
});

describe('profileFullName', () => {
  it('prefers the Full name field', () => {
    expect(profileFullName({ 'Full name': ' Alex  Morgan ', 'Legal first name': 'X' })).toBe('Alex Morgan');
  });
  it('falls back to preferred or legal first name plus legal last name', () => {
    expect(profileFullName({ 'Preferred name': 'Alex', 'Legal first name': 'Jordan', 'Legal last name': 'Morgan' })).toBe('Alex Morgan');
    expect(profileFullName({ 'Legal first name': 'Jordan', 'Legal last name': 'Morgan' })).toBe('Jordan Morgan');
  });
  it('is empty when nothing is on file', () => {
    expect(profileFullName({})).toBe('');
    expect(profileFullName(null)).toBe('');
  });
});

describe('letterPdfBase', () => {
  it('is company first, role, then the applicant name', () => {
    expect(letterPdfBase('Canva Pty Ltd', 'Frontend Engineer', 'Alex Morgan')).toBe('Canva - Frontend Engineer - Alex Morgan');
  });
  it('omits the name segment when no name is known', () => {
    expect(letterPdfBase('Canva Pty Ltd', 'Frontend Engineer', '')).toBe('Canva - Frontend Engineer');
    expect(letterPdfBase('Canva', 'Engineer', '!!!')).toBe('Canva - Engineer');
  });
  it('keeps the safe-character rules', () => {
    expect(letterPdfBase('A/B & Co.', 'Dev: Ops (Senior)', 'Alex Morgan')).toBe('AB Co - Dev Ops Senior - Alex Morgan');
    expect(safeDocName('')).toBe('Untitled');
  });
});

describe('uniquePdfPath', () => {
  it('adds (2), (3) on collision', () => {
    const directory = path.resolve('example-letters');
    const taken = new Set([path.join(directory, 'X.pdf'), path.join(directory, 'X (2).pdf')]);
    expect(uniquePdfPath(directory, 'X', (p) => taken.has(p))).toBe(path.join(directory, 'X (3).pdf'));
    expect(uniquePdfPath(directory, 'Y', (p) => taken.has(p))).toBe(path.join(directory, 'Y.pdf'));
  });
});

import { describe, expect, it } from 'vitest';
import { locationCities, matchesCity, isRegionalAu, matchesLocationFilter, genericLocationLabel } from '../location';

describe('location city tags', () => {
  it('recognizes named cities and multi-city jobs', () => {
    expect(locationCities('Greater Sydney Area, Australia (Hybrid)')).toEqual(['Sydney']);
    expect(locationCities('South Melbourne VIC; on-site')).toEqual(['Melbourne']);
    expect(locationCities('Sydney, Melbourne or Brisbane')).toEqual(['Sydney', 'Melbourne']);
    expect(matchesCity('Sydney, Melbourne or Brisbane', 'Melbourne')).toBe(true);
  });

  it('recognizes specific local suburbs without treating whole states as a city', () => {
    expect(locationCities('Parramatta NSW')).toEqual(['Sydney']);
    expect(locationCities('Woolloomooloo NSW 2011')).toEqual(['Sydney']);
    expect(locationCities('Canterbury, Melbourne VIC')).toEqual(['Melbourne']);
    expect(locationCities('Canterbury VIC')).toEqual(['Melbourne']);
    expect(locationCities('Canterbury NSW')).toEqual(['Sydney']);
    expect(locationCities('Richmond VIC')).toEqual(['Melbourne']);
    expect(locationCities('Richmond, Virginia')).toEqual([]);
    expect(locationCities('Peakhurst NSW; casual')).toEqual(['Sydney']);
    expect(locationCities('Newcastle NSW')).toEqual([]);
    expect(locationCities('Geelong VIC')).toEqual([]);
  });

  it('keeps remote and unrelated locations untagged', () => {
    expect(locationCities('Remote - Australia')).toEqual([]);
    expect(locationCities('New York, United States')).toEqual([]);
    expect(locationCities('')).toEqual([]);
    expect(matchesCity('Remote - Australia', 'Sydney')).toBe(false);
  });
});

describe('isRegionalAu', () => {
  it('recognizes the named regional areas the user applies in', () => {
    for (const loc of [
      'Newcastle NSW', 'Hunter Valley NSW', 'Wollongong NSW', 'Illawarra region',
      'Central Coast NSW', 'South Coast NSW', 'Canberra ACT', 'Gold Coast QLD',
      'Sunshine Coast QLD', 'Perth WA', 'Adelaide SA', 'Hobart TAS',
    ]) {
      expect(isRegionalAu(loc), loc).toBe(true);
    }
  });

  it('is false for the three metros, Brisbane included, even with no chip of its own', () => {
    expect(isRegionalAu('Sydney NSW')).toBe(false);
    expect(isRegionalAu('Melbourne VIC')).toBe(false);
    expect(isRegionalAu('Brisbane QLD')).toBe(false);
  });

  it('recognizes more designated regional places, including whole regional states', () => {
    for (const loc of [
      'Toowoomba, QLD', 'Geelong VIC', 'Darwin NT', 'Ballarat VIC', 'Townsville QLD',
      'Fremantle, Western Australia', 'Launceston, Tasmania', 'Tuggeranong ACT', 'Mount Gambier SA',
    ]) {
      expect(isRegionalAu(loc), loc).toBe(true);
    }
  });

  it('never tags Sydney suburbs as regional, listed or not', () => {
    for (const loc of [
      'Pymble NSW', 'Surry Hills NSW', 'Miranda NSW', 'Macquarie Park', 'Macquarie Park NSW',
      'Silverwater NSW', 'Arncliffe NSW', 'Parramatta NSW', 'Kings Langley NSW', 'Seven Hills, New South Wales',
    ]) {
      expect(isRegionalAu(loc), loc).toBe(false);
    }
    expect(locationCities('Pymble NSW')).toEqual(['Sydney']);
    expect(locationCities('Surry Hills NSW')).toEqual(['Sydney']);
    expect(locationCities('Miranda NSW')).toEqual(['Sydney']);
    expect(locationCities('Silverwater NSW')).toEqual(['Sydney']);
  });

  it('an unrecognised NSW/VIC/QLD place or bare "Australia" is unknown, not regional', () => {
    expect(isRegionalAu('Kings Langley NSW')).toBe(false);
    expect(isRegionalAu('Somewhere VIC')).toBe(false);
    expect(isRegionalAu('Springwood QLD')).toBe(false);
    expect(isRegionalAu('Remote - Australia')).toBe(false);
  });

  it('uses Home Affairs postcodes when present: metro postcodes are not regional', () => {
    expect(isRegionalAu('Kings Langley NSW 2147')).toBe(false);
    expect(locationCities('Kings Langley NSW 2147')).toEqual(['Sydney']);
    expect(locationCities('Campbelltown NSW 2560')).toEqual(['Sydney']);
    expect(locationCities('Penrith NSW 2750')).toEqual(['Sydney']);
    expect(locationCities('Somewhere VIC 3150')).toEqual(['Melbourne']);
    expect(isRegionalAu('Springwood QLD 4127')).toBe(false);
    expect(isRegionalAu('Charlestown NSW 2290')).toBe(true);
    expect(isRegionalAu('Erina NSW 2250')).toBe(true);
    expect(isRegionalAu('Albion Park Rail NSW 2527')).toBe(true);
    expect(isRegionalAu('Dubbo NSW 2830')).toBe(true);
    expect(isRegionalAu('Waurn Ponds VIC 3216')).toBe(true);
    expect(isRegionalAu('Southport QLD 4215')).toBe(true);
    expect(isRegionalAu('Maroochydore QLD 4558')).toBe(true);
    expect(isRegionalAu('Joondalup WA 6027')).toBe(true);
    expect(isRegionalAu('Casuarina NT 0810')).toBe(true);
  });

  it('is false for blank, unknown or overseas locations', () => {
    expect(isRegionalAu('')).toBe(false);
    expect(isRegionalAu(null)).toBe(false);
    expect(isRegionalAu(undefined)).toBe(false);
    expect(isRegionalAu('New York, United States')).toBe(false);
    expect(isRegionalAu('Perth, Scotland')).toBe(false);
    expect(isRegionalAu('Newcastle upon Tyne, UK')).toBe(false);
  });
});

describe('matchesLocationFilter', () => {
  it('routes Sydney/Melbourne to matchesCity and Regional to isRegionalAu', () => {
    expect(matchesLocationFilter('Sydney NSW', 'Sydney')).toBe(true);
    expect(matchesLocationFilter('Sydney NSW', 'Regional')).toBe(false);
    expect(matchesLocationFilter('Newcastle NSW', 'Regional')).toBe(true);
    expect(matchesLocationFilter('Newcastle NSW', 'Sydney')).toBe(false);
  });
});

describe('genericLocationLabel', () => {
  it('takes the city from an international location', () => {
    expect(genericLocationLabel('Austin, TX')).toBe('Austin');
    expect(genericLocationLabel('London, UK')).toBe('London');
    expect(genericLocationLabel('Toronto, ON, Canada')).toBe('Toronto');
  });
  it('drops a trailing work-mode note', () => {
    expect(genericLocationLabel('Berlin, Germany (Hybrid)')).toBe('Berlin');
    expect(genericLocationLabel('Austin (On-site)')).toBe('Austin');
  });
  it('keeps a bare work mode and trims a region suffix', () => {
    expect(genericLocationLabel('Remote - US')).toBe('Remote');
    expect(genericLocationLabel('remote')).toBe('Remote');
    expect(genericLocationLabel('Hybrid – London')).toBe('Hybrid');
  });
  it('is null for nothing to show', () => {
    expect(genericLocationLabel('')).toBe(null);
    expect(genericLocationLabel(null)).toBe(null);
    expect(genericLocationLabel(undefined)).toBe(null);
    expect(genericLocationLabel('   ')).toBe(null);
  });
  it('handles unicode place names', () => {
    expect(genericLocationLabel('São Paulo, Brazil')).toBe('São Paulo');
    expect(genericLocationLabel('東京, Japan')).toBe('東京');
  });
});

it('filters arbitrary international locations without assuming a home city', () => {
  expect(matchesLocationFilter('Berlin, Germany (Hybrid)', ' berlin ')).toBe(true);
  expect(matchesLocationFilter('New York, USA', 'york')).toBe(true);
  expect(matchesLocationFilter('Remote - Canada', 'remote')).toBe(true);
  expect(matchesLocationFilter(null, 'Paris')).toBe(false);
  expect(matchesLocationFilter(null, '')).toBe(true);
});

/** City labels inferred only from places named in the job's location text. */
export type LocationCity = 'Sydney' | 'Melbourne';

/** What the location chips filter by: a named metro, or designated regional Australia. */
export type LocationFilter = string;

// Common Sydney suburbs found in imported postings. Require NSW so names shared
// with other cities (for example Newtown) do not become false Sydney matches.
// This list only adds a Sydney chip: a suburb missing from it is never
// Regional (see isRegionalAu), it just goes untagged.
const SYDNEY_SUBURBS = [
  'Alexandria', 'Arncliffe', 'Artarmon', 'Auburn', 'Bankstown', 'Baulkham Hills', 'Bella Vista',
  'Blacktown', 'Bondi', 'Bondi Junction', 'Botany', 'Burwood', 'Campbelltown', 'Camperdown',
  'Canterbury', 'Castle Hill', 'Chatswood', 'Chippendale', 'Cronulla', 'Darlinghurst',
  'Eastgardens', 'Eastwood', 'Epping', 'Frenchs Forest', 'Glebe', 'Haymarket', 'Homebush',
  'Hornsby', 'Hurstville', 'Kellyville', 'Kogarah', 'Lane Cove', 'Liverpool', 'Macquarie Park',
  'Manly', 'Marrickville', 'Mascot', 'Miranda', 'Mona Vale', 'Neutral Bay', 'Newtown',
  'Norwest', 'North Ryde', 'North Strathfield', 'North Sydney', 'Pagewood', 'Parramatta',
  'Peakhurst', 'Penrith', 'Petersham', 'Pymble', 'Pyrmont', 'Randwick', 'Redfern', 'Rhodes',
  'Rockdale', 'Rosebery', 'Rouse Hill', 'Ryde', 'Silverwater', 'St Leonards', 'Strathfield',
  'Surry Hills', 'Sutherland', 'Tempe', 'Ultimo', 'Warringah Mall', 'Waterloo', 'Wetherill Park',
  'Woolloomooloo', 'Zetland',
];

const MELBOURNE_SUBURBS = [
  'Braeside', 'Canterbury', 'Collingwood', 'Docklands', 'Hawthorn', 'Malvern',
  'Moorabbin', 'Richmond', 'Southbank', 'St Kilda',
];

const hasPlace = (text: string, place: string): boolean =>
  new RegExp(`(^|[^a-z])${place.replace(/ /g, '\\s+')}($|[^a-z])`, 'i').test(text);

// --- Postcodes ---------------------------------------------------------------
// Home Affairs defines "designated regional area" by postcode: since Nov 2019
// every Australian postcode is regional except the Sydney, Melbourne and
// Brisbane metro postcodes. These ranges are the complement of the Home
// Affairs regional lists for NSW, VIC and QLD (PO-box ranges included).
type Metro = 'Sydney' | 'Melbourne' | 'Brisbane';
type Range = [number, number];
const METRO_POSTCODES: Record<Metro, Range[]> = {
  Sydney: [[1000, 1999], [2000, 2249], [2555, 2573], [2740, 2786]],
  Melbourne: [
    [3000, 3210], [3335, 3339], [3425, 3429], [3750, 3752], [3754, 3755], [3757, 3757],
    [3759, 3761], [3763, 3763], [3765, 3777], [3782, 3782], [3784, 3796], [3798, 3798],
    [3800, 3809], [3910, 3920], [3926, 3944], [3975, 3978], [3980, 3980], [8000, 8999],
  ],
  Brisbane: [
    [4000, 4123], [4126, 4132], [4134, 4182], [4185, 4207], [4300, 4306], [4500, 4509],
    [4511, 4511], [4513, 4514], [4520, 4521], [9000, 9999],
  ],
};

const inRanges = (n: number, ranges: Range[]): boolean => ranges.some(([lo, hi]) => n >= lo && n <= hi);

/** 'Regional', a metro name, or null when the number isn't an Australian postcode. */
function classifyPostcode(postcode: number): Metro | 'Regional' | null {
  for (const metro of Object.keys(METRO_POSTCODES) as Metro[]) {
    if (inRanges(postcode, METRO_POSTCODES[metro])) return metro;
  }
  // NT 08xx-09xx, ACT 02xx, the rest of NSW/ACT/VIC/QLD, and all of SA, WA, TAS.
  if ((postcode >= 800 && postcode <= 999) || (postcode >= 200 && postcode <= 299)) return 'Regional';
  if (postcode >= 2000 && postcode <= 7999) return 'Regional';
  return null;
}

const AU_PLACE_RE = /\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT|New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania|Northern Territory|Australian Capital Territory|Australia)\b/i;
const OVERSEAS_RE = /\b(United States|USA|United Kingdom|UK|England|Scotland|Canada|New Zealand|NZ|Virginia|Washington)\b/i;

/** Postcode classes found in the text; only read when it carries an Australian state or "Australia". */
function postcodeClasses(location: string): (Metro | 'Regional')[] {
  if (!AU_PLACE_RE.test(location) || OVERSEAS_RE.test(location)) return [];
  const out: (Metro | 'Regional')[] = [];
  for (const m of location.matchAll(/(?<![\d$.,])(\d{4})(?![\d%])/g)) {
    const cls = classifyPostcode(Number(m[1]));
    if (cls) out.push(cls);
  }
  return out;
}

export function locationCities(location: string | null | undefined): LocationCity[] {
  if (!location?.trim()) return [];
  const postcodes = postcodeClasses(location);
  const sydney = hasPlace(location, 'Sydney') || postcodes.includes('Sydney') ||
    (/\b(?:NSW|New South Wales)\b/i.test(location) && SYDNEY_SUBURBS.some((place) => hasPlace(location, place)));
  const melbourne = hasPlace(location, 'Melbourne') || postcodes.includes('Melbourne') ||
    (/\b(?:VIC|Victoria)\b/i.test(location) && MELBOURNE_SUBURBS.some((place) => hasPlace(location, place)));
  return [sydney && 'Sydney', melbourne && 'Melbourne'].filter(Boolean) as LocationCity[];
}

export function matchesCity(location: string | null | undefined, city: LocationCity): boolean {
  return locationCities(location).includes(city);
}

// --- Regional ------------------------------------------------------------------
// Regional means a Home Affairs designated regional area: anywhere in Australia
// outside the Sydney, Melbourne and Brisbane metros (so Perth, Adelaide,
// Canberra, Gold Coast, Newcastle, Wollongong, etc. all count). Brisbane has no
// chip of its own in the legacy Australian grouping, so it is only excluded here.
const BRISBANE_RE = /\bbrisbane\b/i;

// Named designated regional places, for postings that carry no postcode.
const REGIONAL_PLACES = [
  'Newcastle', 'Lake Macquarie', 'Maitland', 'Hunter', 'Wollongong', 'Illawarra', 'Shellharbour',
  'Central Coast', 'Gosford', 'South Coast', 'Albury', 'Wagga Wagga', 'Orange', 'Bathurst',
  'Dubbo', 'Tamworth', 'Port Macquarie', 'Coffs Harbour', 'Lismore', 'Byron Bay',
  'Canberra', 'Gold Coast', 'Sunshine Coast', 'Toowoomba', 'Cairns', 'Townsville', 'Mackay',
  'Rockhampton', 'Bundaberg', 'Geelong', 'Ballarat', 'Bendigo', 'Shepparton', 'Mildura',
  'Wodonga', 'Warrnambool', 'Perth', 'Fremantle', 'Adelaide', 'Hobart', 'Launceston',
  'Darwin', 'Alice Springs',
];

// A state/territory that has no non-regional metro: naming it alone is enough.
// NSW, VIC and QLD are deliberately absent: an unrecognised place there is
// most likely a metro suburb, so it stays unknown rather than Regional.
const ALL_REGIONAL_STATE_RE = /\b(WA|SA|TAS|ACT|NT|Western Australia|South Australia|Tasmania|Northern Territory|Australian Capital Territory)\b/i;

export function isRegionalAu(location: string | null | undefined): boolean {
  if (!location?.trim()) return false;
  if (locationCities(location).length > 0) return false;
  if (BRISBANE_RE.test(location)) return false;
  // Postcode is authoritative when present (Home Affairs lists are by postcode).
  const postcodes = postcodeClasses(location);
  if (postcodes.length > 0) return postcodes.every((cls) => cls === 'Regional');
  if (OVERSEAS_RE.test(location)) return false;
  if (REGIONAL_PLACES.some((place) => hasPlace(location, place))) return true;
  return ALL_REGIONAL_STATE_RE.test(location);
}

// --- Generic label (anywhere outside the Australian metros) ------------------
// AU recognition above stays authoritative. For every other posting we still
// want a short chip, so take the most specific named part: the first comma
// group (the city), with any trailing "(Hybrid)" note or " - Region" suffix
// removed. "Remote"/"Hybrid"/"On-site" on their own are kept as the label.
const WORK_MODE_RE = /^(remote|hybrid|on[\s-]?site|onsite|in[\s-]?office)$/i;

/** A short location chip label for a non-AU posting, or null when there is nothing to show. */
export function genericLocationLabel(location: string | null | undefined): string | null {
  const raw = (location || '').trim();
  if (!raw) return null;
  let first = raw.split(',')[0].trim();
  // "Remote - US", "Hybrid – London": keep only the part before a dash separator.
  first = first.split(/\s[-–—]\s/)[0].trim();
  // Drop a trailing parenthetical work mode, e.g. "Berlin (Hybrid)".
  first = first.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!first) return null;
  // Normalise the casing of a bare work-mode word so the chip reads cleanly.
  if (WORK_MODE_RE.test(first)) {
    const lower = first.toLowerCase();
    if (lower === 'remote') return 'Remote';
    if (lower === 'hybrid') return 'Hybrid';
    return 'On-site';
  }
  return first;
}

export function matchesLocationFilter(location: string | null | undefined, filter: LocationFilter): boolean {
  const value = filter.trim();
  if (!value) return true;
  if (value === 'Regional') return isRegionalAu(location);
  if (value === 'Sydney' || value === 'Melbourne') return matchesCity(location, value);
  return (location || '').toLocaleLowerCase().includes(value.toLocaleLowerCase());
}

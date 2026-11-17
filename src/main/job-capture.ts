// Quick add, the pure half: what is on the clipboard, what a job link really
// points at, and what a job page actually says. No Electron, no network, no DB,
// so every rule here is unit-tested (src/main/__tests__/quick-add-*.test.ts).
// The side effects (shortcut, clipboard, osascript, fetch, the in-app browser)
// live in quick-add.ts and quick-add-core.ts.
import { detectUrls, splitAddItems, bareUrl } from '../shared/add-input';

// ── Clipboard classification ────────────────────────────────────────────────

/** Words and phrases that mark text as a job ad. Counted by distinct match. */
const JOB_SIGNALS: RegExp[] = [
  /responsibilit/i, /requirement/i, /qualification/i, /\bexperience\b/i, /\bskills?\b/i,
  /\babout (the|this) (role|position|job|opportunity)\b/i, /\babout you\b/i, /what you('|’)ll (do|bring|need)/i,
  /\bwe('|’)re looking for\b|\bwe are looking for\b|\bwe('|’)re hiring\b|\bwe are hiring\b/i,
  /\bapply\b|\bapplication/i, /\bsalary\b|\$\s?\d{2,3}[,.]?\d{0,3}\s?k?\b|\bper (annum|hour|year)\b/i,
  /\bfull[- ]time\b|\bpart[- ]time\b|\bcontract\b|\bcasual\b|\bpermanent\b|\binternship\b|\bgraduate\b/i,
  /\bremote\b|\bhybrid\b|\bon[- ]site\b|\bin[- ]office\b/i, /\bbenefits?\b|\bperks\b/i,
  /\bcandidates?\b/i, /\byears? of\b/i, /\bteam\b/i, /\brole\b|\bposition\b|\bvacanc/i,
  /\b(developer|engineer|manager|analyst|designer|consultant|officer|coordinator|specialist|administrator|assistant|lead|architect|scientist|technician)\b/i,
];

/** How many distinct job signals the text carries. */
export function jobSignalCount(text: string): number {
  const t = String(text || '');
  return JOB_SIGNALS.reduce((n, re) => (re.test(t) ? n + 1 : n), 0);
}

export type ClipboardClass =
  | { kind: 'ad'; text: string; url: string | null }
  | { kind: 'url'; url: string; notes: string }
  | { kind: 'urls'; urls: string[] }
  | { kind: 'junk'; reason: 'empty' | 'too-short' | 'not-a-job' };

/** Hosts that only ever mean a job posting, whatever the path says. */
const JOB_HOSTS = /(^|\.)(linkedin\.com|seek\.com\.au|seek\.co\.nz|indeed\.[a-z.]+|jora\.com|myworkdayjobs\.com|myworkdaysite\.com|greenhouse\.io|lever\.co|smartrecruiters\.com|ashbyhq\.com|prosple\.com|gradconnection\.com|glassdoor\.[a-z.]+|careerone\.com\.au|workforceaustralia\.gov\.au|hatch\.team|workable\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|pageuppeople\.com|applynow\.net\.au|livehire\.com|jobadder\.com|breezy\.hr|wellfound\.com|ethicaljobs\.com\.au|apsjobs\.gov\.au|iworkfor\.nsw\.gov\.au)$/i;
const JOB_PATH = /job|career|position|vacanc|opening|posting|recruit|hiring|opportunit/i;

/** True when a URL is on a job board / ATS, or its path reads like a posting. */
export function looksLikeJobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (JOB_HOSTS.test(u.hostname)) return true;
    return JOB_PATH.test(u.pathname + u.search);
  } catch { return false; }
}

/** Minimum length for pasted text to be an ad on its own. */
const AD_MIN = 300;

/**
 * What the clipboard holds. A long text with job signals is an ad (any link in
 * it rides along as its URL); otherwise a link, with whatever else was copied
 * kept as notes; otherwise junk.
 */
export function classifyClipboard(raw: string): ClipboardClass {
  const text = String(raw || '').replace(/\u00a0/g, ' ').trim();
  if (!text) return { kind: 'junk', reason: 'empty' };
  const urls = detectUrls(text);
  const signals = jobSignalCount(text);
  const withoutUrls = urls.reduce((t, u) => t.split(u).join(' '), text).replace(/\s+/g, ' ').trim();

  if ((withoutUrls.length >= AD_MIN && signals >= 4) || (withoutUrls.length >= 800 && signals >= 2)) {
    const url = urls.find(looksLikeJobUrl) || null;
    return { kind: 'ad', text, url };
  }

  if (urls.length) {
    const items = splitAddItems(text);
    const bare = items.map(bareUrl).filter((u): u is string => !!u);
    if (items.length >= 2 && bare.length === items.length) return { kind: 'urls', urls: bare };
    const url = urls.find(looksLikeJobUrl) || urls[0];
    const notes = text.split(url).join(' ').replace(/[ \t]+/g, ' ').trim();
    return { kind: 'url', url, notes };
  }

  return { kind: 'junk', reason: text.length < AD_MIN ? 'too-short' : 'not-a-job' };
}

// ── URL normalisation ───────────────────────────────────────────────────────

const TRACKING_PARAMS = new Set([
  'trackingid', 'refid', 'ebp', 'trk', 'trkinfo', 'lipi', 'midtoken', 'midsig', 'originalsubdomain',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'igshid', 'yclid',
  'gh_src', 'lever-source', 'lever-origin', 'lever-source[]', 'ref', 'referrer', 'src', 'source',
  'sourcetype', 'origin', 'sol', 'tk', 'from', 'advn', 'adid', 'sid',
]);

/** Query params on redirectors that carry the real destination. */
const REDIRECT_PARAMS = ['url', 'u', 'q', 'dest', 'destination', 'redirect', 'redirect_url', 'redirecturl', 'target', 'to', 'r', 'link'];
const REDIRECT_HOSTS = /(^|\.)(google\.[a-z.]+|l\.facebook\.com|lm\.facebook\.com|out\.reddit\.com|jora\.com|linkedin\.com|indeed\.[a-z.]+|seek\.com\.au|safelinks\.protection\.outlook\.com|urldefense\.com)$/i;
const REDIRECT_PATH = /\/(url|redir|redirect|rd|out|go|l\.php|link|click|v\d\/url|safety\/go)(\/|$)/i;

function unwrapRedirect(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  if (!REDIRECT_HOSTS.test(host)) return null;
  // Only on paths that are redirectors, so a job URL that happens to carry a
  // `q=` search param is never swapped for it.
  if (!REDIRECT_PATH.test(u.pathname) && !/safelinks|urldefense/.test(host)) return null;
  for (const p of REDIRECT_PARAMS) {
    for (const [k, v] of u.searchParams) {
      if (k.toLowerCase() === p && /^https?:\/\//i.test(v)) return v;
    }
  }
  return null;
}

function stripTracking(u: URL): void {
  const drop: string[] = [];
  for (const k of u.searchParams.keys()) {
    const lk = k.toLowerCase();
    if (lk.startsWith('utm_') || TRACKING_PARAMS.has(lk)) drop.push(k);
  }
  for (const k of drop) u.searchParams.delete(k);
  u.hash = '';
}

/**
 * The canonical form of a job link: redirects unwrapped, search-page URLs turned
 * into the posting they have open, tracking stripped. Unknown sites keep their
 * path and meaningful params.
 */
export function normalizeJobUrl(raw: string, depth = 0): string {
  let u: URL;
  try { u = new URL(String(raw || '').trim()); } catch { return String(raw || '').trim(); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.toString();

  const inner = depth < 3 ? unwrapRedirect(u) : null;
  if (inner) return normalizeJobUrl(inner, depth + 1);

  const host = u.hostname.toLowerCase();
  const param = (name: string) => {
    for (const [k, v] of u.searchParams) if (k.toLowerCase() === name.toLowerCase() && v) return v;
    return null;
  };

  // LinkedIn: any currentJobId wins (search results, collections, recommended);
  // otherwise /jobs/view/<slug>-<id>.
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const cur = param('currentJobId');
    if (cur && /^\d+$/.test(cur)) return `https://www.linkedin.com/jobs/view/${cur}/`;
    const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})(\/|$)/);
    if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`;
  }

  // Seek: ?jobId=N on search pages, /job/N on the posting.
  if (/(^|\.)seek\.(com\.au|co\.nz)$/.test(host)) {
    const base = host.endsWith('.nz') ? 'https://www.seek.co.nz' : 'https://www.seek.com.au';
    const id = param('jobId');
    if (id && /^\d+$/.test(id)) return `${base}/job/${id}`;
    const m = u.pathname.match(/\/job\/(\d+)/);
    if (m) return `${base}/job/${m[1]}`;
  }

  // Indeed: jk / vjk on any page. Keep a country subdomain, default AU.
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    const jk = param('jk') || param('vjk');
    if (jk && /^[0-9a-f]{8,}$/i.test(jk)) {
      const cc = host.match(/^([a-z]{2})\.indeed\.com$/)?.[1];
      const origin = cc ? `https://${cc}.indeed.com` : /(^|\.)indeed\.com$/.test(host) ? 'https://au.indeed.com' : `https://${host}`;
      return `${origin}/viewjob?jk=${jk.toLowerCase()}`;
    }
  }

  // Jora: postings are /job/<slug>-<hex id>; everything in the query is tracking.
  if (/(^|\.)jora\.com$/.test(host) && /\/job\//.test(u.pathname)) {
    return `https://${host}${u.pathname.replace(/\/+$/, '')}`;
  }

  // Lever and Ashby: drop the /apply and /application tails and the query.
  if (/(^|\.)lever\.co$/.test(host) || /(^|\.)ashbyhq\.com$/.test(host)) {
    const path = u.pathname.replace(/\/(apply|application)\/?$/i, '').replace(/\/+$/, '');
    return `https://${host}${path}`;
  }

  // SmartRecruiters and Workday: the path is the posting; the query is tracking.
  if (/(^|\.)smartrecruiters\.com$/.test(host) || /(^|\.)myworkday(jobs|site)\.com$/.test(host)) {
    const path = u.pathname.replace(/\/(apply|login)(\/.*)?$/i, '').replace(/\/+$/, '');
    return `https://${host}${path}`;
  }

  // Greenhouse boards: /<company>/jobs/<id>. Company sites embedding it keep gh_jid.
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (m) return `https://${host}/${m[1]}/jobs/${m[2]}`;
  }

  stripTracking(u);
  return u.toString();
}

/**
 * One stable key per posting, for spotting a job the user already has. Board and ATS
 * links key on their job id; anything else on the normalised URL minus scheme,
 * www and trailing slash.
 */
export function jobKey(raw: string | null | undefined): string | null {
  if (!raw || !/^https?:\/\//i.test(String(raw).trim())) return null;
  const n = normalizeJobUrl(String(raw));
  let u: URL;
  try { u = new URL(n); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let m: RegExpMatchArray | null;
  if (/linkedin\.com$/.test(host) && (m = u.pathname.match(/\/jobs\/view\/(\d+)/))) return 'linkedin:' + m[1];
  if (/seek\.co(m\.au|\.nz)$/.test(host) && (m = u.pathname.match(/\/job\/(\d+)/))) return 'seek:' + m[1];
  if (/indeed\./.test(host) && u.searchParams.get('jk')) return 'indeed:' + u.searchParams.get('jk')!.toLowerCase();
  if (/greenhouse\.io$/.test(host) && (m = u.pathname.match(/\/jobs\/(\d+)/))) return 'greenhouse:' + m[1];
  const gh = u.searchParams.get('gh_jid');
  if (gh) return 'greenhouse:' + gh;
  if (/lever\.co$/.test(host) && (m = u.pathname.match(/\/([0-9a-f-]{36})/i))) return 'lever:' + m[1].toLowerCase();
  if (/ashbyhq\.com$/.test(host) && (m = u.pathname.match(/\/([0-9a-f-]{36})/i))) return 'ashby:' + m[1].toLowerCase();
  if (/smartrecruiters\.com$/.test(host) && (m = u.pathname.match(/\/(\d{9,})/))) return 'smartrecruiters:' + m[1];
  if (/jora\.com$/.test(host) && (m = u.pathname.match(/-([0-9a-f]{20,})$/i))) return 'jora:' + m[1].toLowerCase();
  const q = u.search && u.search !== '?' ? u.search : '';
  return (host + u.pathname.replace(/\/+$/, '') + q).toLowerCase();
}

/** The job source for a URL, from the app's JOB_SOURCES list, or null. */
export function sourceFromUrl(raw: string): string | null {
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return null; }
  const table: [RegExp, string][] = [
    [/(^|\.)seek\.co(m\.au|\.nz)$/, 'Seek'],
    [/(^|\.)linkedin\.com$/, 'LinkedIn'],
    [/(^|\.)indeed\./, 'Indeed'],
    [/(^|\.)jora\.com$/, 'Jora'],
    [/(^|\.)prosple\.com$/, 'Prosple'],
    [/(^|\.)gradconnection\.com$/, 'GradConnection'],
    [/(^|\.)glassdoor\./, 'Glassdoor'],
    [/(^|\.)careerone\.com\.au$/, 'CareerOne'],
    [/(^|\.)workforceaustralia\.gov\.au$/, 'Workforce Australia'],
    [/(^|\.)hatch\.team$/, 'Hatch'],
    [/(^|\.)(myworkday(jobs|site)\.com|greenhouse\.io|lever\.co|smartrecruiters\.com|ashbyhq\.com|workable\.com|bamboohr\.com|recruitee\.com|teamtailor\.com)$/, 'Company website'],
  ];
  for (const [re, name] of table) if (re.test(host)) return name;
  return null;
}

// ── A small, forgiving HTML parser ──────────────────────────────────────────
// Just enough of a DOM to find a container by attribute and read its text. The
// same code reads a plain fetch and the in-app browser's rendered outerHTML, so
// there is one extraction path, and it is testable on fixture files.

export interface HNode { tag: string; attrs: Record<string, string>; children: (HNode | string)[]; parent: HNode | null }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param', 'keygen']);
const RAW_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'textarea', 'canvas', 'object']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'blockquote', 'pre', 'form', 'fieldset', 'figure', 'figcaption', 'address']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™' };

export function decodeEntities(s: string): string {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : m; } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Parse HTML into a tree. Never throws; malformed markup degrades, it does not fail. */
export function parseHtml(html: string): HNode {
  const root: HNode = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const s = String(html || '');
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) cur.children.push(s.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      let n: HNode | null = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    if (!m[2]) continue; // comment, doctype, cdata
    const tag = m[2].toLowerCase();
    const attrSrc = m[3] || '';
    const selfClosing = /\/\s*$/.test(attrSrc);
    const node: HNode = { tag, attrs: parseAttrs(attrSrc.replace(/\/\s*$/, '')), children: [], parent: cur };
    if (RAW_TEXT.has(tag) && !selfClosing) {
      // Raw-text bodies are skipped wholesale; scripts keep theirs (JSON-LD).
      const close = new RegExp(`</\\s*${tag}\\s*>`, 'ig');
      close.lastIndex = re.lastIndex;
      const c = close.exec(s);
      if (tag === 'script') node.children.push(c ? s.slice(re.lastIndex, c.index) : '');
      cur.children.push(node);
      re.lastIndex = c ? close.lastIndex : s.length;
      last = re.lastIndex;
      continue;
    }
    if ((tag === 'p' || tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'option') && cur.tag === tag && cur.parent) {
      cur = cur.parent;
      node.parent = cur;
    }
    cur.children.push(node);
    if (!VOID.has(tag) && !selfClosing) cur = node;
  }
  if (last < s.length) cur.children.push(s.slice(last));
  return root;
}

/** Elements (depth-first) that satisfy the predicate. */
export function findAll(root: HNode, pred: (n: HNode) => boolean, out: HNode[] = []): HNode[] {
  for (const c of root.children) {
    if (typeof c === 'string') continue;
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

/** Tags whose text is never part of the posting. */
const CHROME = new Set(['nav', 'footer', 'aside', 'form', 'button', 'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select', 'textarea', 'dialog', 'head', 'title']);

function isChrome(n: HNode): boolean {
  return CHROME.has(n.tag) || n.attrs['aria-hidden'] === 'true' || n.attrs.hidden !== undefined
    || n.attrs.role === 'navigation' || n.attrs.role === 'banner' || n.attrs.role === 'contentinfo';
}

/** innerText-ish: block elements break lines, whitespace collapses, chrome dropped. */
export function textOf(node: HNode | string, keepChrome = false): string {
  const parts: string[] = [];
  const walk = (n: HNode | string) => {
    if (typeof n === 'string') { parts.push(decodeEntities(n).replace(/\s+/g, ' ')); return; }
    if (!keepChrome && isChrome(n)) return;
    if (n.tag === 'br') { parts.push('\n'); return; }
    const block = BLOCK.has(n.tag);
    if (block) parts.push('\n');
    if (n.tag === 'li') parts.push('- ');
    for (const c of n.children) walk(c);
    if (block) parts.push('\n');
  };
  walk(node);
  return parts.join('')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l !== '-').join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function linkTextLength(node: HNode): number {
  return findAll(node, (n) => n.tag === 'a').reduce((sum, a) => sum + textOf(a).length, 0);
}

// ── JSON-LD JobPosting ──────────────────────────────────────────────────────

export interface JobPostingLd {
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  employmentType: string | null;
  datePosted: string | null;
  validThrough: string | null;
  description: string | null;
  url: string | null;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) { const xs = v.map(str).filter(Boolean) as string[]; return xs.length ? xs.join(', ') : null; }
  if (typeof v === 'object' && 'name' in (v as any)) return str((v as any).name);
  return null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function isJobPosting(o: any): boolean {
  const t = o && o['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

function collectPostings(v: any, out: any[], depth = 0): void {
  if (!v || typeof v !== 'object' || depth > 6) return;
  if (Array.isArray(v)) { for (const x of v) collectPostings(x, out, depth + 1); return; }
  if (isJobPosting(v)) { out.push(v); return; }
  if (v['@graph']) collectPostings(v['@graph'], out, depth + 1);
  if (v.mainEntity) collectPostings(v.mainEntity, out, depth + 1);
}

function placeOf(loc: any): string | null {
  if (!loc) return null;
  if (typeof loc === 'string') return loc.trim() || null;
  if (Array.isArray(loc)) {
    const xs = Array.from(new Set(loc.map(placeOf).filter(Boolean) as string[]));
    return xs.length ? xs.join(' / ') : null;
  }
  const a = loc.address ?? loc;
  if (typeof a === 'string') return a.trim() || null;
  const bits = [str(a.addressLocality), str(a.addressRegion), str(a.addressCountry)].filter(Boolean) as string[];
  return bits.length ? Array.from(new Set(bits)).join(', ') : str(loc.name);
}

function salaryOf(bs: any): { text: string | null; min: number | null; max: number | null } {
  if (bs == null) return { text: null, min: null, max: null };
  if (typeof bs === 'string' || typeof bs === 'number') return { text: String(bs), min: num(bs), max: null };
  const b = Array.isArray(bs) ? bs[0] : bs;
  const cur = str(b?.currency) || '';
  const v = b?.value ?? b;
  let min = typeof v === 'object' ? num(v?.minValue ?? v?.value) : num(v);
  let max = typeof v === 'object' ? num(v?.maxValue) : null;
  if (min && max && min > max) [min, max] = [max, min];
  const unit = (typeof v === 'object' ? str(v?.unitText) : null) || str(b?.unitText);
  if (!min && !max) return { text: null, min: null, max: null };
  // Stored text, so one fixed format whatever the user's locale. Screens that
  // show a salary to the user format the numbers themselves.
  const fmt = (n: number) => n.toLocaleString('en-US');
  const range = [min, max].filter((x): x is number => !!x).map(fmt).join(' - ');
  const text = `${cur ? cur + ' ' : ''}${range}${unit ? ' per ' + unit.toLowerCase() : ''}`.trim();
  return { text, min, max };
}

/** The first JobPosting in the page's JSON-LD, flattened, or null. */
export function extractJsonLd(htmlOrTree: string | HNode): JobPostingLd | null {
  const tree = typeof htmlOrTree === 'string' ? parseHtml(htmlOrTree) : htmlOrTree;
  const scripts = findAll(tree, (n) => n.tag === 'script' && /ld\+json/i.test(n.attrs.type || ''));
  const postings: any[] = [];
  for (const s of scripts) {
    const body = String(s.children[0] || '').trim();
    if (!body) continue;
    let data: any = null;
    try { data = JSON.parse(body); } catch {
      // Some boards ship raw newlines inside strings; JSON forbids them.
      try { data = JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ')); } catch { data = null; }
    }
    collectPostings(data, postings);
  }
  const p = postings[0];
  if (!p) return null;
  const remote = /telecommute|remote/i.test(String(p.jobLocationType || ''));
  const loc = placeOf(p.jobLocation);
  const sal = salaryOf(p.baseSalary ?? p.estimatedSalary);
  const descRaw = str(p.description);
  // Descriptions arrive as HTML, or as entity-escaped HTML; both read as text.
  const descHtml = descRaw ? (/<[a-z]/i.test(descRaw) ? descRaw : decodeEntities(descRaw)) : null;
  const description = descHtml ? textOf(parseHtml(descHtml)) : null;
  const et = p.employmentType;
  const title = str(p.title);
  const company = str(p.hiringOrganization);
  return {
    title: title ? decodeEntities(title) : null,
    company: company ? decodeEntities(company) : null,
    location: [loc, remote ? 'Remote' : null].filter(Boolean).join(' / ') || null,
    salary: sal.text,
    salaryMin: sal.min,
    salaryMax: sal.max,
    employmentType: et ? (Array.isArray(et) ? et : [et]).map((x: any) => String(x).replace(/_/g, ' ').toLowerCase()).join(', ') : null,
    datePosted: str(p.datePosted),
    validThrough: str(p.validThrough),
    description: description || null,
    url: str(p.url),
  };
}

// ── The job container: site selectors, then a generic heuristic ────────────

/** An attribute test that is both a matcher here and a CSS selector in a page. */
export interface SiteSelector { attr: string; value: string; op: 'eq' | 'class' | 'contains' }

const sel = (attr: string, value: string, op: SiteSelector['op'] = 'eq'): SiteSelector => ({ attr, value, op });

/** Per-site description containers, best first. */
export const SITE_SELECTORS: { host: RegExp; selectors: SiteSelector[] }[] = [
  { host: /(^|\.)linkedin\.com$/, selectors: [sel('class', 'show-more-less-html__markup', 'class'), sel('class', 'description__text', 'class'), sel('class', 'jobs-description__content', 'class'), sel('id', 'job-details'), sel('class', 'jobs-box__html-content', 'class')] },
  { host: /(^|\.)seek\.co(m\.au|\.nz)$/, selectors: [sel('data-automation', 'jobAdDetails'), sel('data-automation', 'jobDescription')] },
  { host: /(^|\.)indeed\./, selectors: [sel('id', 'jobDescriptionText'), sel('class', 'jobsearch-JobComponent-description', 'class')] },
  { host: /(^|\.)jora\.com$/, selectors: [sel('id', 'job-description-container'), sel('class', 'job-description-container', 'class'), sel('class', 'job-view-content', 'class')] },
  { host: /(^|\.)myworkday(jobs|site)\.com$/, selectors: [sel('data-automation-id', 'jobPostingDescription'), sel('data-automation-id', 'job-posting-details')] },
  { host: /(^|\.)greenhouse\.io$/, selectors: [sel('class', 'job__description', 'class'), sel('id', 'content'), sel('class', 'job-post', 'class')] },
  { host: /(^|\.)lever\.co$/, selectors: [sel('data-qa', 'job-description'), sel('class', 'posting-page', 'class'), sel('class', 'content', 'class')] },
  { host: /(^|\.)smartrecruiters\.com$/, selectors: [sel('itemprop', 'description'), sel('class', 'job-sections', 'class'), sel('class', 'jobad-main', 'class')] },
  { host: /(^|\.)ashbyhq\.com$/, selectors: [sel('class', 'ashby-job-posting-right-pane', 'class'), sel('class', '_descriptionText', 'contains'), sel('class', 'job-posting', 'contains')] },
];

/** Generic containers any site might use, tried after the site's own. */
export const GENERIC_SELECTORS: SiteSelector[] = [
  sel('itemprop', 'description'), sel('id', 'job-description'), sel('class', 'job-description', 'class'),
  sel('id', 'jobDescription'), sel('class', 'jobDescription', 'class'), sel('data-testid', 'job-description'),
];

export function siteSelectorsFor(url: string): SiteSelector[] {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* none */ }
  return SITE_SELECTORS.find((s) => s.host.test(host))?.selectors || [];
}

/** A selector as CSS, for the in-page "has it rendered yet" check. */
export function toCss(s: SiteSelector): string {
  const v = s.value.replace(/["\\]/g, '');
  if (s.op === 'class') return `.${s.value.replace(/[^\w-]/g, '')}`;
  if (s.op === 'contains') return `[${s.attr}*="${v}"]`;
  return `[${s.attr}="${v}"]`;
}

function matches(n: HNode, s: SiteSelector): boolean {
  const v = n.attrs[s.attr];
  if (v == null) return false;
  if (s.op === 'eq') return v === s.value;
  if (s.op === 'class') return v.split(/\s+/).includes(s.value);
  return v.includes(s.value);
}

/**
 * The page's main text: descend from <body> into whichever child holds most of
 * the readable (non-link) text, and stop where the text splits. Nav, footer,
 * forms and link farms ("similar jobs") fall away on the way down.
 */
export function mainContainerText(tree: HNode): string {
  const body = findAll(tree, (n) => n.tag === 'body')[0] || tree;
  const weight = (n: HNode) => Math.max(0, textOf(n).length - linkTextLength(n) * 1.5);
  let node = body;
  for (let guard = 0; guard < 80; guard++) {
    const kids = node.children.filter((c): c is HNode => typeof c !== 'string' && !isChrome(c));
    if (!kids.length) break;
    const total = weight(node);
    if (total <= 0) break;
    let best: HNode | null = null;
    let bestW = 0;
    for (const k of kids) { const w = weight(k); if (w > bestW) { bestW = w; best = k; } }
    // Keep going only while one child is clearly the page, and big enough to be a posting.
    if (!best || bestW < total * 0.72 || textOf(best).length < 250) break;
    node = best;
  }
  // The descent can step past the posting's own heading into its body; climb
  // back one level when that is all the parent adds.
  const up = node.parent;
  if (up && node !== body && up !== body && weight(up) <= weight(node) * 1.35) {
    const inside = (h: HNode) => { for (let p: HNode | null = h; p; p = p.parent) if (p === node) return true; return false; };
    if (findAll(up, (n) => /^h[1-3]$/.test(n.tag)).some((h) => !inside(h))) node = up;
  }
  return textOf(node);
}

export interface PageCapture {
  url: string;
  title: string | null;
  jsonLd: JobPostingLd | null;
  /** The description container's text (site selector, generic selector or heuristic). */
  mainText: string;
  /** Where mainText came from, for the log. */
  via: 'site' | 'generic' | 'heuristic' | 'none';
  loginWall: boolean;
}

function metaContent(tree: HNode, key: string): string | null {
  const m = findAll(tree, (n) => n.tag === 'meta' && (n.attrs.property === key || n.attrs.name === key))[0];
  return m?.attrs.content?.trim() || null;
}

/** Everything a job page tells us, from its HTML. */
export function extractPage(html: string, url: string): PageCapture {
  const tree = parseHtml(html);
  const jsonLd = extractJsonLd(tree);
  const titleNode = findAll(tree, (n) => n.tag === 'title')[0];
  const title = metaContent(tree, 'og:title') || (titleNode ? textOf(titleNode, true) : '') || null;

  let mainText = '';
  let via: PageCapture['via'] = 'none';
  const tiers: [PageCapture['via'], SiteSelector[]][] = [['site', siteSelectorsFor(url)], ['generic', GENERIC_SELECTORS]];
  for (const [tier, list] of tiers) {
    for (const s of list) {
      if (mainText) break;
      const hit = findAll(tree, (n) => matches(n, s)).map((n) => textOf(n)).sort((a, b) => b.length - a.length)[0];
      if (hit && hit.length >= 200) { mainText = hit; via = tier; }
    }
  }
  if (!mainText) {
    const h = mainContainerText(tree);
    if (h) { mainText = h; via = 'heuristic'; }
  }
  // The posting's heading usually sits outside its description container.
  const h1 = findAll(tree, (n) => n.tag === 'h1').map((n) => textOf(n)).find((t) => t.length > 2 && t.length < 160) || null;
  if (h1 && mainText && !mainText.includes(h1)) mainText = h1 + '\n\n' + mainText;

  return {
    url,
    title: title ? decodeEntities(title) : null,
    jsonLd,
    mainText: mainText.slice(0, 20000),
    via,
    loginWall: looksLikeLoginWall(url, textOf(tree), mainText),
  };
}

/** A sign-in page, or a posting hidden behind one. */
export function looksLikeLoginWall(url: string, pageText: string, mainText = ''): boolean {
  if (/\/(authwall|login|signin|sign-in|uas\/login|checkpoint)(\/|\?|$)/i.test(url)) return true;
  const t = String(pageText || '').slice(0, 8000);
  const wall = /(sign in|log in|login|join now|create (an |a free )?account) to (see|view|continue|apply)|join linkedin|authwall|you must be signed in|please (sign|log) in/i.test(t);
  return wall && mainText.length < 1200;
}

/** Enough to extract a real job from, without guessing. */
export function isSufficient(cap: Pick<PageCapture, 'jsonLd' | 'mainText' | 'loginWall'> | null | undefined): boolean {
  if (!cap) return false;
  if (cap.jsonLd?.title && (cap.jsonLd.description || '').length >= 300) return true;
  const t = cap.mainText || '';
  if (cap.loginWall) return false;
  return t.length >= 600 && jobSignalCount(t) >= 3;
}

/** A score for picking the better of two captures of the same page. */
export function captureScore(cap: PageCapture | null | undefined): number {
  if (!cap) return -Infinity;
  let s = Math.min(cap.mainText.length, 8000) / 100;
  if (cap.jsonLd?.title) s += 50;
  if (cap.jsonLd?.description) s += 30;
  if (cap.via === 'site') s += 20;
  if (cap.loginWall) s -= 40;
  return s;
}

/**
 * The text handed to the existing extraction: structured facts first (from
 * JSON-LD when the page ships it, which is the most reliable source), then the
 * posting itself, then anything the user copied alongside the link.
 */
export function composeJobText(input: { url: string; capture?: PageCapture | null; notes?: string; tabTitle?: string | null }): string {
  const cap = input.capture;
  const ld = cap?.jsonLd;
  const lines: string[] = [];
  if (ld?.title || ld?.company) lines.push([ld.title, ld.company].filter(Boolean).join(' at '));
  else if (cap?.title || input.tabTitle) lines.push(String(cap?.title || input.tabTitle));
  if (ld?.location) lines.push('Location: ' + ld.location);
  if (ld?.salary) lines.push('Salary: ' + ld.salary);
  if (ld?.employmentType) lines.push('Employment type: ' + ld.employmentType);
  if (ld?.datePosted) lines.push('Posted: ' + ld.datePosted);
  if (ld?.validThrough) lines.push('Closes: ' + ld.validThrough);
  lines.push('Job URL: ' + input.url);

  const ldDesc = ld?.description || '';
  const main = cap?.mainText || '';
  // JSON-LD's description is the cleanest copy; the container wins only when it
  // clearly holds more (some boards truncate the structured one).
  const body = ldDesc && ldDesc.length * 1.5 >= main.length ? ldDesc : main || ldDesc;
  const parts = [lines.join('\n'), body.trim()];
  if (input.notes && input.notes.trim()) parts.push('Notes: ' + input.notes.trim());
  return parts.filter(Boolean).join('\n\n').slice(0, 12000);
}

// ── Page titles, for when the page itself cannot be read ────────────────────

/** Role and company out of a board's page/tab title, best effort. */
export function parseJobTitle(title: string | null | undefined): { role: string | null; company: string | null } {
  let t = decodeEntities(String(title || '')).replace(/\s+/g, ' ').trim();
  if (!t) return { role: null, company: null };
  t = t.replace(/^\(\d+\)\s*/, '') // "(3) " notification counts
    .replace(/\s*[|\-–—]\s*(LinkedIn|SEEK|Indeed(\.com)?|Jora|Glassdoor|Greenhouse|Lever|Workday|SmartRecruiters|Ashby|Careers?)\s*$/i, '')
    .trim();
  let m = t.match(/^(.+?) hiring (.+?)(?: in (.+))?$/i); // LinkedIn: "Acme hiring Dev in Sydney"
  if (m) return { company: m[1].trim(), role: m[2].trim() };
  m = t.match(/^(.+?) Job in (.+)$/i); // Seek: "Dev Job in Sydney NSW"
  if (m) return { role: m[1].trim(), company: null };
  m = t.match(/^(?:Job Application for |Job: )?(.+?) (?:at|@) (.+?)$/i); // Greenhouse "Job Application for X at Y"
  if (m) return { role: m[1].trim(), company: m[2].replace(/\s+[|\-–—]\s+.*$/, '').trim() };
  m = t.match(/^(.+?)\s+[|\-–—]\s+(.+?)(?:\s+[|\-–—]\s+.+)?$/);
  if (m) return { role: m[1].trim(), company: m[2].trim() };
  return { role: t, company: null };
}

// ── Duplicates ──────────────────────────────────────────────────────────────

export interface ExistingApp { id: string; company: string; job_title: string; job_url?: string | null }

const COMPANY_SUFFIX = /\b(pty|ltd|limited|inc|incorporated|llc|plc|co|corp|corporation|group|holdings|australia|au|the)\b/g;
export function companyKey(c: string | null | undefined): string {
  return String(c || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(COMPANY_SUFFIX, ' ').replace(/\s+/g, '');
}
export function titleKey(t: string | null | undefined): string {
  return String(t || '').toLowerCase().replace(/\bsr\b\.?/g, 'senior').replace(/\bjr\b\.?/g, 'junior').replace(/[^a-z0-9]/g, '');
}

/**
 * An application the user already has for this posting: the same job id / URL, or
 * the same company and title. Company alone is never enough (two roles at one
 * company are two applications).
 */
export function findDuplicate(candidate: { url?: string | null; company?: string | null; title?: string | null }, existing: ExistingApp[], excludeId?: string): ExistingApp | null {
  const key = jobKey(candidate.url);
  if (key) {
    for (const a of existing) {
      if (a.id !== excludeId && a.job_url && jobKey(a.job_url) === key) return a;
    }
  }
  const ck = companyKey(candidate.company);
  const tk = titleKey(candidate.title);
  if (!ck || !tk) return null;
  for (const a of existing) {
    if (a.id !== excludeId && companyKey(a.company) === ck && titleKey(a.job_title) === tk) return a;
  }
  return null;
}

// ── The frontmost browser, via AppleScript ──────────────────────────────────

const CHROMIUM = ['com.google.Chrome', 'com.google.Chrome.beta', 'com.google.Chrome.dev', 'com.google.Chrome.canary', 'com.brave.Browser', 'com.brave.Browser.beta', 'com.microsoft.edgemac', 'com.microsoft.edgemac.Beta', 'com.vivaldi.Vivaldi', 'company.thebrowser.Browser', 'org.chromium.Chromium', 'com.operasoftware.Opera'];
const SAFARI = ['com.apple.Safari', 'com.apple.SafariTechnologyPreview'];

/** AppleScript that returns "URL<LF>TITLE" of the front tab, per browser bundle id. */
export function browserScriptFor(bundleId: string): string | null {
  const id = String(bundleId || '').trim();
  if (!/^[\w.-]+$/.test(id)) return null;
  if (CHROMIUM.includes(id)) {
    return `tell application id "${id}"\nif (count of windows) is 0 then return ""\nset t to active tab of front window\nreturn (URL of t) & linefeed & (title of t)\nend tell`;
  }
  if (SAFARI.includes(id)) {
    return `tell application id "${id}"\nif (count of windows) is 0 then return ""\nset t to current tab of front window\nreturn (URL of t) & linefeed & (name of t)\nend tell`;
  }
  return null;
}

/** A friendly browser name, for notifications. */
export function browserName(bundleId: string): string {
  const names: Record<string, string> = {
    'com.google.Chrome': 'Google Chrome', 'com.brave.Browser': 'Brave Browser', 'com.microsoft.edgemac': 'Microsoft Edge',
    'company.thebrowser.Browser': 'Arc', 'com.apple.Safari': 'Safari', 'com.vivaldi.Vivaldi': 'Vivaldi', 'com.operasoftware.Opera': 'Opera',
  };
  return names[bundleId] || String(bundleId || '').split('.').slice(-1)[0] || 'your browser';
}

export type TabResult =
  | { ok: true; url: string; title: string | null; browser: string }
  | { ok: false; reason: 'not-a-browser' | 'denied' | 'no-tab' | 'failed'; browser?: string; detail?: string };

/** Read osascript's answer (or its error) into a TabResult. */
export function parseTabResult(bundleId: string, stdout: string, error: { message?: string; stderr?: string } | null): TabResult {
  const browser = browserName(bundleId);
  if (error) {
    const msg = `${error.stderr || ''} ${error.message || ''}`;
    if (/-1743|not authori[sz]ed|not allowed to send apple ?events/i.test(msg)) return { ok: false, reason: 'denied', browser };
    if (/-1728|-1719|-600|can.t get (active|current) tab|no window/i.test(msg)) return { ok: false, reason: 'no-tab', browser };
    return { ok: false, reason: 'failed', browser, detail: msg.trim().slice(0, 200) };
  }
  const [url, ...rest] = String(stdout || '').trim().split(/\r?\n/);
  if (!url || !/^https?:\/\//i.test(url.trim())) return { ok: false, reason: 'no-tab', browser };
  return { ok: true, url: url.trim(), title: rest.join(' ').trim() || null, browser };
}

/** The bundle id out of `lsappinfo info -only bundleid <asn>` output. */
export function parseLsappinfoBundle(out: string): string | null {
  const m = String(out || '').match(/"CFBundleIdentifier"\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

// ── Shortcut display ────────────────────────────────────────────────────────

/** An Electron accelerator as the user would read it: "Control+Command+J" -> "⌃⌘J" on a Mac. */
export function acceleratorLabel(accel: string, platform: string = process.platform): string {
  const parts = String(accel || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return 'the quick-add shortcut';
  if (platform !== 'darwin') {
    return parts.map((p) => (/^(CommandOrControl|CmdOrCtrl)$/i.test(p) ? 'Ctrl' : p)).join('+');
  }
  const mac: Record<string, string> = {
    control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', command: '⌘', cmd: '⌘',
    commandorcontrol: '⌘', cmdorctrl: '⌘', super: '⌘', meta: '⌘',
  };
  const order = ['⌃', '⌥', '⇧', '⌘'];
  const mods = parts.slice(0, -1).map((p) => mac[p.toLowerCase()] || p);
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return mods.join('') + parts[parts.length - 1].toUpperCase();
}

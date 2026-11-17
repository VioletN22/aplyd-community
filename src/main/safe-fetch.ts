// Fetching pages from URLs the app did not choose (portfolio links, search
// results, job links pasted by the user) without letting them reach this
// computer or its network: loopback, private LAN ranges, link-local, cloud
// metadata, multicast and so on.
//
// The address is checked when the socket connects, not only before. A custom
// `lookup` resolves the name once, refuses the request if any answer is a
// blocked address, and hands the checked address to the socket. The request
// still carries the hostname, so the Host header and TLS SNI are unchanged.
// Every redirect hop goes through the same check.
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';

// ── Address classification ─────────────────────────────────────────────────

function v4Reason(o: number[]): string | null {
  const [a, b] = o;
  if (a === 0) return 'this network (0.0.0.0/8)';
  if (a === 10) return 'private (10.0.0.0/8)';
  if (a === 100 && b >= 64 && b <= 127) return 'shared address space (100.64.0.0/10)';
  if (a === 127) return 'loopback (127.0.0.0/8)';
  if (a === 169 && b === 254) return 'link-local and metadata (169.254.0.0/16)';
  if (a === 172 && b >= 16 && b <= 31) return 'private (172.16.0.0/12)';
  if (a === 192 && b === 0 && o[2] === 0) return 'protocol assignments (192.0.0.0/24)';
  if (a === 192 && b === 168) return 'private (192.168.0.0/16)';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmarking (198.18.0.0/15)';
  if (a >= 224 && a <= 239) return 'multicast (224.0.0.0/4)';
  if (a >= 240) return 'reserved and broadcast (240.0.0.0/4)';
  return null;
}

function parseV4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x <= 255) ? o : null;
}

// Eight 16-bit groups, or null when the text is not an IPv6 address.
function parseV6(s: string): number[] | null {
  let text = s.replace(/%.*$/, ''); // zone id (fe80::1%en0)
  if (!net.isIPv6(text)) return null;
  // A trailing dotted IPv4 becomes two hex groups.
  const dotted = text.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const o = parseV4(dotted[2]);
    if (!o) return null;
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function v4From(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

/**
 * Why an address must not be fetched, or null when it is a public address.
 * Anything that does not parse as an IP address is refused.
 */
export function blockedAddressReason(ip: string): string | null {
  const a = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!a) return 'empty address';
  const v4 = parseV4(a);
  if (v4) return v4Reason(v4);
  const g = parseV6(a);
  if (!g) return 'not an IP address';

  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (g.every((x) => x === 0)) return 'unspecified (::)';
  if (zeros(7) && g[7] === 1) return 'loopback (::1)';
  if ((g[0] & 0xffc0) === 0xfe80) return 'link-local (fe80::/10)';
  if ((g[0] & 0xffc0) === 0xfec0) return 'site-local (fec0::/10)';
  if ((g[0] & 0xfe00) === 0xfc00) return 'unique local (fc00::/7)';
  if ((g[0] & 0xff00) === 0xff00) return 'multicast (ff00::/8)';

  // Forms that carry an IPv4 address: judge the IPv4 address inside.
  const inner = (why: string, o: number[]) => {
    const r = v4Reason(o);
    return r ? `${why} ${r}` : null;
  };
  if (zeros(5) && g[5] === 0xffff) return inner('IPv4-mapped', v4From(g[6], g[7]));
  if (zeros(4) && g[4] === 0xffff && g[5] === 0) return inner('IPv4-translated', v4From(g[6], g[7]));
  if (zeros(6)) return inner('IPv4-compatible', v4From(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return inner('NAT64', v4From(g[6], g[7]));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return 'local-use NAT64 (64:ff9b:1::/48)';
  if (g[0] === 0x2002) return inner('6to4', v4From(g[1], g[2]));
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  return blockedAddressReason(ip) !== null;
}

// ── Connect-time lookup ────────────────────────────────────────────────────

export interface ResolvedAddress { address: string; family: number }
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = (host) => new Promise((resolve, reject) => {
  dns.lookup(host, { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs || [])));
});

type LookupCallback = (err: Error | null, address: string | ResolvedAddress[], family?: number) => void;

/**
 * A `lookup` for http.request: resolves once, refuses the whole answer if any
 * address is blocked, and returns only the checked address.
 */
export function guardedLookup(resolver: Resolver = systemResolver, blocked: (ip: string) => boolean = isBlockedAddress) {
  return (hostname: string, options: unknown, callback?: LookupCallback): void => {
    const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
    const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    resolver(hostname).then((addrs) => {
      if (!addrs.length) throw new Error(`No address for ${hostname}`);
      const bad = addrs.find((x) => blocked(x.address));
      if (bad) throw new Error(`Refused ${hostname}: ${bad.address} is not a public address`);
      const pick = addrs[0];
      if (all) cb(null, [pick]);
      else cb(null, pick.address, pick.family);
    }).catch((err: Error) => cb(err, all ? [] : '', 0));
  };
}

// ── Fetch ──────────────────────────────────────────────────────────────────

export const MAX_REDIRECTS = 4;

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
  resolver?: Resolver;
  /** Tests only: replace the address rule. */
  blocked?: (ip: string) => boolean;
}

// Scheme and literal-address check. Names are checked at connect time.
export function urlShapeAllowed(rawUrl: string, blocked: (ip: string) => boolean = isBlockedAddress): boolean {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (net.isIP(host)) return !blocked(host);
  return true;
}

/**
 * GET a public http(s) URL and return the body as text, or '' on any failure,
 * refusal or timeout. Never rejects.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions, depth = 0): Promise<string> {
  const blocked = opts.blocked || isBlockedAddress;
  const resolver = opts.resolver || systemResolver;
  if (depth > MAX_REDIRECTS) return '';
  if (!urlShapeAllowed(url, blocked)) return '';
  // Early refusal for names that plainly point inward. Not relied on: the
  // address actually used is checked again by the lookup at connect time.
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) {
    const early = await resolver(host).catch(() => [] as ResolvedAddress[]);
    if (!early.length || early.some((x) => blocked(x.address))) return '';
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (s: string) => { if (!done) { done = true; resolve(s); } };
    try {
      const lib = url.startsWith('https:') ? https : http;
      const req = lib.get(url, {
        headers: opts.headers,
        lookup: guardedLookup(resolver, blocked) as unknown as net.LookupFunction,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let next: string;
          try { next = new URL(res.headers.location, url).toString(); } catch { finish(''); return; }
          safeFetch(next, opts, depth + 1).then(finish);
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { if (data.length < opts.maxBytes) data += c; });
        res.on('end', () => finish(data));
        res.on('error', () => finish(''));
      });
      req.setTimeout(opts.timeoutMs, () => { req.destroy(); finish(''); });
      req.on('error', () => finish(''));
    } catch { finish(''); }
  });
}

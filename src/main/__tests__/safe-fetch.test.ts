import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  blockedAddressReason, isBlockedAddress, guardedLookup, safeFetch, urlShapeAllowed,
  type Resolver,
} from '../safe-fetch';

describe('blockedAddressReason', () => {
  const blocked: [string, string][] = [
    ['0.0.0.0', 'this network'],
    ['0.1.2.3', 'this network'],
    ['10.0.0.1', 'private'],
    ['100.64.0.1', 'shared address space'],
    ['100.127.255.255', 'shared address space'],
    ['127.0.0.1', 'loopback'],
    ['127.8.9.10', 'loopback'],
    ['169.254.169.254', 'link-local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['[::1]', 'loopback'],
    ['fe80::1', 'link-local'],
    ['febf:ffff::1', 'link-local'],
    ['fe80::1%en0', 'link-local'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped'],
    ['::ffff:7f00:1', 'IPv4-mapped'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped'],
    ['0:0:0:0:0:ffff:c0a8:0101', 'IPv4-mapped'],
    ['::127.0.0.1', 'IPv4-compatible'],
    ['::a00:1', 'IPv4-compatible'],
    ['64:ff9b::127.0.0.1', 'NAT64'],
    ['64:ff9b::a9fe:a9fe', 'NAT64'],
    ['64:ff9b:1::1', 'NAT64'],
    ['2002:7f00:1::1', '6to4'],
    ['', 'empty'],
    ['not-an-ip', 'not an IP'],
    ['256.1.1.1', 'not an IP'],
  ];
  it.each(blocked)('refuses %s', (ip, why) => {
    expect(blockedAddressReason(ip)).toContain(why);
    expect(isBlockedAddress(ip)).toBe(true);
  });

  const allowed = [
    '1.1.1.1', '8.8.8.8', '93.184.216.34', '100.63.255.255', '100.128.0.1',
    '172.15.255.255', '172.32.0.1', '198.17.255.255', '198.20.0.1', '223.255.255.255',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808',
    '2002:808:808::1', 'fec0::1'.replace('fec0', '2a00'),
  ];
  it.each(allowed)('allows %s', (ip) => {
    expect(blockedAddressReason(ip)).toBeNull();
  });
});

describe('urlShapeAllowed', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://example.com', true],
    ['ftp://example.com', false],
    ['file:///etc/passwd', false],
    ['http://localhost:3000', false],
    ['http://app.localhost', false],
    ['http://127.0.0.1/', false],
    ['http://0x7f000001/', false],
    ['http://[::1]/', false],
    ['http://[::ffff:7f00:1]/', false],
    ['http://8.8.8.8/', true],
    ['not a url', false],
  ])('%s -> %s', (url, ok) => {
    expect(urlShapeAllowed(url)).toBe(ok);
  });
});

describe('guardedLookup', () => {
  const run = (resolver: Resolver, all: boolean) => new Promise<{ err: Error | null; address: unknown; family?: number }>((resolve) => {
    guardedLookup(resolver)('jobs.example', { all }, (err, address, family) => resolve({ err, address, family }));
  });

  it('hands back only the checked address', async () => {
    const r = await run(async () => [{ address: '93.184.216.34', family: 4 }, { address: '1.1.1.1', family: 4 }], false);
    expect(r.err).toBeNull();
    expect(r.address).toBe('93.184.216.34');
    expect(r.family).toBe(4);
  });

  it('answers in list form when asked for all addresses', async () => {
    const r = await run(async () => [{ address: '2606:4700:4700::1111', family: 6 }], true);
    expect(r.err).toBeNull();
    expect(r.address).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
  });

  it('refuses when any answer is private', async () => {
    const r = await run(async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], true);
    expect(r.err?.message).toMatch(/not a public address/);
  });

  it('refuses an empty answer', async () => {
    const r = await run(async () => [], false);
    expect(r.err).toBeTruthy();
  });
});

describe('safeFetch', () => {
  let server: http.Server | null = null;
  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(r));
    server = null;
  });

  // A local server that counts the requests it receives.
  async function start(handler?: http.RequestListener) {
    const hits: string[] = [];
    server = http.createServer((req, res) => {
      hits.push(req.url || '');
      if (handler) handler(req, res);
      else res.end('secret local page');
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return { hits, port };
  }

  it('refuses a name that answers public first and loopback second', async () => {
    const { hits, port } = await start();
    let calls = 0;
    const resolver: Resolver = async () => {
      calls += 1;
      return calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    };
    const body = await safeFetch(`http://rebind.example:${port}/`, { timeoutMs: 2000, maxBytes: 1000, resolver });
    expect(body).toBe('');
    expect(hits).toEqual([]);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('refuses a name that always answers loopback', async () => {
    const { hits, port } = await start();
    const resolver: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    expect(await safeFetch(`http://inside.example:${port}/`, { timeoutMs: 2000, maxBytes: 1000, resolver })).toBe('');
    expect(hits).toEqual([]);
  });

  it('connects to the checked address and keeps the hostname in the Host header', async () => {
    let host = '';
    const { hits, port } = await start((req, res) => { host = String(req.headers.host); res.end('hello'); });
    const resolver: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    const body = await safeFetch(`http://jobs.example:${port}/x`, { timeoutMs: 2000, maxBytes: 1000, resolver, blocked: () => false });
    expect(body).toBe('hello');
    expect(hits).toEqual(['/x']);
    expect(host).toBe(`jobs.example:${port}`);
  });

  it('checks the address again on every redirect hop', async () => {
    let lockDown = false;
    const { hits, port } = await start((req, res) => {
      if (req.url === '/start') {
        lockDown = true;
        res.writeHead(302, { location: `http://next.example:${port}/inside` });
        res.end();
      } else res.end('should not be read');
    });
    const resolver: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    const body = await safeFetch(`http://jobs.example:${port}/start`, {
      timeoutMs: 2000, maxBytes: 1000, resolver, blocked: () => lockDown,
    });
    expect(body).toBe('');
    expect(hits).toEqual(['/start']);
  });

  it('refuses a redirect to a literal loopback address', async () => {
    const { hits, port } = await start((req, res) => {
      if (req.url === '/start') { res.writeHead(301, { location: `http://127.0.0.1:${port}/inside` }); res.end(); }
      else res.end('should not be read');
    });
    const resolver: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    // The first hop is let through by a rule that only trusts the name lookup;
    // the literal address in the redirect is checked with the real rule.
    const blocked = (ip: string) => hits.length > 0 && isBlockedAddress(ip);
    const body = await safeFetch(`http://jobs.example:${port}/start`, { timeoutMs: 2000, maxBytes: 1000, resolver, blocked });
    expect(body).toBe('');
    expect(hits).toEqual(['/start']);
  });
});

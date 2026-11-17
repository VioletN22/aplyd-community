import { describe, it, expect } from 'vitest';
import { ENVELOPE_QUERY, SOURCE_QUERY, startUidFor, explainImapFailure, bodyTextOf } from '../email/imap';

// imapflow's own FETCH command builder, driven with a fake connection so the
// exact wire attributes can be inspected. This is the proof that the body pass
// is BODY.PEEK[] (does not set \Seen) rather than BODY[].
// eslint-disable-next-line @typescript-eslint/no-var-requires
const imapFetch = require('imapflow/lib/commands/fetch.js').default as (c: any, r: any, q: any, o?: any) => Promise<any>;

async function wireAttributes(query: any, capabilities: string[] = []): Promise<any[]> {
  let captured: any[] = [];
  const conn: any = {
    state: 3, states: { SELECTED: 3 },
    capabilities: new Set(capabilities), enabled: new Set(), mailbox: { path: 'INBOX' },
    log: { warn() {}, debug() {} },
    exec: async (_cmd: string, attributes: any[]) => { captured = attributes; return { next() {} }; },
  };
  await imapFetch(conn, '1:5', query, { uid: true });
  return captured;
}

const atoms = (x: any): string[] => {
  if (Array.isArray(x)) return x.flatMap(atoms);
  if (x && typeof x === 'object') return [String(x.value), ...atoms(x.section ?? [])];
  return [];
};

describe('imap read-only proof', () => {
  it('the source fetch goes out as BODY.PEEK, never BODY[]', async () => {
    const a = atoms(await wireAttributes(SOURCE_QUERY));
    expect(a).toContain('BODY.PEEK');
    expect(a).not.toContain('BODY');
    // Gmail capability set changes nothing about that.
    const g = atoms(await wireAttributes(SOURCE_QUERY, ['X-GM-EXT-1', 'BINARY']));
    expect(g.filter((x) => x.startsWith('BODY') || x.startsWith('BINARY'))).toEqual(['BODY.PEEK']);
  });

  it('the envelope pass requests no body section at all', async () => {
    const a = atoms(await wireAttributes(ENVELOPE_QUERY));
    expect(a.some((x) => x.startsWith('BODY') || x.startsWith('BINARY') || x === 'RFC822')).toBe(false);
    expect(a).toContain('ENVELOPE');
  });
});

describe('watermarks', () => {
  it('resumes from the watermark while uidValidity holds, restarts when it changes', () => {
    expect(startUidFor(null, 7)).toBe(0);
    expect(startUidFor({ uidValidity: 7, lastUid: 420 }, 7)).toBe(420);
    expect(startUidFor({ uidValidity: 7, lastUid: 420 }, 8)).toBe(0);
  });
});

describe('explainImapFailure', () => {
  const acct = { email: 'me@gmail.com', provider: 'gmail' };
  it('names the app password for an auth failure', () => {
    expect(explainImapFailure({ authenticationFailed: true }, acct)).toMatch(/app password/);
    expect(explainImapFailure(new Error('Command failed'), acct)).toMatch(/apppasswords/);
  });
  it('names the network for DNS and timeouts', () => {
    expect(explainImapFailure(new Error('getaddrinfo ENOTFOUND imap.gmail.com'), acct)).toMatch(/gmail\.com/);
    expect(explainImapFailure(new Error('ETIMEDOUT'), acct)).toMatch(/did not answer/);
  });
});

describe('bodyTextOf', () => {
  it('prefers text, falls back to stripped HTML', () => {
    expect(bodyTextOf({ text: ' hi ', html: '<b>x</b>' })).toBe('hi');
    expect(bodyTextOf({ text: '', html: '<style>p{}</style><p>Thanks&nbsp;for applying</p>' })).toBe('Thanks for applying');
  });
});

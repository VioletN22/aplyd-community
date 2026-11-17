// IMAP ingest for inbox sync: Gmail with an app password.
//
// Strictly read-only. Every mailbox is opened with EXAMINE (readOnly: true),
// which the server itself enforces: no flag, including \Seen, can change in a
// read-only session. On top of that, imapflow issues full-source fetches as
// BODY.PEEK[] (commands/fetch.js, setBodyPeek), which is the non-marking form
// even in a read-write session. email-imap.test.ts drives imapflow's own fetch
// command with a fake connection and asserts the wire atom is BODY.PEEK. Nothing
// here stores flags, moves, copies, deletes, appends or sends.
//
// Two passes: envelopes for everything (cheap, bulk), bodies only
// for prefilter survivors.
//
// imapflow and mailparser load lazily, on the first sync, so they stay off the
// cold-start path (the same reason better-sqlite3 does).

import type { ImapFlow, FetchQueryObject } from 'imapflow';
import { prefilter } from './prefilter';

export interface ScannedMessage {
  uid: number;
  messageId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  sentAt: string;
  /** Readable body text, only for prefilter survivors. */
  body: string;
}

export interface FolderScan {
  folder: string;
  uidValidity: number;
  highestUid: number;
  /** Envelopes looked at in this folder. */
  seen: number;
  /** Prefilter survivors, bodies attached. */
  messages: ScannedMessage[];
}

export interface Watermark { uidValidity: number; lastUid: number }

export interface ScanOptions {
  email: string;
  password: string;
  provider: 'gmail';
  /** Ignore anything sent before this. */
  since: Date;
  /** Start past this UID per folder; null (or a rebuilt UID space) means from the start. */
  watermarkFor: (folder: string) => Watermark | null;
  onProgress?: (seen: number) => void;
  /** Their own addresses: mail from these is their sent mail and never a candidate. */
  ownAddresses?: string[];
}

/** Pass one: envelope only. No body section is requested at all. */
export const ENVELOPE_QUERY: FetchQueryObject = { uid: true, envelope: true, internalDate: true };
/** Pass two: the full source, which imapflow sends as BODY.PEEK[] (never marks \Seen). */
export const SOURCE_QUERY: FetchQueryObject = { uid: true, source: true };

const IMAP_HOSTS = { gmail: { host: 'imap.gmail.com', port: 993 } } as const;

/**
 * Where to resume in a folder. A changed uidValidity means the server rebuilt
 * its UID space and the old watermark points at nothing, so start again at 0
 * (message_id uniqueness keeps the rescan from duplicating anything).
 */
export function startUidFor(wm: Watermark | null, serverValidity: number): number {
  return wm && wm.uidValidity === serverValidity ? wm.lastUid : 0;
}

function addressOf(env: any): { address: string; name: string } {
  const f = env?.from?.[0];
  if (!f) return { address: '', name: '' };
  return { address: f.address ? String(f.address) : '', name: f.name ? String(f.name) : '' };
}

async function openClient(email: string, password: string, provider: 'gmail'): Promise<ImapFlow> {
  const { ImapFlow: Client } = require('imapflow') as typeof import('imapflow');
  const { host, port } = IMAP_HOSTS[provider];
  const client = new Client({
    host, port, secure: true,
    auth: { user: email, pass: password },
    logger: false,
    emitLogs: false,
  });
  await client.connect();
  return client;
}

/**
 * Gmail's All Mail holds every message including archived ones; its name is
 * localised, so it is found by the \All special-use flag, not by string.
 */
export async function chooseFolders(client: ImapFlow, provider: string): Promise<string[]> {
  const boxes = await client.list();
  if (provider === 'gmail') {
    const all = boxes.find((b: any) => b.specialUse === '\\All');
    if (all) return [all.path];
  }
  const archive = boxes.find((b: any) => b.specialUse === '\\Archive');
  return archive ? ['INBOX', archive.path] : ['INBOX'];
}

/** Check the credentials without scanning anything. */
export async function verifyAccount(email: string, password: string, provider: 'gmail' = 'gmail'): Promise<{ ok: true } | { ok: false; error: string }> {
  let client: ImapFlow | null = null;
  try {
    client = await openClient(email, password, provider);
    await client.list();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: explainImapFailure(err, { email, provider }) };
  } finally {
    await client?.logout().catch(() => {});
  }
}

/**
 * Turn an IMAP failure into something the user can act on. imapflow reports a bad
 * password as "Command failed", which tells nobody anything.
 */
export function explainImapFailure(err: any, account: { email: string; provider: string }): string {
  const raw = [err?.responseText, err?.response, err?.message, String(err ?? '')].filter(Boolean).join(' ');
  const isGmail = account.provider === 'gmail';

  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|Command failed/i.test(raw)) {
    return isGmail
      ? 'Gmail rejected that password. It needs a 16-character app password, not your account password. '
        + 'Generate one at myaccount.google.com/apppasswords (2-Step Verification must be on first).'
      : 'That password was rejected by the mail server.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return `Could not reach ${account.email.split('@')[1] ?? 'the mail server'}. Check the network connection.`;
  }
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|timed out/i.test(raw)) {
    return 'The mail server did not answer. It may be temporarily unavailable, or IMAP may be blocked on this network.';
  }
  if (/certificate|self.signed|SSL|TLS/i.test(raw)) {
    return "The mail server's certificate could not be verified.";
  }
  return raw.slice(0, 200) || 'Sign-in failed for an unknown reason.';
}

/** Readable text for a parsed message, falling back to stripped HTML (plenty of ATS mail is HTML-only). */
export function bodyTextOf(parsed: { text?: string | null; html?: string | false | null }): string {
  const text = (parsed.text ?? '').trim();
  if (text) return text;
  return stripHtml(String(parsed.html || ''));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function scanFolder(client: ImapFlow, folder: string, startUid: number, since: Date, onProgress?: (seen: number) => void, own: string[] = []): Promise<FolderScan> {
  // readOnly: EXAMINE, not SELECT. The server refuses any flag change in this session.
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  const envelopes: Array<Omit<ScannedMessage, 'body'> & { candidate: boolean }> = [];
  let highestUid = startUid;
  let uidValidity = 0;
  let seen = 0;
  const messages: ScannedMessage[] = [];

  try {
    const mailbox: any = client.mailbox;
    uidValidity = Number(mailbox?.uidValidity ?? 0);

    for await (const msg of client.fetch({ uid: `${startUid + 1}:*`, since }, ENVELOPE_QUERY, { uid: true })) {
      const uid = Number(msg.uid);
      // `n:*` always returns at least one message, even when none is newer than n.
      if (uid <= startUid) continue;
      if (uid > highestUid) highestUid = uid;

      const env: any = msg.envelope ?? {};
      const from = addressOf(env);
      const subject = String(env.subject ?? '');
      const date = env.date || msg.internalDate;
      const verdict = prefilter({ fromAddress: from.address, fromName: from.name, subject }, own);
      envelopes.push({
        uid,
        messageId: String(env.messageId ?? ''),
        fromAddress: from.address,
        fromName: from.name,
        subject,
        sentAt: date ? new Date(date as any).toISOString() : new Date().toISOString(),
        candidate: verdict.candidate,
      });
      if (++seen % 250 === 0) onProgress?.(seen);
    }
    onProgress?.(seen);

    const candidates = envelopes.filter((e) => e.candidate);
    if (candidates.length) {
      const { simpleParser } = require('mailparser') as typeof import('mailparser');
      const bodies = new Map<number, string>();
      for await (const msg of client.fetch(candidates.map((e) => e.uid).join(','), SOURCE_QUERY, { uid: true })) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          bodies.set(Number(msg.uid), bodyTextOf(parsed as any));
        } catch {
          bodies.set(Number(msg.uid), '');
        }
      }
      for (const e of candidates) {
        const { candidate: _c, ...rest } = e;
        messages.push({ ...rest, body: bodies.get(e.uid) ?? '' });
      }
    }
  } finally {
    lock.release();
  }
  return { folder, uidValidity, highestUid, seen, messages };
}

/** Connect, scan every relevant folder past its watermark, disconnect. */
export async function scanAccount(opts: ScanOptions): Promise<FolderScan[]> {
  const client = await openClient(opts.email, opts.password, opts.provider);
  try {
    const folders = await chooseFolders(client, opts.provider);
    const results: FolderScan[] = [];
    let before = 0;
    for (const folder of folders) {
      const probe = await client.status(folder, { uidValidity: true });
      const startUid = startUidFor(opts.watermarkFor(folder), Number(probe.uidValidity ?? 0));
      const scan = await scanFolder(client, folder, startUid, opts.since, (n) => opts.onProgress?.(before + n), opts.ownAddresses ?? []);
      before += scan.seen;
      results.push(scan);
    }
    return results;
  } finally {
    await client.logout().catch(() => {});
  }
}

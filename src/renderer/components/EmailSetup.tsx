import React, { useEffect, useState } from 'react';
import { CheckCircle, Clock, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { EmailAccount, EmailEvent } from '../../shared/types';
import { Dialog } from './Dialog';
import { SyncProgress } from './EmailBits';
import { announceEmailChange, emailApi, useEmailSync, useMinuteTick } from '../hooks/useEmailSync';
import { cleanAppPassword, looksLikeAppPassword, looksLikeEmail, shortDate, timeAgo, waitingLine } from '../lib/email';
import { displayLocale } from '../../shared/locale';

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: '4px',
  padding: '24px',
  marginBottom: '32px',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 11, letterSpacing: 'normal', textTransform: 'none',
  color: 'var(--muted)', margin: '0 0 4px',
};
const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)',
  background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit',
};
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: 0 };
const errLine: React.CSSProperties = { fontSize: 12.5, color: 'var(--accent)', margin: '10px 0 0', lineHeight: 1.5 };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── The three steps: open Google, paste, connect ─────────────────────────────
const ConnectCard: React.FC<{
  onConnected: (a: EmailAccount) => void;
  onCancel?: () => void;
  /** Inboxes already connected: adding one more needs Google switched to that account first. */
  connected?: string[];
}> = ({ onConnected, onCancel, connected = [] }) => {
  const [opened, setOpened] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cleaned = cleanAppPassword(password);
  const emailOk = looksLikeEmail(email);
  const canConnect = emailOk && cleaned.length > 0 && !busy;
  const pwWarn = cleaned.length > 0 && !looksLikeAppPassword(password);

  const openGoogle = async () => {
    setOpened(true);
    try { await emailApi()?.openAppPasswordPage(); } catch { /* the link still works by hand */ }
  };

  const connect = async () => {
    if (!canConnect) return;
    const api = emailApi();
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.addAccount(email.trim(), cleaned);
      if (!res.ok || !res.data) {
        setError(res.error || 'Could not connect. Check the address and app password.');
        return;
      }
      setPassword('');
      onConnected(res.data);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="email-step">
        <span className={`email-step-num ${opened ? 'done' : ''}`}>1</span>
        <div>
          <p className="email-step-title">Make an app password</p>
          <p style={{ ...hint, marginBottom: 10 }}>
            {connected.length > 0
              ? `Each inbox needs its own. In Google, switch to the inbox you are adding (your picture, top right), not ${connected.join(' or ')}. 2-Step Verification must be on. Name the password Aplyd Community.`
              : 'Google needs 2-Step Verification on. Name the password Aplyd Community.'}
          </p>
          <button className="btn" onClick={openGoogle}>
            <ExternalLink size={13} /> Open Google app passwords
          </button>
        </div>
      </div>

      <div className="email-step">
        <span className={`email-step-num ${emailOk && looksLikeAppPassword(password) ? 'done' : ''}`}>2</span>
        <div>
          <p className="email-step-title">Paste it here</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={label} htmlFor="email-address">Gmail address</label>
              <input
                id="email-address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                autoComplete="off"
                spellCheck={false}
                style={field}
              />
            </div>
            <div>
              <label style={label} htmlFor="email-app-password">App password</label>
              <input
                id="email-app-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
                placeholder="abcd efgh ijkl mnop"
                autoComplete="off"
                style={field}
              />
              <p style={{ ...hint, marginTop: 6 }}>
                {pwWarn
                  ? 'That does not look like 16 letters. Copy it again from Google.'
                  : 'Spaces are fine. It is encrypted using your operating system’s protected storage.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="email-step">
        <span className="email-step-num">3</span>
        <div>
          <p className="email-step-title">Connect</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-accent" onClick={connect} disabled={!canConnect}>
              {busy ? <Loader2 size={13} className="aplyd-spin" /> : null}
              {busy ? 'Connecting' : 'Connect'}
            </button>
            {onCancel && !busy && (
              <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            )}
            {busy && <span style={hint}>Checking your inbox login...</span>}
          </div>
          {error && <p style={errLine}>{error}</p>}
        </div>
      </div>
    </div>
  );
};

// ── One connected inbox ───────────────────────────────────────────────────────
const AccountRow: React.FC<{
  account: EmailAccount;
  now: number;
  syncing: boolean;
  first: boolean;
  onSync: () => void;
  onRemove: () => void;
}> = ({ account, now, syncing, first, onSync, onRemove }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderTop: first ? 'none' : '1px solid var(--line)' }}>
    <CheckCircle size={16} style={{ color: 'var(--success)', marginTop: 2, flex: 'none' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.email}</p>
      <p style={{ ...hint, marginTop: 2 }}>
        {syncing ? 'Syncing now' : account.lastSyncAt ? `Last sync ${timeAgo(account.lastSyncAt, now)}` : 'Not synced yet'}
      </p>
      {account.lastError && <p style={{ ...errLine, marginTop: 4 }}>{account.lastError}</p>}
    </div>
    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
      <button className="btn" onClick={onSync} disabled={syncing}>
        <RefreshCw size={13} className={syncing ? 'aplyd-spin' : undefined} /> Sync now
      </button>
      <button className="btn btn-ghost" onClick={onRemove} title="Remove this inbox">
        <Trash2 size={13} /> Remove
      </button>
    </div>
  </div>
);

// ── Emails read but not yet decided ───────────────────────────────────────────
// Claude could not read them (signed out, at its limit, offline). Each sync
// tries again and decides them by itself; this only shows they are not lost.
const WaitingEmails: React.FC<{ count: number; refreshKey: string }> = ({ count, refreshKey }) => {
  const [rows, setRows] = useState<EmailEvent[]>([]);
  useEffect(() => {
    if (!count) { setRows([]); return; }
    let live = true;
    emailApi()?.listEvents({ status: 'pending' })
      .then((r) => { if (live && r.ok) setRows(r.data || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [count, refreshKey]);
  if (!count) return null;
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)' }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={13} /> {count === 1 ? '1 job email' : `${count.toLocaleString(displayLocale())} job emails`} waiting to be read
      </p>
      <p style={{ ...hint, marginBottom: rows.length ? 8 : 0 }}>Nothing is lost. The next sync reads {count === 1 ? 'it' : 'them'} and updates stages by itself.</p>
      {rows.slice(0, 8).map((e) => (
        <div key={e.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 12.5 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject || '(no subject)'}</div>
          <div style={{ ...hint, fontSize: 11.5 }}>
            {[shortDate(e.sentAt), e.fromAddress, waitingLine(e)].filter(Boolean).join(' · ')}
          </div>
        </div>
      ))}
      {rows.length > 8 && <p style={{ ...hint, marginTop: 6 }}>and {(rows.length - 8).toLocaleString(displayLocale())} more</p>}
    </div>
  );
};

// ── Settings > Email ──────────────────────────────────────────────────────────
export const EmailSection: React.FC = () => {
  const { accounts, status, loading, error, available } = useEmailSync();
  const now = useMinuteTick();
  const [adding, setAdding] = useState(false);
  const [justConnected, setJustConnected] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const syncing = !!status?.running;

  const onConnected = async (a: EmailAccount) => {
    setJustConnected(a.email);
    setAdding(false);
    announceEmailChange();
  };

  const syncNow = async () => {
    setActionError('');
    try {
      const res = await emailApi()?.syncNow();
      if (res && !res.ok) setActionError(res.error || 'Could not start a sync.');
    } catch (e) {
      setActionError(errText(e));
    }
  };

  const confirmRemove = async () => {
    const target = pendingRemove;
    setPendingRemove(null);
    if (!target) return;
    setActionError('');
    try {
      const res = await emailApi()?.removeAccount(target);
      if (res && !res.ok) setActionError(res.error || 'Could not remove that inbox.');
      if (justConnected === target) setJustConnected(null);
      announceEmailChange();
    } catch (e) {
      setActionError(errText(e));
    }
  };

  const connected = accounts.length > 0;

  return (
    <div style={card} id="settings-email">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: connected ? 8 : 6 }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Email</h3>
      </div>

      {!available ? (
        <p style={hint}>Email sync is not in this build yet.</p>
      ) : loading ? (
        <p style={hint}>Loading...</p>
      ) : (
        <>
          {!connected && (
            <p style={{ ...hint, marginBottom: 14 }}>
              Connect Gmail and aplyd moves your applications to the right stage when a company writes back. It only reads.
            </p>
          )}

          {justConnected && connected && (
            <p style={{ fontSize: 13, color: 'var(--success)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle size={14} /> Connected. Reading your job emails now.
            </p>
          )}

          {connected && accounts.map((a, i) => (
            <AccountRow
              key={a.email}
              account={a}
              now={now}
              first={i === 0}
              syncing={syncing}
              onSync={syncNow}
              onRemove={() => setPendingRemove(a.email)}
            />
          ))}

          {connected && <SyncProgress status={status} />}

          {connected && !syncing && (
            <WaitingEmails count={status?.pendingCount ?? 0} refreshKey={`${status?.lastSyncAt ?? ''}|${status?.phase ?? ''}`} />
          )}


          {(!connected || adding) && (
            <div style={connected ? { marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' } : undefined}>
              <ConnectCard
                onConnected={onConnected}
                onCancel={connected ? () => setAdding(false) : undefined}
                connected={accounts.map((a) => a.email)}
              />
            </div>
          )}

          {connected && !adding && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add another inbox
              </button>
            </div>
          )}

          {(error || actionError) && <p style={errLine}>{actionError || error}</p>}
        </>
      )}

      <Dialog
        isOpen={pendingRemove !== null}
        title="Remove this inbox?"
        message={pendingRemove ? `aplyd stops reading ${pendingRemove} and forgets its app password. Stages it already moved stay as they are.` : undefined}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
        confirmText="Remove"
        cancelText="Keep"
        isDangerous
      />
    </div>
  );
};

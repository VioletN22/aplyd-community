import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, MessageSquare, Save, Send } from 'lucide-react';
import { AssistantFormAnswer, AssistantHistoryMessage, AssistantReply, JobApplication } from '../../shared/types';

// The assistant for ONE application. It already holds this posting, every resume
// variant and their letters, so nothing has to be pasted into it: the user
// drops in the question an application form is asking and gets back an answer in
// their own voice, ready to paste.
//
// It sits above the cover letter on purpose. The letter is the long job; this is
// the one the user reaches for mid-form, so it has to be the first thing under the
// posting, and it stays a single input row until there is a thread to show.

// The assistant half of the preload surface (src/main/preload.ts), named here so
// this component stays typed even though another renderer module declares
// window.electronAPI as any.
type IpcResult<T = void> = Promise<{ ok: boolean; data?: T; error?: string }>;
interface AssistantApi {
  send(applicationId: string, text: string): IpcResult<AssistantReply>;
  history(applicationId: string): IpcResult<AssistantHistoryMessage[]>;
  saveAnswer(label: string, value: string): IpcResult<void>;
}
const assistantApi = (): AssistantApi => window.electronAPI.assistant;

// ── house design language (matches DetailPage) ───────────────────────────────
const microLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'var(--muted)',
  margin: 0,
};

// The three openers that get them from a blank panel to a useful turn.
const SUGGESTIONS = [
  'Answer a form question',
  'Why am I a fit here?',
  'Draft a follow-up message',
];

// Two of the chips are questions on their own; the first one is a prompt to
// paste, so it goes into the box instead of being sent.
const PASTE_ONLY = new Set(['Answer a form question']);

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Set on an assistant turn that answered an application form question. */
  formAnswer?: AssistantFormAnswer;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const AssistantSection: React.FC<{ application: JobApplication }> = ({ application }) => {
  const applicationId = application.id;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  // Latches on the first focus and stays for the session. Collapsing again the
  // moment the box loses focus would slide the input row up from under the
  // pointer, and the click the user was making would land on nothing.
  const [engaged, setEngaged] = useState(false);
  const [copiedAt, setCopiedAt] = useState(-1);
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [saveError, setSaveError] = useState('');

  const streamRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  // The stored thread, so a reopened application still has its conversation.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await assistantApi().history(applicationId);
        if (!live) return;
        // formAnswer is not stored (chat_messages holds text only), so a Save to
        // answer bank button belongs to the turn it arrived on, not to history.
        if (res.ok && res.data) setTurns(res.data.map((m) => ({ role: m.role, text: m.text })));
      } catch { /* an unreadable thread must not take the panel down */ }
    })();
    return () => { live = false; };
  }, [applicationId]);

  // elapsed-seconds ticker, so a slow turn never looks frozen
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setError('');
    setSaveError('');
    setBusy(true);
    try {
      const res = await assistantApi().send(applicationId, trimmed);
      if (res.ok && res.data) {
        const data = res.data;
        setTurns((prev) => [...prev, { role: 'assistant', text: data.reply, formAnswer: data.formAnswer }]);
      } else {
        setError(res.error || 'The assistant did not answer. Try again.');
      }
    } catch (e) {
      setError('The assistant did not answer: ' + errText(e));
    } finally {
      setBusy(false);
    }
  }, [applicationId, busy]);

  const useSuggestion = (s: string) => {
    if (PASTE_ONLY.has(s)) {
      setEngaged(true);
      window.setTimeout(() => boxRef.current?.focus(), 0);
      return;
    }
    send(s);
  };

  const copyTurn = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAt(index);
      window.setTimeout(() => setCopiedAt((i) => (i === index ? -1 : i)), 1600);
    } catch { /* clipboard denied, nothing to say about it */ }
  };

  const saveToBank = async (index: number, form: AssistantFormAnswer) => {
    setSaveError('');
    try {
      const res = await assistantApi().saveAnswer(form.question, form.answer);
      if (res.ok) setSaved((prev) => ({ ...prev, [index]: true }));
      else setSaveError(res.error || 'Could not save that answer.');
    } catch (e) {
      setSaveError('Could not save that answer: ' + errText(e));
    }
  };

  // Collapsed to a single input row until there is something to show: a thread,
  // a live turn, an error, or their cursor in the box.
  const expanded = useMemo(
    () => turns.length > 0 || busy || engaged || !!error,
    [turns.length, busy, engaged, error],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <MessageSquare size={14} style={{ color: 'var(--accent)' }} />
        <p style={microLabel}>Assistant</p>
      </div>
      <p style={{ fontSize: 'var(--fs-1)', color: 'var(--muted)', margin: '0 0 10px 22px' }}>
        Knows this application, your resumes and letters.
      </p>

      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {expanded && (
          <div
            ref={streamRef}
            style={{
              maxHeight: 340,
              overflowY: 'auto',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              borderBottom: '1px solid var(--line)',
            }}
          >
            {turns.length === 0 && !busy && !error && (
              <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                Paste a question an application form is asking and it answers as you, from your own history
                only. It cannot invent an employer, a number, or a date.
              </p>
            )}

            {turns.map((t, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: t.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '88%',
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      color: 'var(--ink)',
                      padding: t.role === 'user' ? '8px 10px' : 0,
                      borderRadius: t.role === 'user' ? 8 : 0,
                      background: t.role === 'user' ? 'rgba(242,58,23,.08)' : 'transparent',
                      border: t.role === 'user' ? '1px solid rgba(242,58,23,.25)' : 'none',
                    }}
                  >
                    {t.text}
                  </div>
                </div>

                {t.role === 'assistant' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => copyTurn(i, t.text)} className="btn btn-link">
                      {copiedAt === i ? <Check size={12} /> : <Copy size={12} />}
                      {copiedAt === i ? 'Copied' : 'Copy'}
                    </button>
                    {t.formAnswer && !saved[i] && (
                      <button onClick={() => saveToBank(i, t.formAnswer!)} className="btn btn-link">
                        <Save size={12} /> Save to answer bank
                      </button>
                    )}
                    {t.formAnswer && saved[i] && (
                      <span
                        style={{
                          fontSize: 'var(--fs-1)',
                          color: 'var(--ink)',
                          display: 'inline-flex',
                          gap: 5,
                          alignItems: 'center',
                          background: 'var(--success-tint)',
                          border: '1px solid var(--success-line)',
                          borderRadius: 6,
                          padding: '3px 8px',
                        }}
                      >
                        <Check size={11} /> Saved to your answer bank.
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11.5, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: 6,
                      background: 'var(--accent)',
                      animation: 'pulse 1s ease-in-out infinite',
                    }}
                  />
                  <span>Working…</span>
                  <span style={{ opacity: 0.7 }}>· {elapsed}s</span>
                </div>
                <div className="aplyd-bar" />
              </div>
            )}

            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink)',
                  border: '1px solid var(--accent)',
                  borderRadius: 8,
                  padding: '8px 10px',
                }}
              >
                {error}
              </div>
            )}

            {saveError && (
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--accent)' }}>{saveError}</div>
            )}
          </div>
        )}

        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {turns.length === 0 && !busy && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => useSuggestion(s)}
                  className="btn"
                  style={{ fontWeight: 500, background: 'var(--panel)', fontSize: 'var(--fs-1)', padding: '5px 10px' }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Collapsed, the footer is one input row and nothing else. Focusing it
              expands the panel, which is what brings the thread, the shortcut hint
              and the send button in. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <textarea
              ref={boxRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setEngaged(true)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Paste a form question, or ask about this application…"
              rows={expanded ? 3 : 1}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: expanded ? 62 : 34,
                resize: 'vertical',
                padding: '8px 11px',
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--panel)',
                color: 'var(--ink)',
                fontSize: 12.5,
                lineHeight: 1.55,
                fontFamily: 'inherit',
              }}
            />
          </div>

          {expanded && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Cmd+Enter sends</span>
              <button
                onClick={() => send(input)}
                disabled={busy || !input.trim()}
                className="btn btn-accent"
                style={{ marginLeft: 'auto', opacity: busy || !input.trim() ? 0.5 : 1 }}
              >
                <Send size={13} /> {busy ? 'Working…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

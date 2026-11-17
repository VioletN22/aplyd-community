import React, { useEffect, useRef, useState } from 'react';
import type { Approval, ApprovalDecision } from '../../shared/approvals';

interface Props {
  draft: Approval;
  onSave: (decision: ApprovalDecision) => Promise<void>;
  onClose: () => void;
}

export function ApprovalEditor({ draft, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [to, setTo] = useState(draft.to_address ?? '');
  const [subject, setSubject] = useState(draft.subject ?? '');
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({ status: 'approved', to_address: to, subject, body });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="approval-editor" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={save}>
        <h2>Edit draft</h2>
        <p>{draft.channel} · {draft.from_account || 'Account supplied by the agent'}</p>
        <label>To<input value={to} onChange={event => setTo(event.target.value)} /></label>
        <label>Subject<input value={subject} onChange={event => setSubject(event.target.value)} /></label>
        <label>Message<textarea required rows={12} value={body} onChange={event => setBody(event.target.value)} /></label>
        {error && <p role="alert" className="today-error">{error}</p>}
        <p className="cockpit-empty">Approval lets your agent send this draft. Aplyd does not send it.</p>
        <div className="approval-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Save and approve'}</button>
        </div>
      </form>
    </dialog>
  );
}

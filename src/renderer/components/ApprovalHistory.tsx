import React, { useCallback, useEffect, useState } from 'react';
import type { Approval } from '../../shared/approvals';
import { displayLocale } from '../../shared/locale';

export function ApprovalHistory({ applicationId, leadId }: { applicationId?: string; leadId?: string }) {
  const [rows, setRows] = useState<Approval[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await window.electronAPI.approvals.list({ applicationId, leadId });
    if (result.ok) { setRows(result.data ?? []); setError(''); }
    else setError(result.error || 'Could not load draft history.');
  }, [applicationId, leadId]);

  useEffect(() => {
    void load();
    return window.electronAPI.cockpit.onChanged(() => void load());
  }, [load]);

  if (!rows.length && !error) return null;
  return <section className="approval-history">
    <h3>Drafts and replies</h3>
    {error && <p role="alert">{error}</p>}
    {rows.map(row => <details key={row.id}>
      <summary>{row.subject || row.kind} · {row.status}{row.sent_at ? ` · ${new Date(row.sent_at).toLocaleDateString(displayLocale())}` : ''}</summary>
      <p>{row.to_address} · {row.channel}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{row.body}</p>
      {row.send_evidence && <p>Send evidence: {row.send_evidence}</p>}
      {row.error && <p role="alert">{row.error}</p>}
    </details>)}
  </section>;
}

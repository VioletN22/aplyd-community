import { CALENDAR_ZONE } from '../../shared/calendar';
import React, { useEffect, useState } from 'react';
import { defaultReviewPeriod, type CockpitStats, type ReviewRow } from '../../shared/cockpit-stats';
import { DashboardPage, type DashboardPageProps } from './DashboardPage';
import { useEmailSync } from '../hooks/useEmailSync';

const percent = (value: number | null) => value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
const change = (before: number | null | undefined, current: number | null | undefined) =>
  before == null || current == null ? 'n/a' : `${current >= before ? '+' : ''}${((current - before) * 100).toFixed(1)} pp`;
/** "1.2% · 3": the rate, then how many applications it is. */
const rateCell = (rate: number | null | undefined, count: number | undefined) =>
  rate == null ? 'n/a' : <>{percent(rate)} <span className="stats-count">· {count ?? 0}</span></>;
/** Jobs: progress and straight rejections side by side, change on progress. */
function JobReviewTable({ rows }: { rows: ReviewRow[] }) {
  return <div className="stats-table-scroll"><table className="stats-table">
    <thead><tr><th>Role type</th><th>Before · total</th><th>Progressed</th><th>Rejected</th><th>Selected period · total</th><th>Progressed</th><th>Rejected</th><th>Progress change</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}>
      <th scope="row">{row.label}</th>
      <td>{row.before.total}</td><td className="stats-good">{rateCell(row.before.progressRate, row.before.progressed)}</td><td>{rateCell(row.before.rejectRate, row.before.rejected)}</td>
      <td>{row.current.total}</td><td className="stats-good">{rateCell(row.current.progressRate, row.current.progressed)}</td><td>{rateCell(row.current.rejectRate, row.current.rejected)}</td>
      <td>{change(row.before.progressRate, row.current.progressRate)}</td>
    </tr>)}</tbody>
  </table></div>;
}
function ReviewTable({ rows, noun }: { rows: ReviewRow[]; noun: string }) {
  return <div className="stats-table-scroll"><table className="stats-table">
    <thead><tr><th>{noun}</th><th>Before · total</th><th>Responses</th><th>Rate</th><th>Selected period · total</th><th>Responses</th><th>Rate</th><th>Change</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}>
      <th scope="row">{row.label}</th><td>{row.before.total}</td><td>{row.before.replies}</td><td>{percent(row.before.rate)}</td>
      <td>{row.current.total}</td><td>{row.current.replies}</td><td>{percent(row.current.rate)}</td>
      <td>{change(row.before.rate, row.current.rate)}</td>
    </tr>)}</tbody>
  </table></div>;
}
export function StatsPage(props: DashboardPageProps) {
  const [data, setData] = useState<CockpitStats | null>(null);
  const [period, setPeriod] = useState(() => defaultReviewPeriod());
  const [error, setError] = useState('');
  const { status: emailStatus } = useEmailSync();
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const result = await window.electronAPI.stats.cockpit({...period,timeZone:CALENDAR_ZONE});
        if (!active || request !== sequence) return;
        if (!result.ok || !result.data) throw new Error(result.error || 'Could not load Stats.');
        setData(result.data); setError('');
      } catch (error) { if (active && request === sequence) setError(error instanceof Error ? error.message : 'Could not load Stats.'); }
    };
    void load();
    const off = window.electronAPI.cockpit.onChanged(() => void load());
    const timer = setInterval(() => void load(), 60000);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => { active = false; off(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [emailStatus?.phase, period.start, period.end, CALENDAR_ZONE]);
  return <>
    <main className="stats-page">
      <h1><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3" fill="var(--green)" /><path d="M8 16v-3 M12 16V8 M16 16v-5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" /></svg>Stats</h1>
      <div className="approval-actions">
        <label>Review from <input type="date" value={period.start} max={period.end} onChange={event => { if(event.target.value) setPeriod({...period,start:event.target.value}); }}/></label>
        <label>Through <input type="date" value={period.end} min={period.start} onChange={event => { if(event.target.value) setPeriod({...period,end:event.target.value}); }}/></label>
        <button className="btn" onClick={() => setPeriod(defaultReviewPeriod())}>Last 14 days</button>
      </div>
      {error && <p role="alert" className="today-error">{error}</p>}
    </main>
    <DashboardPage {...props} title="Jobs overview"/>
    <main className="stats-page">
      {!data && !error && <p className="cockpit-empty">Loading numbers…</p>}
      {data && <>
        <section className="stats-card">
          <div className="cockpit-heading"><h2>Period review</h2><span className="cockpit-empty">{data.inProgress ? 'In progress' : 'Complete period'} · as of {data.asOf}</span></div>
          <p>{data.period.start} to {data.period.end}, inclusive · {data.period.timeZone}</p>
          <h3>Jobs by role type</h3>
          <JobReviewTable rows={data.review.jobs}/>
          <p className="stats-note">Total = unique applications, grouped by their earliest recorded applied date. {data.fallbackApplications} use the created date where applied history is missing. Progressed = reached an assessment, phone screen, interview or offer (the good number). Rejected = rejected without ever progressing. Each application counts once; acknowledgements do not count. Progress change = selected-period progress rate minus before, in percentage points.</p>
          <h3>Leads by first contact</h3>
          <ReviewTable rows={data.review.outreach} noun="Segment"/>
          <p className="stats-note">Total = unique leads with an evidenced first send in that period. Follow-ups stay in the original cohort. Responses count each contacted lead once. Before = all cohorts and responses before the selected start; the new cohort counts responses through the selected end, or today while in progress. Later responses do not rewrite this comparison.</p>
          <p className="stats-note">Rate = responses ÷ total. n/a means no denominator; pp means percentage points. Older cohorts have had more time to respond, so compare these numbers with that difference in mind.</p>
        </section>
        <section className="stats-card">
          <h2>Leads, all recorded activity</h2>
          <div className="stats-table-scroll"><table className="stats-table">
            <thead><tr><th>Segment</th><th>Drafted</th><th>Sent</th><th>Replies</th><th>Calls</th><th>Won</th><th>Response rate</th></tr></thead>
            <tbody>{data.outreach.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.drafted}</td><td>{row.sent}</td><td>{row.replies}</td><td>{row.calls}</td><td>{row.won}</td><td>{percent(row.rate)}</td></tr>)}</tbody>
          </table></div>
          <p className="stats-note">Drafted counts approval drafts in any status. Sent, replies, calls and won count distinct leads; warm introductions count as activity even without an email send. Sent approvals require a timestamp and send evidence. Response rate counts only leads replying after an evidenced send ÷ leads sent, so its numerator can differ from all replies.</p>
        </section>
      </>}
    </main>
  </>;
}

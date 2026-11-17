import type { MigrationDb } from './database';
import { computeCockpitStats, type CockpitStats, type StatsInput, type ReviewPeriod } from '../shared/cockpit-stats';

export function cockpitStats(db: MigrationDb, asOf?: string, period?: ReviewPeriod): CockpitStats {
  const applications = db.prepare(`SELECT a.id, a.job_title, a.created_at,
    (SELECT s.entered_at FROM stage_history s WHERE s.application_id = a.id
      AND s.stage = 'applied' AND julianday(s.entered_at) IS NOT NULL
      ORDER BY julianday(s.entered_at) ASC LIMIT 1) AS applied_at
    FROM applications a`).all() as StatsInput['applications'];
  const jobSignals = db.prepare(`SELECT application_id, stage AS kind, entered_at AS at FROM stage_history
    UNION ALL SELECT application_id, kind, sent_at AS at FROM email_events
      WHERE status = 'applied' AND application_id IS NOT NULL`).all() as StatsInput['jobSignals'];
  return computeCockpitStats({
    applications, jobSignals,
    leads: db.prepare('SELECT id, segment FROM leads').all() as StatsInput['leads'],
    leadEvents: db.prepare('SELECT lead_id, kind, detail, at FROM lead_events').all() as StatsInput['leadEvents'],
    approvals: db.prepare('SELECT id, lead_id, created_at, status, sent_at, send_evidence FROM approvals WHERE lead_id IS NOT NULL').all() as StatsInput['approvals'],
  }, asOf, period);
}

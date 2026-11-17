import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({app:{getPath:()=>'/tmp'}}));
import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import { cockpitStats } from '../cockpit-stats';
it('loads earliest applied history and only applied email evidence without multiplying rows', () => {
  const db=new DatabaseSync(':memory:') as unknown as MigrationDb;
  createSchema(db);runMigrationLadder(db);
  db.prepare("INSERT INTO workflows(id,company,name,stages,created_at) VALUES ('default','','Default','[]','2026-10-01')").run();
  db.prepare(`INSERT INTO applications(id,company,job_title,location,job_url,job_description,key_responsibilities,required_skills,nice_to_have_skills,current_stage,workflow_id,created_at,updated_at)
    VALUES ('a','Acme','QA Engineer','','','','','','','applied','default','2026-10-13','2026-10-13')`).run();
  db.prepare(`INSERT INTO stage_history(id,application_id,stage,entered_at) VALUES ('s','a','applied','2026-10-10'),('s2','a','applied','2026-10-13')`).run();
  db.prepare(`INSERT INTO email_events(id,email,message_id,sent_at,application_id,kind,status,created_at) VALUES
    ('e','self','m','2026-10-11','a','assessment','applied','2026-10-13'),
    ('e2','self','m2','2026-10-11','a','interview','ignored','2026-10-13')`).run();
  const result=cockpitStats(db,'2026-10-28',{start:'2026-10-12',end:'2026-10-26',timeZone:'Australia/Sydney'});
  expect(result.review.jobs.find(row=>row.key==='qa')?.before).toEqual({total:1,replies:1,rate:1,progressed:1,progressRate:1,rejected:0,rejectRate:0});
  expect(result.review.jobs.find(row=>row.key==='qa')?.current.total).toBe(0);
  expect(result.fallbackApplications).toBe(0);
});

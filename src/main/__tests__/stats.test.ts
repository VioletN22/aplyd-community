import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import {
  roleFamily, aggregateOutcomes, outcomeStats, todayData, computeToday, gmailSearchUrl, pickEmailForLink,
  sourceBucket, resumeCode, resumeFocus, resumeBucket, bucketOutcomes, loadOutcomeInputs, OTHER_KEY,
  type OutcomeInput, type EmailLinkRow,
} from '../stats';

describe('roleFamily', () => {
  it.each([
    ['Full Stack Developer', 'full_stack'],
    ['Fullstack React Engineer', 'full_stack'],
    ['Full-stack Engineer', 'full_stack'],
    ['Frontend Software Engineer', 'frontend'],
    ['Front End Developer', 'frontend'],
    ['React Developer', 'frontend'],
    ['Software Engineer', 'software'],
    ['Graduate Developer', 'software'],
    ['Backend Engineer', 'software'],
    ['Network Engineer', 'infra_network'],
    ['DevOps Engineer', 'infra_network'],
    ['IT Support Officer', 'infra_network'],
    ['Cloud Infrastructure Engineer', 'infra_network'],
    ['Machine Learning Engineer', 'ai_ml'],
    ['AI Engineer', 'ai_ml'],
    ['Data Scientist', 'ai_ml'],
    ['Casual Retail Assistant', 'retail_casual'],
    ['Barista', 'retail_casual'],
    ['Customer Service Representative', 'retail_casual'],
    ['Accountant', 'other'],
    ['', 'other'],
  ])('%s -> %s', (title, family) => {
    expect(roleFamily(title)).toBe(family);
  });

  it('does not match words inside words', () => {
    expect(roleFamily('Building Manager')).toBe('other');
    expect(roleFamily('Email Marketing Coordinator')).toBe('other');
  });
});

const row = (o: Partial<OutcomeInput>): OutcomeInput => ({
  id: Math.random().toString(36), job_title: 'Software Engineer', job_source: 'Seek', current_stage: 'applied',
  resume_doc_id: null, resume_label: null, replied_by_email: false, ...o,
});

describe('aggregateOutcomes', () => {
  it('counts replies from email or a stage past applied, not withdrawal', () => {
    const s = aggregateOutcomes([
      row({ replied_by_email: true }),
      row({ current_stage: 'rejected' }),
      row({ current_stage: 'withdrawn' }),
      row({}),
    ], 10, 1);
    expect(s.withOutcome).toBe(2);
    expect(s.eligible).toBe(false);
    expect(s.bySource).toMatchObject([{ key: 'source:seek', label: 'SEEK', applied: 4, replied: 2 }]);
  });

  it('is eligible from 10 applications with an outcome', () => {
    const rows = Array.from({ length: 10 }, () => row({ current_stage: 'interview' }));
    expect(aggregateOutcomes(rows.slice(0, 9)).eligible).toBe(false);
    expect(aggregateOutcomes(rows).eligible).toBe(true);
  });

  it('buckets by source, resume and role family, best progress rate first', () => {
    const s = aggregateOutcomes([
      row({ job_source: 'LinkedIn', resume_doc_id: 'd1', resume_label: 'Frontend CV', job_title: 'React Developer', current_stage: 'interview' }),
      row({ job_source: 'LinkedIn', resume_doc_id: 'd1', resume_label: 'Frontend CV', job_title: 'Frontend Engineer' }),
      row({ job_source: null, resume_doc_id: 'gone', resume_label: null, job_title: 'Barista' }),
      row({ job_source: 'Seek', job_title: 'Network Engineer', replied_by_email: true }),
    ], 10, 1);
    expect(s.bySource).toMatchObject([
      { key: 'source:linkedin', label: 'LinkedIn', applied: 2, replied: 1, progressed: 1, rejected: 0 },
      { key: 'unknown', label: 'Not specified', applied: 1, replied: 0, progressed: 0, rejected: 0 },
      { key: 'source:seek', label: 'SEEK', applied: 1, replied: 1, progressed: 0, rejected: 1 },
    ]);
    expect(s.byResume).toMatchObject([
      { key: 'd1', label: 'Frontend CV', applied: 2, replied: 1 },
      { key: 'gone', label: 'Removed resume', applied: 1, replied: 0 },
      { key: 'none', label: 'Not recorded', applied: 1, replied: 1 },
    ]);
    expect(s.byRoleFamily.map((r) => r.key)).toEqual(['frontend', 'retail_casual', 'infra_network']);
    expect(s.byRoleFamily[0]).toMatchObject({ key: 'frontend', label: 'Frontend', applied: 2, replied: 1 });
  });
});

// ── SQL loaders over an in-memory database ──
const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

function fixture(): MigrationDb {
  const db = new DatabaseSync(':memory:') as unknown as MigrationDb;
  createSchema(db);
  runMigrationLadder(db);
  db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at) VALUES ('standard','','Standard','[]',0,'2026-01-01')`);
  db.exec(`INSERT INTO locker_documents (id, label, file_path, tags, is_default, created_at) VALUES ('d1','Frontend CV','/x.pdf','["resume"]',1,'2026-01-01')`);
  const add = db.prepare(`INSERT INTO applications (id, company, job_title, location, job_url, job_source, job_description,
      key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id, created_at, updated_at, interview_at, resume_doc_id)
    VALUES (?, ?, ?, '', '', ?, 'd', '', '', '', ?, 'standard', ?, ?, ?, ?)`);
  add.run('a1', 'Canva', 'Frontend Engineer', 'Seek', 'applied', ago(30), ago(19), null, 'd1');       // going quiet (19d)
  add.run('a2', 'Atlassian', 'Software Engineer', 'LinkedIn', 'interview', ago(30), ago(1), new Date(NOW + 2 * DAY).toISOString(), null);
  add.run('a3', 'Woolworths', 'Casual Retail Assistant', 'Seek', 'applied', ago(40), ago(40), null, null); // email 5d ago keeps it active
  add.run('a4', 'Optus', 'Network Engineer', null, 'applied', ago(2), ago(2), new Date(NOW + 10 * DAY).toISOString(), null);
  add.run('a5', 'Telstra', 'AI Engineer', 'Seek', 'applied', ago(3), ago(3), null, null);
  add.run('a6', 'Nimbus AI', 'Data Analyst', null, 'assessment', ago(4), ago(4), null, null);
  db.exec(`UPDATE applications SET application_deadline = '2026-09-26T13:44:00' WHERE id = 'a6'`);
  add.run('a7', 'Cyberdyne', 'Support Officer', null, 'assessment', ago(1), ago(1), null, null); // no deadline captured
  add.run('a8', 'Vandelay', 'Data Engineer', null, 'take_home', ago(2), ago(2), null, null);
  db.exec(`UPDATE applications SET application_deadline = '2026-09-27T18:00:00' WHERE id = 'a8'`);
  add.run('a9', 'Zip Co', 'Backend Engineer', null, 'assessed', ago(90), ago(90), null, null); // screening done, never on Today
  const ev = db.prepare(`INSERT INTO email_events (id, email, message_id, sent_at, application_id, kind, status, created_at)
    VALUES (?, 'me@x.com', ?, ?, ?, ?, ?, ?)`);
  ev.run('e1', 'm1', ago(5), 'a3', 'assessment', 'applied', ago(5));
  ev.run('e2', 'm2', ago(1), 'a5', 'rejection', 'dismissed', ago(1));   // dismissed: not a reply
  ev.run('e3', 'm3', ago(1), null, 'interview', 'pending', ago(1));     // one to review
  ev.run('e4', '<invite123@ats.example>', ago(3), 'a6', 'assessment', 'pending', ago(3)); // a6's invite email, still to review
  const cl = db.prepare(`INSERT INTO cover_letters (id, company, role, body, is_final, application_id, created_at, updated_at)
    VALUES (?, 'c', 'r', 'body', ?, ?, ?, ?)`);
  cl.run('c1', 0, 'a1', ago(1), ago(1));     // draft, no saved version: ready
  cl.run('c2', 0, 'a4', ago(1), ago(1));
  cl.run('c3', 1, 'a4', ago(1), ago(1));     // a4 has a saved version: not "ready"
  cl.run('c4', 0, 'a2', ago(1), ago(1));     // a2 is past applied: not "ready"
  const ai = db.prepare(`INSERT INTO action_items (id, application_id, kind, title, detail, url, email_url, due_at, group_label, priority, status, source, created_at, updated_at, done_at)
    VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, 'open', 'agent', ?, ?, NULL)`);
  ai.run('ai1', 'a7', 'schedule', 'Book your interview time', 'https://calendar.app.google/x', 'high', ago(1), ago(1));
  ai.run('ai2', null, 'verify', 'Verify SEEK Pass Digital Identity', 'https://app.seekpass.co/digital-identity/start', 'normal', ago(2), ago(2));
  return db;
}

describe('outcomeStats (SQL)', () => {
  it('joins resume labels and reply-kind email events', () => {
    const s = outcomeStats(fixture());
    expect(s.withOutcome).toBe(6); // a2 at interview, a3 by assessment email, a6-a9 on assessment stages
    // Every small bucket folds: one resume'd row (d1), SEEK x3 and LinkedIn x1.
    expect(s.byResume).toMatchObject([
      { key: 'none', label: 'Not recorded', applied: 8, replied: 6 },
      { key: OTHER_KEY, label: 'Other (1)', applied: 1, replied: 0, folded: 1 },
    ]);
    expect(s.bySource).toMatchObject([
      { key: 'unknown', label: 'Not specified', applied: 5, replied: 4 },
      { key: OTHER_KEY, label: 'Other (2)', applied: 4, replied: 2, folded: 2 },
    ]);
    const unfolded = aggregateOutcomes(loadOutcomeInputs(fixture()), 10, 1);
    expect(unfolded.byResume.find((r) => r.key === 'd1')).toMatchObject({ key: 'd1', label: 'Frontend CV', applied: 1, replied: 0 });
    expect(unfolded.bySource.find((r) => r.key === 'source:seek')).toMatchObject({ key: 'source:seek', label: 'SEEK', applied: 3, replied: 1 });
  });

  it('reads the resume focus notes from settings', () => {
    const db = fixture();
    db.exec(`INSERT INTO locker_documents (id, label, file_path, tags, is_default, created_at) VALUES ('d2','Alex Morgan - Resume_O01.pdf','/o.pdf','["resume"]',0,'2026-01-01')`);
    db.exec(`UPDATE applications SET resume_doc_id = 'd2' WHERE id = 'a3'`);
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('resume_focus', ?)`).run(JSON.stringify({ d2: 'Customer support; M365 admin' }));
    const inputs = loadOutcomeInputs(db);
    expect(inputs.find((r) => r.id === 'a3')!.resume_focus).toBe('Customer support; M365 admin');
    expect(inputs.find((r) => r.id === 'a1')!.resume_focus).toBeNull();
    expect(aggregateOutcomes(inputs, 10, 1).byResume.find((r) => r.key === 'resume:O01')).toMatchObject({
      key: 'resume:O01', label: 'O01', sublabel: 'Customer support', applied: 1, replied: 1,
    });
  });
});

describe('sourceBucket', () => {
  it.each([
    ['SEEK', 'SEEK'], ['Seek', 'SEEK'], ['SEEK Quick Apply', 'SEEK'], ['SEEK Quick apply (Hays)', 'SEEK'], ['SEEK / Lever', 'SEEK'],
    ['LinkedIn', 'LinkedIn'], ['linkedin', 'LinkedIn'], ['LinkedIn Easy Apply', 'LinkedIn'], ['au.linkedin.com', 'LinkedIn'],
    ['Official Greenhouse posting', 'Greenhouse'], ['job-boards.greenhouse.io', 'Greenhouse'], ['Greenhouse', 'Greenhouse'],
    ['jobs.smartrecruiters.com', 'SmartRecruiters'], ['TAL Careers / SmartRecruiters', 'SmartRecruiters'],
    ['Workable employer listing; employer LinkedIn post also announces Sydney vacancy', 'Workable'],
    ['Official Snooze careers listing', 'Employer'], ['Direct employer ATS', 'Employer'],
  ])('%s -> %s', (source, label) => {
    expect(sourceBucket(source).label).toBe(label);
  });

  it('merges every spelling of one board into one key', () => {
    const keys = new Set(['SEEK', 'Seek', 'seek', 'SEEK Quick Apply', 'SEEK Volunteer'].map((s) => sourceBucket(s).key));
    expect(keys).toEqual(new Set(['source:seek']));
  });

  it('merges unknown text case-insensitively and calls blank "Not specified"', () => {
    expect(sourceBucket('Other').key).toBe(sourceBucket('  OTHER ').key);
    expect(sourceBucket(null)).toEqual({ key: 'unknown', label: 'Not specified' });
    expect(sourceBucket('   ')).toEqual({ key: 'unknown', label: 'Not specified' });
  });
});

describe('resumeCode', () => {
  it.each([
    ['Alex Morgan - Resume_R01.pdf', 'R01'],
    ['Alex Morgan - Resume_R01.pdf (retail)', 'R01'],
    ['Alex Morgan - Resume_01.pdf (software)', '01'],
    ['Alex Morgan - Resume_O01.pdf (office admin / customer service)', 'O01'],
    ['Alex Morgan - resume_e01.pdf', 'E01'],
    ['Application-specific combined Resume_01 + Luxury Escapes graduate cover letter', '01'],
    ['O01 + Constantinople letter combined packet', 'O01'],
    ['Pattern Marketing combined E01 + letter', 'E01'],
    ['Alex Morgan - Resume.pdf', null],
    ['Vandelay Customer Service Resume and Cover Letter', null],
    ['Frontend CV', null],
    ['', null],
  ])('%s -> %s', (label, code) => {
    expect(resumeCode(label)).toBe(code);
  });
});

describe('resumeFocus / resumeBucket', () => {
  it('takes the bracketed note, else the first clause of the focus note, capitalised and capped', () => {
    expect(resumeFocus('Alex Morgan - Resume_R01.pdf (retail)', 'retail/customer service')).toBe('Retail');
    expect(resumeFocus('Alex Morgan - Resume_R01.pdf', 'retail/customer service')).toBe('Retail/customer service');
    expect(resumeFocus('x.pdf', 'Web/CMS work; WordPress migrations')).toBe('Web/CMS work');
    expect(resumeFocus('x.pdf', 'A very long focus note that keeps going without any punctuation at all')!.length).toBeLessThanOrEqual(32);
    expect(resumeFocus('x.pdf', null)).toBeNull();
  });

  it('keys by code, so a combined packet counts with the resume it carries, and the plain file names the focus', () => {
    const rows = [
      row({ resume_doc_id: 'p', resume_label: 'O01 + Constantinople letter combined packet', resume_focus: 'O01 customer-service resume plus letter' }),
      row({ resume_doc_id: 'o', resume_label: 'Alex Morgan - Resume_O01.pdf (office admin)', current_stage: 'interview' }),
    ];
    expect(bucketOutcomes(rows, resumeBucket, 1)).toMatchObject([
      { key: 'resume:O01', label: 'O01', sublabel: 'Office admin', applied: 2, replied: 1 },
    ]);
    expect(resumeBucket({ resume_doc_id: 'k', resume_label: 'Alex Morgan - Resume.pdf', resume_focus: null }))
      .toEqual({ key: 'k', label: 'Resume', sublabel: undefined });
  });
});

describe('progress and rejection', () => {
  it('counts a progress stage, progress email or past progress stage as progressed, and the rest of the answers as rejected', () => {
    const [r] = bucketOutcomes([
      row({ current_stage: 'interview' }),
      row({ current_stage: 'rejected', progressed_by_history: true }),
      row({ replied_by_email: true, progressed_by_email: true }),
      row({ current_stage: 'rejected' }),
      row({ replied_by_email: true }),
      row({}),
    ], (x) => sourceBucket(x.job_source), 1);
    expect(r).toMatchObject({ applied: 6, replied: 5, progressed: 3, rejected: 2 });
  });
});

describe('bucketOutcomes folding', () => {
  const many = (n: number, o: Partial<OutcomeInput>) => Array.from({ length: n }, () => row(o));

  it('folds every bucket under 5 applications into one Other row, kept last', () => {
    const rows = [
      ...many(5, { job_source: 'SEEK' }),
      ...many(4, { job_source: 'Indeed', current_stage: 'interview' }),
      ...many(1, { job_source: 'Jora', current_stage: 'rejected' }),
      ...many(6, { job_source: 'LinkedIn', current_stage: 'rejected' }),
    ];
    const out = bucketOutcomes(rows, (r) => sourceBucket(r.job_source));
    expect(out.map((r) => r.label)).toEqual(['SEEK', 'LinkedIn', 'Other (2)']);
    expect(out[2]).toMatchObject({ key: OTHER_KEY, label: 'Other (2)', applied: 5, replied: 5, folded: 2 });
  });

  it('keeps exactly 5 and adds no Other row when nothing is small', () => {
    const out = bucketOutcomes(many(5, { job_source: 'SEEK' }), (r) => sourceBucket(r.job_source));
    expect(out).toMatchObject([{ key: 'source:seek', label: 'SEEK', applied: 5, replied: 0 }]);
  });

  it('sorts by progress rate, then by lower rejection rate', () => {
    const rows = [
      ...many(10, { job_source: 'SEEK' }), ...many(2, { job_source: 'SEEK', current_stage: 'interview' }),   // 2/12
      ...many(5, { job_source: 'Indeed' }), ...many(5, { job_source: 'Indeed', current_stage: 'rejected' }), // 5/10
      ...many(3, { job_source: 'Lever' }), ...many(2, { job_source: 'Lever', current_stage: 'rejected' }),    // 2/5
    ];
    expect(bucketOutcomes(rows, (r) => sourceBucket(r.job_source)).map((r) => r.label)).toEqual(['SEEK', 'Lever', 'Indeed']);
  });
});

describe('todayData (SQL)', () => {
  it('lists drafts ready, interviews this week and rows about to go quiet', () => {
    const t = todayData(fixture(), NOW);
    expect(t.draftsReady.map((d) => d.applicationId)).toEqual(['a1']);
    expect(t.interviewsSoon).toEqual([
      { applicationId: 'a2', company: 'Atlassian', role: 'Software Engineer', interviewAt: new Date(NOW + 2 * DAY).toISOString(), emailUrl: null, jobUrl: null },
    ]);
    expect(t.goingQuiet).toEqual([{ applicationId: 'a1', company: 'Canva', role: 'Frontend Engineer', daysQuiet: 19 }]);
  });

  it('lists every stage-assessment/take_home application, dated or not, with the invite email linked', () => {
    const t = todayData(fixture(), NOW);
    expect(t.assessmentsDue).toEqual([
      {
        applicationId: 'a6', company: 'Nimbus AI', role: 'Data Analyst', dueAt: '2026-09-26T13:44:00', stage: 'assessment',
        emailUrl: gmailSearchUrl('me@x.com', '<invite123@ats.example>'), jobUrl: null,
      },
      { applicationId: 'a7', company: 'Cyberdyne', role: 'Support Officer', dueAt: null, stage: 'assessment', emailUrl: null, jobUrl: null },
      { applicationId: 'a8', company: 'Vandelay', role: 'Data Engineer', dueAt: '2026-09-27T18:00:00', stage: 'take_home', emailUrl: null, jobUrl: null },
    ]);
  });

  it('never lists "assessed" (screening done, waiting to hear back): not on Today, not going quiet', () => {
    const t = todayData(fixture(), NOW);
    expect(t.assessmentsDue.some((a) => a.applicationId === 'a9')).toBe(false);
    expect(t.goingQuiet.some((g) => g.applicationId === 'a9')).toBe(false);
  });

  it('lists open action items, joined to the application when linked', () => {
    const t = todayData(fixture(), NOW);
    expect(t.actionItems).toHaveLength(2);
    expect(t.actionItems.find((a) => a.id === 'ai1')).toEqual({
      id: 'ai1', applicationId: 'a7', kind: 'schedule', title: 'Book your interview time', detail: null,
      company: 'Cyberdyne', role: 'Support Officer', groupLabel: null, dueAt: null, endsAt: null, priority: 'high',
      url: 'https://calendar.app.google/x', emailUrl: null,
    });
    expect(t.actionItems.find((a) => a.id === 'ai2')).toMatchObject({ applicationId: null, company: null, role: null, priority: 'normal' });
  });

  it('drops a "book a time" item once its application has an interview booked after it', () => {
    const db = fixture();
    db.exec(`UPDATE action_items SET application_id = 'a2' WHERE id = 'ai1'`); // a2's interview is in two days
    expect(todayData(db, NOW).actionItems.map((a) => a.id)).toEqual(['ai2']);
  });

  it('computeToday: 18 to 20 quiet days only, past interviews excluded', () => {
    const base = {
      company: 'X', job_title: 'Y', current_stage: 'applied', created_at: ago(60), last_email_at: null,
      application_deadline: null, email_url: null, job_url: null,
    };
    const t = computeToday([
      { ...base, id: 'q17', updated_at: ago(17), interview_at: null },
      { ...base, id: 'q18', updated_at: ago(18), interview_at: null },
      { ...base, id: 'q20', updated_at: ago(20), interview_at: null },
      { ...base, id: 'q21', updated_at: ago(21), interview_at: null },
      { ...base, id: 'past', current_stage: 'interview', updated_at: ago(1), interview_at: ago(1) },
    ], [], NOW);
    expect(t.goingQuiet.map((g) => g.applicationId)).toEqual(['q20', 'q18']);
    expect(t.interviewsSoon).toEqual([]);
  });

  it('computeToday: assessment and take_home stages both show up, merged, with or without a deadline; assessed does not', () => {
    const base = {
      company: 'X', job_title: 'Y', current_stage: 'assessment', created_at: ago(60), interview_at: null, last_email_at: null,
    };
    const t = computeToday([
      { ...base, id: 'dated', updated_at: ago(2), application_deadline: '2026-10-06T13:44:00', email_url: 'https://mail.example/x', job_url: 'https://jobs.example/x' },
      { ...base, id: 'undated', updated_at: ago(90), application_deadline: null, email_url: null, job_url: null },
      { ...base, id: 'homework', current_stage: 'take_home', updated_at: ago(1), application_deadline: '2026-10-08T09:00:00', email_url: null, job_url: null },
      { ...base, id: 'done', current_stage: 'assessed', updated_at: ago(30), application_deadline: null, email_url: null, job_url: null },
    ], [], NOW);
    expect(t.assessmentsDue).toEqual([
      { applicationId: 'dated', company: 'X', role: 'Y', dueAt: '2026-10-06T13:44:00', stage: 'assessment', emailUrl: 'https://mail.example/x', jobUrl: 'https://jobs.example/x' },
      { applicationId: 'undated', company: 'X', role: 'Y', dueAt: null, stage: 'assessment', emailUrl: null, jobUrl: null },
      { applicationId: 'homework', company: 'X', role: 'Y', dueAt: '2026-10-08T09:00:00', stage: 'take_home', emailUrl: null, jobUrl: null },
    ]);
  });

  it('computeToday: actionItems default to empty and otherwise pass straight through', () => {
    expect(computeToday([], []).actionItems).toEqual([]);
    const items = [{ id: 'x', applicationId: null, kind: 'captcha', title: 'Solve the CAPTCHA', detail: null, company: null, role: null, groupLabel: null, dueAt: null, priority: 'normal' as const, url: null, emailUrl: null }];
    expect(computeToday([], [], NOW, items).actionItems).toBe(items);
  });
});

describe('gmailSearchUrl', () => {
  it('builds an authuser search link, stripping angle brackets and encoding the id', () => {
    expect(gmailSearchUrl('alex@example.com', '<invite123@ats.example>'))
      .toBe('https://mail.google.com/mail/?authuser=alex@example.com#search/rfc822msgid%3Ainvite123%40ats.example');
  });

  it('encodes a plus-address so the + survives as part of authuser', () => {
    expect(gmailSearchUrl('alex+jobs@example.com', '<a@b>'))
      .toBe('https://mail.google.com/mail/?authuser=alex%2Bjobs@example.com#search/rfc822msgid%3Aa%40b');
  });

  it('tolerates a message-id with no angle brackets', () => {
    expect(gmailSearchUrl('alex@example.com', 'bare-id@host'))
      .toBe('https://mail.google.com/mail/?authuser=alex@example.com#search/rfc822msgid%3Abare-id%40host');
  });
});

describe('pickEmailForLink', () => {
  const row = (o: Partial<EmailLinkRow>): EmailLinkRow => ({ email: 'me@x.com', message_id: 'm', kind: 'received', sent_at: '2026-01-01', ...o });

  it('prefers the newest assessment/interview email over anything else', () => {
    const picked = pickEmailForLink([
      row({ message_id: 'ack', kind: 'received', sent_at: '2026-09-20' }),
      row({ message_id: 'old-invite', kind: 'interview', sent_at: '2026-09-10' }),
      row({ message_id: 'new-invite', kind: 'assessment', sent_at: '2026-09-25' }),
    ]);
    expect(picked?.message_id).toBe('new-invite');
  });

  it('falls back to the newest non-"received" email when there is no invite', () => {
    const picked = pickEmailForLink([
      row({ message_id: 'ack', kind: 'received', sent_at: '2026-09-25' }),
      row({ message_id: 'rejection', kind: 'rejection', sent_at: '2026-09-20' }),
    ]);
    expect(picked?.message_id).toBe('rejection');
  });

  it('is undefined when only plain acknowledgements were seen, or nothing at all', () => {
    expect(pickEmailForLink([row({ kind: 'received' })])).toBeUndefined();
    expect(pickEmailForLink([])).toBeUndefined();
  });
});

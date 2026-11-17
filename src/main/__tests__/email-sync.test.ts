import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import { EmailStore } from '../email/store';
import { EmailSync, decideEvent, roleFromSubject, type Classifier, type Fetcher, type StageOps, type ClassifyResult, type SecondPassClassifier, type SecondPassResult } from '../email/sync';
import type { FolderScan, ScannedMessage, ScanOptions } from '../email/imap';

// ── fixtures ────────────────────────────────────────────────────────────────

let db: MigrationDb;
let store: EmailStore;
const NOW = new Date('2026-09-24T00:00:00Z');

function addApp(id: string, company: string, stage = 'applied', created = '2026-07-01T00:00:00Z') {
  db.prepare(`INSERT INTO applications (id, company, job_title, location, job_url, job_description,
      key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id, created_at, updated_at, notes)
    VALUES (?, ?, 'Engineer', 'Sydney', '', 'd', '', '', '', ?, 'w1', ?, ?, NULL)`).run(id, company, stage, created, created);
}

const stageOf = (id: string) => (db.prepare('SELECT current_stage AS s FROM applications WHERE id = ?').get(id) as any).s;
const historyOf = (id: string) => db.prepare('SELECT stage, notes FROM stage_history WHERE application_id = ? ORDER BY entered_at').all(id) as any[];

/** The same two writes database.ts's createStageHistory + updateApplication make. */
const sqlStages: StageOps = {
  move(appId, stage, note) {
    const id = 'h' + Math.random().toString(36).slice(2);
    db.prepare(`INSERT INTO stage_history (id, application_id, stage, entered_at, exited_at, notes, guidance, outcome)
                VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL)`).run(id, appId, stage, new Date().toISOString(), note);
    db.prepare('UPDATE applications SET current_stage = ?, updated_at = ? WHERE id = ?').run(stage, new Date().toISOString(), appId);
    return id;
  },
  addNote(appId, line) {
    const cur = (db.prepare('SELECT notes FROM applications WHERE id = ?').get(appId) as any).notes;
    db.prepare('UPDATE applications SET notes = ? WHERE id = ?').run(cur ? cur + '\n' + line : line, appId);
  },
  create({ company, role, notes }) {
    const id = 'new' + (++createdSeq);
    const at = new Date(Date.UTC(2026, 8, 1, 0, createdSeq)).toISOString();
    db.prepare(`INSERT INTO applications (id, company, job_title, location, job_url, job_source, job_description,
        key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id, created_at, updated_at, notes)
      VALUES (?, ?, ?, '', '', 'Email', 'Job details to be added', '', '', '', 'applied', 'w1', ?, ?, ?)`).run(id, company, role, at, at, notes);
    created.push({ id, company, role, notes });
    return id;
  },
};
let createdSeq = 0;
let created: { id: string; company: string; role: string; notes: string }[] = [];

let uidSeq = 100;
function msg(subject: string, fromAddress: string, sentAt = '2026-09-10T00:00:00Z', extra: Partial<ScannedMessage> = {}): ScannedMessage {
  const uid = ++uidSeq;
  return { uid, messageId: `<m${uid}@x>`, fromAddress, fromName: '', subject, sentAt, body: '', ...extra };
}

/** A mailbox that returns what it is given, honouring the watermark like the real scanner. */
function fakeMailbox(messages: ScannedMessage[], uidValidity = 1) {
  const seenOpts: ScanOptions[] = [];
  const fetcher: Fetcher = async (opts) => {
    seenOpts.push(opts);
    const wm = opts.watermarkFor('[Gmail]/All Mail');
    const start = wm && wm.uidValidity === uidValidity ? wm.lastUid : 0;
    const fresh = messages.filter((m) => m.uid > start && new Date(m.sentAt) >= opts.since);
    const scan: FolderScan = {
      folder: '[Gmail]/All Mail', uidValidity,
      highestUid: Math.max(start, ...fresh.map((m) => m.uid)), seen: fresh.length, messages: fresh,
    };
    return [scan];
  };
  return { fetcher, seenOpts, set: (v: number) => { uidValidity = v; } };
}

/** Classifier keyed on subject: "<kind>:<company>:<confidence>". */
const byRule = (rules: Record<string, Partial<ClassifyResult>>): Classifier => async (input) => {
  const rule = rules[input.subject];
  if (!rule) return { applicationId: null, kind: 'other', confidence: 0, evidence: '' };
  const r = { applicationId: null, kind: 'other', confidence: 0.95, evidence: 'quote', ...rule } as ClassifyResult;
  return r;
};

function engine(fetcher: Fetcher, classify: Classifier, classifySecondPass?: SecondPassClassifier) {
  return new EmailSync({
    store, fetcher, classify, classifySecondPass, stages: sqlStages, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
  });
}

/** Second pass keyed on subject; records every call. */
function secondBy(rules: Record<string, Partial<SecondPassResult>>) {
  const calls: { subjects: string[]; appIds: string[] }[] = [];
  const fn: SecondPassClassifier = async (emails, apps) => {
    calls.push({ subjects: emails.map((e) => e.subject), appIds: apps.map((a) => a.id) });
    return emails.map((e) => ({
      applicationId: null, kind: 'other', confidence: 0.9, evidence: 'q', company: null, role: null, ...(rules[e.subject] || {}),
    }) as SecondPassResult);
  };
  return { fn, calls };
}

/** What the CLI says when its subscription login has lapsed (10 Oct 2026). */
const SIGNED_OUT = 'claude reported an error: Failed to authenticate: OAuth session expired and could not be refreshed';

/** A realistic SEEK "Application update" rejection: templated, with other employers' jobs underneath. */
const SEEK_REJECTION_BODY = [
  'Hi Alex,',
  '',
  'Thanks for applying for the Software Engineer role at URES through SEEK.',
  '',
  'Unfortunately, URES has decided not to progress your application any further. This is often because',
  'the employer received a high number of applications, or other candidates more closely matched the role.',
  '',
  "Don't be discouraged. Here are some jobs you might be interested in:",
  'Frontend Engineer',
  'Canva Pty Ltd',
  'Sydney NSW',
  'Graduate Developer',
  'Atlassian',
  'Sydney NSW',
  '',
  'View your application history on SEEK',
  'You received this email because you applied for a job on SEEK. Unsubscribe from application updates.',
].join('\n');

/** Insert a row the old review flow left pending. */
function pendingRow(over: Partial<{ messageId: string; fromAddress: string; subject: string; sentAt: string; applicationId: string | null;
  kind: ClassifyResult['kind']; confidence: number; evidence: string; proposedStage: string | null; fromStage: string | null }>) {
  return store.insertEvent({
    email: 'me@gmail.com', messageId: over.messageId ?? `<p${++uidSeq}@x>`, fromAddress: over.fromAddress ?? 'x@corp.com',
    subject: over.subject ?? 'S', sentAt: over.sentAt ?? '2026-08-01T00:00:00Z', applicationId: over.applicationId ?? null,
    kind: over.kind ?? 'interview', confidence: over.confidence ?? 0.9, evidence: over.evidence ?? 'q',
    fromStage: over.fromStage ?? null, proposedStage: over.proposedStage ?? null, status: 'pending', candidates: [],
  }, '2026-09-01T00:00:00Z')!;
}

beforeEach(() => {
  created = [];
  db = new DatabaseSync(':memory:') as unknown as MigrationDb;
  createSchema(db);
  runMigrationLadder(db);
  db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at) VALUES ('w1','x','x','["applied"]',1,'2026-01-01')`);
  store = new EmailStore(db);
  addApp('canva', 'Canva Pty Ltd', 'applied', '2026-06-20T00:00:00Z');
  addApp('atl', 'Atlassian', 'applied');
  addApp('rej', 'Rejecto', 'rejected');
  store.addAccount('me@gmail.com', '2026-09-01T00:00:00Z');
});

// ── decideEvent ─────────────────────────────────────────────────────────────

describe('decideEvent (fully automatic, 0.5 bar)', () => {
  const app = { id: 'a', company: 'A', job_title: 'r', current_stage: 'applied', created_at: '' };
  it('applies a matched change at >= 0.5', () => {
    expect(decideEvent({ kind: 'rejection', confidence: 0.5, app, text: '' }))
      .toEqual({ status: 'applied', fromStage: 'applied', proposedStage: 'rejected', apply: true });
  });
  it('ignores a match under 0.5', () => {
    expect(decideEvent({ kind: 'rejection', confidence: 0.49, app, text: '' }))
      .toEqual({ status: 'ignored', fromStage: 'applied', proposedStage: null, apply: false });
  });
  it('ignores unmatched emails and "other"; never pending', () => {
    expect(decideEvent({ kind: 'interview', confidence: 0.99, app: null, text: '' }).status).toBe('ignored');
    expect(decideEvent({ kind: 'other', confidence: 1, app, text: '' }).status).toBe('ignored');
    for (const kind of ['received', 'rejection', 'interview', 'assessment', 'offer', 'other'] as const) {
      for (const confidence of [0, 0.3, 0.5, 0.8, 1]) {
        for (const a of [null, app, { ...app, current_stage: 'rejected' }]) {
          expect(decideEvent({ kind, confidence, app: a, text: '' }).status).not.toBe('pending');
        }
      }
    }
  });
  it('logs receipts, notes assessments, and never moves backwards or out of a final stage', () => {
    expect(decideEvent({ kind: 'received', confidence: 0.9, app, text: '' }))
      .toEqual({ status: 'applied', fromStage: 'applied', proposedStage: null, apply: false });
    expect(decideEvent({ kind: 'assessment', confidence: 0.9, app, text: '' }))
      .toEqual({ status: 'applied', fromStage: 'applied', proposedStage: 'assessment', apply: true });
    // Done stays done: an assessment email on 'assessed' only notes it.
    expect(decideEvent({ kind: 'assessment', confidence: 0.9, app: { ...app, current_stage: 'assessed' }, text: '' }))
      .toEqual({ status: 'applied', fromStage: 'assessed', proposedStage: null, apply: true });
    // Under the bar: nothing.
    expect(decideEvent({ kind: 'assessment', confidence: 0.4, app, text: '' }))
      .toEqual({ status: 'ignored', fromStage: 'applied', proposedStage: null, apply: false });
    expect(decideEvent({ kind: 'interview', confidence: 1, app: { ...app, current_stage: 'rejected' }, text: '' }))
      .toEqual({ status: 'applied', fromStage: 'rejected', proposedStage: null, apply: false });
    expect(decideEvent({ kind: 'interview', confidence: 1, app: { ...app, current_stage: 'interview' }, text: 'a quick phone call' }))
      .toMatchObject({ proposedStage: null, apply: false });
  });
  it('roleFromSubject drops reply prefixes', () => {
    expect(roleFromSubject('Re: Fwd: Team Fit Interview')).toBe('Team Fit Interview');
    expect(roleFromSubject('')).toBe('Role from email');
  });
});

// ── the engine ──────────────────────────────────────────────────────────────

describe('backlog sync', () => {
  it('applies confident matches like any other sync, and scans from first application - 7 days', async () => {
    const mb = fakeMailbox([
      msg('Thanks for applying to Canva', 'careers@canva.com', '2026-06-21T00:00:00Z'),
      msg('Interview with Canva', 'careers@canva.com', '2026-07-05T00:00:00Z'),
      msg('Atlassian update', 'no-reply@us.greenhouse-mail.io', '2026-07-10T00:00:00Z', { fromName: 'Atlassian' }),
      msg('Old news', 'x@canva.com', '2026-01-01T00:00:00Z'),
    ]);
    const s = await engine(mb.fetcher, byRule({
      'Thanks for applying to Canva': { applicationId: 'canva', kind: 'received' },
      'Interview with Canva': { applicationId: 'canva', kind: 'interview', confidence: 0.6 },
      'Atlassian update': { applicationId: 'atl', kind: 'rejection', confidence: 0.99 },
    })).start();

    expect(mb.seenOpts[0].since.toISOString()).toBe('2026-06-13T00:00:00.000Z');
    expect(stageOf('canva')).toBe('interview');
    expect(stageOf('atl')).toBe('rejected');
    expect(historyOf('canva')).toEqual([{ stage: 'interview', notes: 'From email: Interview with Canva (5 Jul)' }]);
    expect(s.autoApplied).toBe(2);
    expect(s.pendingCount).toBe(0);
    expect(s.phase).toBe('done');
    expect(store.listEvents({ status: 'pending' })).toEqual([]);
    expect(store.listEvents({ status: 'applied' }).map((e) => e.subject).sort())
      .toEqual(['Atlassian update', 'Interview with Canva', 'Thanks for applying to Canva']);
    expect(store.getAccount('me@gmail.com')!.backlogDone).toBe(true);
    expect(store.getAccount('me@gmail.com')!.lastSyncAt).toBe(NOW.toISOString());
  });
});

describe('backlog survives an interruption', () => {
  it('saves each email as it is read, and a rerun only classifies the rest', async () => {
    const mails = [
      msg('Interview with Canva', 'careers@canva.com', '2026-07-05T00:00:00Z'),
      msg('Atlassian update', 'no-reply@us.greenhouse-mail.io', '2026-07-10T00:00:00Z', { fromName: 'Atlassian' }),
      msg('Canva next steps', 'careers@canva.com', '2026-07-12T00:00:00Z'),
    ];
    const mb = fakeMailbox(mails);
    const rules = byRule({
      'Interview with Canva': { applicationId: 'canva', kind: 'interview' },
      'Atlassian update': { applicationId: 'atl', kind: 'rejection' },
      'Canva next steps': { applicationId: 'canva', kind: 'offer' },
    });
    let calls = 0;
    const flaky: Classifier = async (input) => {
      calls++;
      if (input.subject === 'Canva next steps') throw new Error('killed');
      return rules(input);
    };
    await engine(mb.fetcher, flaky).start();
    expect(store.listEvents({ status: 'applied' }).map((e) => e.subject).sort())
      .toEqual(['Atlassian update', 'Interview with Canva']);
    expect(stageOf('canva')).toBe('interview');
    // The one it could not read waits as a stored event, so the scan itself is
    // finished: no second full backlog pass just to retry one email.
    expect(store.listEvents({ status: 'pending' }).map((e) => e.subject)).toEqual(['Canva next steps']);
    expect(store.getAccount('me@gmail.com')!.backlogDone).toBe(true);

    const seen: string[] = [];
    const counting: Classifier = async (input) => { seen.push(input.subject); return rules(input); };
    await engine(mb.fetcher, counting).start();
    expect(seen).toEqual(['Canva next steps']);
    expect(store.listEvents({ status: 'applied' })).toHaveLength(3);
    expect(stageOf('canva')).toBe('offer');
    expect(calls).toBe(3);
    expect(store.getAccount('me@gmail.com')!.backlogDone).toBe(true);
  });
});

describe('incremental sync', () => {
  beforeEach(() => {
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
  });

  it('applies matches at >= 0.5 with a history note, ignores the rest', async () => {
    const mb = fakeMailbox([
      msg('Interview invitation', 'careers@canva.com', '2026-09-20T03:00:00Z'),
      msg('Maybe Atlassian', 'x@seek.com.au', '2026-09-21T00:00:00Z'),
    ]);
    const s = await engine(mb.fetcher, byRule({
      'Interview invitation': { applicationId: 'canva', kind: 'interview', confidence: 0.5 },
      'Maybe Atlassian': { applicationId: 'atl', kind: 'rejection', confidence: 0.49 },
    })).start();

    expect(mb.seenOpts[0].since.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(stageOf('canva')).toBe('interview');
    expect(historyOf('canva')).toEqual([{ stage: 'interview', notes: 'From email: Interview invitation (20 Sep)' }]);
    expect(stageOf('atl')).toBe('applied');
    expect(s.autoApplied).toBe(1);
    expect(s.pendingCount).toBe(0);
    expect(store.listEvents({ status: 'ignored' })[0]).toMatchObject({ subject: 'Maybe Atlassian', applicationId: null });
    expect(store.listEvents({ status: 'applied' })[0]).toMatchObject({ applicationId: 'canva', proposedStage: 'interview', fromStage: 'applied', company: 'Canva Pty Ltd' });
  });

  it('an assessment moves applied to Assessment, with the email on the stage history', async () => {
    await engine(fakeMailbox([msg('Online assessment', 'careers@canva.com', '2026-09-20T00:00:00Z')]).fetcher,
      byRule({ 'Online assessment': { applicationId: 'canva', kind: 'assessment' } })).start();
    expect(stageOf('canva')).toBe('assessment');
    expect(historyOf('canva')).toEqual([{ stage: 'assessment', notes: 'From email: Online assessment (20 Sep)' }]);
    expect(store.listEvents()[0]).toMatchObject({ status: 'applied', fromStage: 'applied', proposedStage: 'assessment' });
  });

  it('an assessment on an application already past it (done, or interview) only adds a note', async () => {
    db.prepare(`UPDATE applications SET current_stage = 'assessed' WHERE id = 'canva'`).run();
    await engine(fakeMailbox([msg('Your assessment link', 'careers@canva.com', '2026-09-20T00:00:00Z')]).fetcher,
      byRule({ 'Your assessment link': { applicationId: 'canva', kind: 'assessment' } })).start();
    expect(stageOf('canva')).toBe('assessed');
    expect(historyOf('canva')).toEqual([]);
    expect((db.prepare(`SELECT notes FROM applications WHERE id='canva'`).get() as any).notes).toBe('From email: Your assessment link (20 Sep)');
  });

  it('an assessment email already stored is never re-applied by a later sync (only new mail moves stages)', async () => {
    const m = msg('Online assessment', 'careers@canva.com', '2026-09-20T00:00:00Z');
    const classify = vi.fn(byRule({ 'Online assessment': { applicationId: 'canva', kind: 'assessment' } }));
    const mb = fakeMailbox([m], 1);
    await engine(mb.fetcher, classify).start();
    // The user moves it back by hand; a full rescan must not move it again.
    db.prepare(`UPDATE applications SET current_stage = 'applied' WHERE id = 'canva'`).run();
    mb.set(2);
    await engine(mb.fetcher, classify).start();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(stageOf('canva')).toBe('applied');
    expect(historyOf('canva')).toHaveLength(1);
  });

  it('never moves a final stage, and logs instead', async () => {
    const mb = fakeMailbox([msg('Interview at Rejecto', 'hr@rejecto.com', '2026-09-20T00:00:00Z')]);
    await engine(mb.fetcher, byRule({ 'Interview at Rejecto': { applicationId: 'rej', kind: 'interview' } })).start();
    expect(stageOf('rej')).toBe('rejected');
    expect(store.listEvents()[0]).toMatchObject({ status: 'applied', proposedStage: null, fromStage: 'rejected' });
  });

  it('is idempotent on message_id: a rescan applies nothing twice', async () => {
    const m = msg('Unfortunately', 'careers@canva.com', '2026-09-20T00:00:00Z');
    const rules = byRule({ Unfortunately: { applicationId: 'canva', kind: 'rejection' } });
    const classify = vi.fn(rules);
    // uidValidity changes between runs, so the second run rescans from UID 0.
    const mb = fakeMailbox([m], 1);
    await engine(mb.fetcher, classify).start();
    mb.set(2);
    await engine(mb.fetcher, classify).start();

    expect(classify).toHaveBeenCalledTimes(1);
    expect(historyOf('canva')).toHaveLength(1);
    expect(store.listEvents()).toHaveLength(1);
    // And the store itself refuses a duplicate.
    expect(store.insertEvent({
      email: 'me@gmail.com', messageId: m.messageId, fromAddress: '', subject: '', sentAt: m.sentAt, applicationId: null,
      kind: 'other', confidence: 0, evidence: '', fromStage: null, proposedStage: null, status: 'ignored', candidates: [],
    })).toBe(null);
  });

  it('advances the watermark, and resets it when uidValidity changes', async () => {
    const a = msg('Thanks for applying', 'careers@canva.com', '2026-09-20T00:00:00Z');
    const mb = fakeMailbox([a], 5);
    const classify = byRule({ 'Thanks for applying': { applicationId: 'canva', kind: 'received' } });
    await engine(mb.fetcher, classify).start();
    expect(store.getWatermark('me@gmail.com', '[Gmail]/All Mail')).toEqual({ uidValidity: 5, lastUid: a.uid });

    // Next run starts past it.
    await engine(mb.fetcher, classify).start();
    expect(mb.seenOpts[1].watermarkFor('[Gmail]/All Mail')).toEqual({ uidValidity: 5, lastUid: a.uid });

    // Server rebuilt its UID space: renumbered message, new validity, stored fresh.
    mb.set(9);
    await engine(mb.fetcher, classify).start();
    expect(store.getWatermark('me@gmail.com', '[Gmail]/All Mail')).toEqual({ uidValidity: 9, lastUid: a.uid });
  });

  it('keeps an email Claude could not read as a waiting event, says why, and reads it on the next run', async () => {
    const ok = msg('Thanks for applying', 'careers@canva.com', '2026-09-20T00:00:00Z');
    const bad = msg('Interview invitation', 'careers@canva.com', '2026-09-21T00:00:00Z', {
      fromName: 'Canva Careers', body: 'We would love to invite you to an interview next week.',
    });
    const mb = fakeMailbox([ok, bad]);
    const classify: Classifier = async (i) => {
      if (i.subject === 'Interview invitation') throw new Error(SIGNED_OUT);
      return { applicationId: 'canva', kind: 'received', confidence: 1, evidence: '' };
    };
    const s = await engine(mb.fetcher, classify).start();

    // Nothing is lost: the email is stored, waiting, and the watermark moves on past it.
    const waiting = store.listEvents({ status: 'pending' });
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ messageId: bad.messageId, subject: 'Interview invitation', applicationId: null });
    expect(waiting[0].candidates.map((c) => c.applicationId)).toEqual(['canva']);
    expect(store.getWatermark('me@gmail.com', '[Gmail]/All Mail')!.lastUid).toBe(bad.uid);
    expect(stageOf('canva')).toBe('applied');
    // And it is not silent: the run, the status and the account all say so.
    expect(s.phase).toBe('done');
    expect(s.pendingCount).toBe(1);
    expect(s.message).toContain('1 waiting');
    const acct = store.getAccount('me@gmail.com')!;
    expect(acct.lastSyncAt).toBe(NOW.toISOString());
    expect(acct.lastError).toMatch(/^1 job email is waiting/);
    expect(acct.lastError).toMatch(/signed out/i);

    // Claude is back: the next run reads it from the stored copy and applies it.
    const seen: string[] = [];
    const s2 = await engine(fakeMailbox([]).fetcher, async (i) => {
      seen.push(`${i.subject} | ${i.from} | ${i.body}`);
      return { applicationId: 'canva', kind: 'interview', confidence: 0.9, evidence: 'invite you to an interview' };
    }).start();
    expect(seen).toEqual(['Interview invitation | Canva Careers <careers@canva.com> | We would love to invite you to an interview next week.']);
    expect(stageOf('canva')).toBe('interview');
    expect(historyOf('canva')).toEqual([{ stage: 'interview', notes: 'From email: Interview invitation (21 Sep)' }]);
    expect(store.getEvent(waiting[0].id)).toMatchObject({ status: 'applied', applicationId: 'canva', proposedStage: 'interview', kind: 'interview' });
    expect(store.getEvent(waiting[0].id)!.pendingInput).toBeNull();
    expect(s2.pendingCount).toBe(0);
    expect(s2.autoApplied).toBe(1);
    expect(store.getAccount('me@gmail.com')!.lastError).toBeNull();
  });

  it('a catch-up after weeks away reads the whole gap, not just the last 14 days, and applies like any sync', async () => {
    db.prepare('UPDATE email_accounts SET last_sync_at = ?').run('2026-09-01T00:00:00Z');
    store.setWatermark('me@gmail.com', '[Gmail]/All Mail', { uidValidity: 1, lastUid: uidSeq });
    const early = msg('Interview invitation', 'careers@canva.com', '2026-09-03T00:00:00Z');
    const late = msg('Atlassian update', 'no-reply@us.greenhouse-mail.io', '2026-09-22T00:00:00Z', { fromName: 'Atlassian' });
    const mb = fakeMailbox([early, late]);
    const s = await engine(mb.fetcher, byRule({
      'Interview invitation': { applicationId: 'canva', kind: 'interview' },
      'Atlassian update': { applicationId: 'atl', kind: 'rejection' },
    })).start();
    // 14 days before the last sync, not before now.
    expect(mb.seenOpts[0].since.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(stageOf('canva')).toBe('interview');
    expect(stageOf('atl')).toBe('rejected');
    expect(s.autoApplied).toBe(2);
  });

  it('stops asking Claude once it says it is signed out, so a long run does not spawn a call per email', async () => {
    const mails = [1, 2, 3, 4, 5, 6].map((n) => msg(`Update ${n}`, 'careers@canva.com', `2026-09-2${n}T00:00:00Z`, { body: 'News about your application.' }));
    let calls = 0;
    const s = await engine(fakeMailbox(mails).fetcher, async () => { calls++; throw new Error(SIGNED_OUT); }).start();
    expect(calls).toBeLessThanOrEqual(2);
    expect(store.listEvents({ status: 'pending' })).toHaveLength(6);
    expect(s.pendingCount).toBe(6);
    expect(store.getAccount('me@gmail.com')!.lastError).toMatch(/^6 job emails are waiting/);
  });

  it('a run started while one is going (a new inbox) runs again right after, instead of being absorbed', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return []; };
    const e = engine(fetcher, byRule({}));
    const first = e.start();
    const again = e.start({ again: true });
    expect(again).not.toBe(first);
    await again;
    expect(calls).toBe(2);
  });

  it('records a fetch failure on the account and reports phase error, without throwing', async () => {
    const fetcher: Fetcher = async () => { throw new Error('ENOTFOUND imap.gmail.com'); };
    const s = await engine(fetcher, byRule({})).start();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('ENOTFOUND');
    expect(store.getAccount('me@gmail.com')!.lastError).toContain('ENOTFOUND');
  });

  it('never runs two syncs at once', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return []; };
    const e = engine(fetcher, byRule({}));
    const [a, b] = [e.start(), e.start()];
    expect(a).toBe(b);
    await a;
    expect(calls).toBe(1);
  });
});

describe('second pass: the full application list', () => {
  beforeEach(() => { db.prepare('UPDATE email_accounts SET backlog_done = 1').run(); });

  it('matches an email the shortlist missed, against every application', async () => {
    const mb = fakeMailbox([msg('Next steps for you', 'talent@brandco.io', '2026-09-20T00:00:00Z')]);
    const second = secondBy({ 'Next steps for you': { applicationId: 'atl', kind: 'rejection', confidence: 0.7 } });
    const s = await engine(mb.fetcher, byRule({ 'Next steps for you': { applicationId: null, kind: 'rejection', confidence: 0.9 } }), second.fn).start();
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].appIds.sort()).toEqual(['atl', 'canva', 'rej']);
    expect(stageOf('atl')).toBe('rejected');
    expect(s.autoApplied).toBe(1);
    expect(store.listEvents()[0]).toMatchObject({ status: 'applied', applicationId: 'atl', proposedStage: 'rejected' });
  });

  it('applies the same 0.5 bar to the second pass, and never asks it about received/other', async () => {
    const mb = fakeMailbox([
      msg('Unsure one', 'talent@brandco.io', '2026-09-20T00:00:00Z'),
      msg('Thanks for applying', 'talent@brandco.io', '2026-09-20T01:00:00Z'),
    ]);
    const second = secondBy({ 'Unsure one': { applicationId: 'atl', kind: 'rejection', confidence: 0.4 } });
    await engine(mb.fetcher, byRule({
      'Unsure one': { applicationId: null, kind: 'rejection' },
      'Thanks for applying': { applicationId: null, kind: 'received' },
    }), second.fn).start();
    expect(second.calls.map((c) => c.subjects)).toEqual([['Unsure one']]);
    expect(stageOf('atl')).toBe('applied');
    expect(store.listEvents().every((e) => e.status === 'ignored')).toBe(true);
  });

  it('an interview from a company the user never logged creates exactly one application, moved to interview', async () => {
    const mb = fakeMailbox([
      msg('Invitation: Team Fit Interview', 'sam@example.com', '2026-09-15T00:00:00Z', { fromName: 'Sam Rivers' }),
      msg('Interview confirmation', 'sam@example.com', '2026-09-16T00:00:00Z', { fromName: 'Sam Rivers' }),
      msg('Your second interview', 'no-reply@us.greenhouse-mail.io', '2026-09-18T00:00:00Z', { fromName: 'Globex' }),
    ]);
    const second = secondBy({
      'Invitation: Team Fit Interview': { kind: 'interview', confidence: 0.85, company: 'Northwind (Globex)', role: 'Account Manager' },
      'Interview confirmation': { kind: 'interview', confidence: 0.8, company: 'Northwind (Globex)', role: null },
      'Your second interview': { kind: 'interview', confidence: 0.8, company: 'northwind globex', role: null },
    });
    const s = await engine(mb.fetcher, byRule({
      'Invitation: Team Fit Interview': { kind: 'interview' },
      'Interview confirmation': { kind: 'interview' },
      'Your second interview': { kind: 'interview' },
    }), second.fn).start();

    expect(created).toHaveLength(1);
    const app = created[0];
    expect(app).toMatchObject({ company: 'Northwind (Globex)', role: 'Account Manager', notes: 'Created from email: Invitation: Team Fit Interview' });
    expect(stageOf(app.id)).toBe('interview');
    expect(historyOf(app.id)).toEqual([{ stage: 'interview', notes: 'From email: Invitation: Team Fit Interview (15 Sep)' }]);
    const events = store.listEvents({ applicationId: app.id });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.status === 'applied')).toBe(true);
    expect(s.autoApplied).toBe(1);
  });

  it('attaches to an existing application by normalised company instead of creating a duplicate', async () => {
    const mb = fakeMailbox([msg('Offer letter', 'people@somewhere.io', '2026-09-20T00:00:00Z')]);
    const second = secondBy({ 'Offer letter': { kind: 'offer', confidence: 0.9, company: 'CANVA Australia', role: 'x' } });
    await engine(mb.fetcher, byRule({ 'Offer letter': { kind: 'offer' } }), second.fn).start();
    expect(created).toEqual([]);
    expect(stageOf('canva')).toBe('offer');
  });

  it('falls back to the sender for the company when the model names none; rejections never create', async () => {
    const mb = fakeMailbox([
      msg('Phone screen invite', 'recruiting@zippy.com.au', '2026-09-20T00:00:00Z', { fromName: 'Zippy Careers' }),
      msg('Unfortunately', 'hr@nobody.com', '2026-09-20T01:00:00Z'),
    ]);
    const second = secondBy({
      'Phone screen invite': { kind: 'interview', confidence: 0.8, company: null, role: null },
      'Unfortunately': { kind: 'rejection', confidence: 0.9, company: 'Nobody' },
    });
    await engine(mb.fetcher, byRule({
      'Phone screen invite': { kind: 'interview' }, 'Unfortunately': { kind: 'rejection' },
    }), second.fn).start();
    expect(created.map((c) => [c.company, c.role])).toEqual([['Zippy', 'Phone screen invite']]);
    // "phone screen" in the subject: the phone_screen stage.
    expect(stageOf(created[0].id)).toBe('phone_screen');
    expect(store.listEvents({ status: 'ignored' }).map((e) => e.subject)).toEqual(['Unfortunately']);
  });

  it('a failed second pass leaves the email waiting, and the next run places it', async () => {
    const m = msg('Interview?', 'sam@example.com', '2026-09-20T00:00:00Z', { fromName: 'Sam Rivers' });
    const mb = fakeMailbox([m]);
    await engine(mb.fetcher, byRule({ 'Interview?': { kind: 'interview' } }), async () => { throw new Error('busy'); }).start();
    expect(store.listEvents({ status: 'pending' }).map((e) => e.messageId)).toEqual([m.messageId]);
    expect(store.getWatermark('me@gmail.com', '[Gmail]/All Mail')!.lastUid).toBe(m.uid);

    const second = secondBy({ 'Interview?': { kind: 'interview', confidence: 0.8, company: 'Northwind', role: 'Account Manager' } });
    await engine(mb.fetcher, byRule({ 'Interview?': { kind: 'interview' } }), second.fn).start();
    expect(created.map((c) => c.company)).toEqual(['Northwind']);
    expect(store.listEvents({ status: 'pending' })).toEqual([]);
    expect(store.listEvents()[0]).toMatchObject({ status: 'applied', applicationId: created[0].id, proposedStage: 'interview' });
  });

  it('an unplaced SEEK interview creates the application from the subject, never "SEEK Applications"', async () => {
    const m = msg('Acme Robotics has responded to your application for Junior Developer', 'noreply@s.seek.com.au', '2026-09-20T00:00:00Z', {
      fromName: 'SEEK Applications', body: 'Acme Robotics would like to invite you to an interview.',
    });
    const second = secondBy({ [m.subject]: { kind: 'interview', confidence: 0.8, company: null, role: null } });
    await engine(fakeMailbox([m]).fetcher, byRule({ [m.subject]: { kind: 'interview' } }), second.fn).start();
    expect(created.map((c) => [c.company, c.role])).toEqual([['Acme Robotics', 'Junior Developer']]);
  });
});

describe('own mail', () => {
  it('is ignored without the model: connected accounts and the profile email', async () => {
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('profile', ?)`).run(JSON.stringify({ name: 'Sam', email: 'Me.Work@Outlook.com' }));
    expect(store.ownAddresses().sort()).toEqual(['me.work@outlook.com', 'me@gmail.com']);
    const mb = fakeMailbox([
      msg('Re: Team Fit Interview', 'me@gmail.com', '2026-09-20T00:00:00Z'),
      msg('Re: Interview times', 'me.work@outlook.com', '2026-09-20T01:00:00Z'),
    ]);
    const classify = vi.fn(byRule({}));
    const second = secondBy({});
    await engine(mb.fetcher, classify, second.fn).start();
    expect(classify).not.toHaveBeenCalled();
    expect(second.calls).toEqual([]);
    expect(store.listEvents().map((e) => e.status)).toEqual(['ignored', 'ignored']);
    expect(mb.seenOpts[0].ownAddresses).toEqual(store.ownAddresses());
  });
});

describe('re-processing rows the old review flow left pending', () => {
  it('resolves every pending row: applies, ignores, second pass, creation, own mail', async () => {
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
    const matched = pendingRow({ subject: 'Interview invitation', applicationId: 'canva', kind: 'interview', confidence: 0.7, fromStage: 'applied', proposedStage: 'interview', sentAt: '2026-07-05T00:00:00Z' });
    const phone = pendingRow({ subject: 'Quick chat?', applicationId: 'atl', kind: 'interview', confidence: 0.6, fromStage: 'applied', proposedStage: 'phone_screen', sentAt: '2026-07-06T00:00:00Z' });
    const low = pendingRow({ subject: 'Maybe', applicationId: 'rej', kind: 'offer', confidence: 0.3, sentAt: '2026-07-07T00:00:00Z' });
    const own = pendingRow({ subject: 'Re: Team Fit Interview', fromAddress: 'ME@gmail.com', kind: 'interview', sentAt: '2026-09-16T00:00:00Z' });
    const sg1 = pendingRow({ subject: 'Team Fit Interview', fromAddress: 'sam@example.com', kind: 'interview', evidence: 'invite you to a team fit interview', sentAt: '2026-09-15T00:00:00Z' });
    const sg2 = pendingRow({ subject: 'Final interview', fromAddress: 'sam@example.com', kind: 'interview', sentAt: '2026-09-19T00:00:00Z' });
    const unsure = pendingRow({ subject: 'Unsure one', fromAddress: 'noreply@seek.com.au', kind: 'rejection', sentAt: '2026-07-08T00:00:00Z' });

    const second = secondBy({
      'Team Fit Interview': { kind: 'interview', confidence: 0.8, company: 'Northwind', role: 'Sales Lead' },
      'Final interview': { kind: 'interview', confidence: 0.8, company: 'Northwind Pty Ltd' },
      'Unsure one': { applicationId: 'canva', kind: 'rejection', confidence: 0.3 },
    });
    const e = engine(fakeMailbox([]).fetcher, byRule({}), second.fn);
    const s = await e.start();

    expect(store.listEvents({ status: 'pending' })).toEqual([]);
    expect(s.pendingCount).toBe(0);
    expect(store.getEvent(matched)).toMatchObject({ status: 'applied', proposedStage: 'interview' });
    expect(store.getEvent(matched)!.stageHistoryId).toBeTruthy();
    expect(stageOf('canva')).toBe('interview');
    expect(stageOf('atl')).toBe('phone_screen');
    expect(store.getEvent(phone)).toMatchObject({ status: 'applied', proposedStage: 'phone_screen' });
    expect(store.getEvent(low)).toMatchObject({ status: 'ignored', applicationId: null });
    expect(stageOf('rej')).toBe('rejected');
    expect(store.getEvent(own)).toMatchObject({ status: 'ignored', applicationId: null });
    expect(store.getEvent(unsure)).toMatchObject({ status: 'ignored', applicationId: null });

    // Own mail never reaches the model; the second pass got subject + evidence for the rest.
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].subjects.sort()).toEqual(['Final interview', 'Team Fit Interview', 'Unsure one']);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ company: 'Northwind', role: 'Sales Lead' });
    expect(stageOf(created[0].id)).toBe('interview');
    expect(store.getEvent(sg1)).toMatchObject({ status: 'applied', applicationId: created[0].id, proposedStage: 'interview' });
    expect(store.getEvent(sg2)).toMatchObject({ status: 'applied', applicationId: created[0].id, proposedStage: null });

    // Idempotent: a second run has nothing to do and asks the model nothing.
    await e.start();
    expect(second.calls).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(historyOf('canva')).toHaveLength(1);
  });

  it('keeps a row pending (for retry) only when its second pass failed', async () => {
    const id = pendingRow({ subject: 'Interview', fromAddress: 'a@b.com', kind: 'interview' });
    const e = engine(fakeMailbox([]).fetcher, byRule({}), async () => { throw new Error('busy'); });
    expect(await e.reprocessPending()).toEqual({ applied: 0, ignored: 0, retry: 1 });
    expect(store.getEvent(id)!.status).toBe('pending');
    // Model back: resolved.
    const ok = engine(fakeMailbox([]).fetcher, byRule({}), secondBy({ Interview: { kind: 'interview', confidence: 0.9, company: 'Bee' } }).fn);
    expect(await ok.reprocessPending()).toMatchObject({ applied: 1, retry: 0 });
    expect(store.getEvent(id)!.status).toBe('applied');
  });
});

describe('store', () => {
  it('listEvents filters by status and application, newest first', async () => {
    await engine(fakeMailbox([
      msg('A', 'careers@canva.com', '2026-07-05T00:00:00Z'),
      msg('B', 'careers@canva.com', '2026-07-09T00:00:00Z'),
    ]).fetcher, byRule({
      'A': { applicationId: 'canva', kind: 'interview' },
      'B': { applicationId: 'canva', kind: 'rejection' },
    })).start();
    expect(store.listEvents({ applicationId: 'canva' }).map((e) => e.subject)).toEqual(['B', 'A']);
    expect(store.listEvents({ status: 'all' })).toHaveLength(2);
    expect(store.listEvents({ applicationId: 'atl' })).toHaveLength(0);
  });
});

describe('fast path: rules and batching', () => {
  it('quickClassify only takes plain acknowledgements with exactly one match', async () => {
    const { quickClassify } = await import('../email/sync');
    const one = [{ id: 'canva', company: 'Canva', job_title: 'r', current_stage: 'applied', created_at: '' }];
    expect(quickClassify('Thank you for applying to Canva', '', one)).toMatchObject({ applicationId: 'canva', kind: 'received' });
    expect(quickClassify('Thank you for applying', 'Unfortunately we will not progress', one)).toBeNull();
    expect(quickClassify('Thanks for your application', 'We would like to invite you to an interview', one)).toBeNull();
    expect(quickClassify('Thank you for applying', '', [])).toBeNull();
    expect(quickClassify('Thank you for applying', '', [...one, { ...one[0], id: 'x' }])).toBeNull();
    expect(quickClassify('Your weekly job alert', '', one)).toBeNull();
  });

  it('quickClassify takes an unmistakable rejection with exactly one match, and leaves anything hopeful to the model', async () => {
    const { quickClassify } = await import('../email/sync');
    const one = [{ id: 'ures', company: 'URES', job_title: 'Software Engineer', current_stage: 'applied', created_at: '' }];
    expect(quickClassify('Application update for Software Engineer at URES', SEEK_REJECTION_BODY, one))
      .toMatchObject({ applicationId: 'ures', kind: 'rejection', confidence: 0.9, evidence: expect.stringContaining('decided not to progress your application') });
    // SEEK's other template, and SmartRecruiters' "to the next stage" wording.
    expect(quickClassify('Application update for Sales Staff at Zenith Retail', 'the employer has indicated on SEEK that your application is unlikely to progress further', one))
      .toMatchObject({ kind: 'rejection' });
    expect(quickClassify('An update on your application', 'the decision has been made not to progress your application to the next stage', one))
      .toMatchObject({ kind: 'rejection' });
    expect(quickClassify('Your application', 'We have decided to move forward with other candidates for this role.', one))
      .toMatchObject({ kind: 'rejection' });
    // A rejection that also talks about an interview, a test or another role goes to the model.
    expect(quickClassify('Update', 'We will not progress your application for this role, but would like to invite you to interview for another.', one)).toBeNull();
    expect(quickClassify('Update', 'Unfortunately we are not progressing your application. Congratulations on reaching the final round though!', one)).toBeNull();
    // A receipt that only says what would happen if it goes nowhere is not a rejection.
    expect(quickClassify('Thanks for applying', "Thanks for applying for this role. If the employer decides not to progress your application, we'll let you know.", one))
      .toMatchObject({ kind: 'received' });
    expect(quickClassify('Your application', 'Should we not progress your application, we will notify you by email.', one)).toBeNull();
    // ...but a conditional line elsewhere does not hide a real "no".
    expect(quickClassify('Application update', `If you have questions, reply here.\n${SEEK_REJECTION_BODY}`, one)).toMatchObject({ kind: 'rejection' });
    // Never without exactly one match.
    expect(quickClassify('Application update', SEEK_REJECTION_BODY, [])).toBeNull();
    expect(quickClassify('Application update', SEEK_REJECTION_BODY, [...one, { ...one[0], id: 'x' }])).toBeNull();
  });

  it('a SEEK "Application update" rejection is decided without the model, despite other employers in the body', async () => {
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
    db.prepare(`INSERT INTO applications (id, company, job_title, location, job_url, job_description, key_responsibilities, required_skills,
        nice_to_have_skills, current_stage, workflow_id, created_at, updated_at) VALUES ('ures',
        'Umbrella Rescue and Education Service Ltd (URES)', 'Software Engineer', '', '', 'd', '', '', '', 'applied', 'w1', ?, ?)`)
      .run('2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    const m = msg('Application update for Software Engineer at URES', 'noreply@s.seek.com.au', '2026-09-20T00:00:00Z', {
      fromName: 'SEEK Applications', body: SEEK_REJECTION_BODY,
    });
    const classify = vi.fn(byRule({}));
    const s = await engine(fakeMailbox([m]).fetcher, classify).start();
    expect(classify).not.toHaveBeenCalled();
    expect(stageOf('ures')).toBe('rejected');
    expect(stageOf('canva')).toBe('applied');
    expect(store.listEvents()[0]).toMatchObject({ status: 'applied', kind: 'rejection', applicationId: 'ures', proposedStage: 'rejected' });
    expect(s.autoApplied).toBe(1);
  });

  it('batches model calls and skips the model for plain acknowledgements', async () => {
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
    const mb = fakeMailbox([
      msg('Thank you for applying to Canva', 'careers@canva.com', '2026-09-12T00:00:00Z'),
      msg('Atlassian update', 'no-reply@us.greenhouse-mail.io', '2026-09-12T01:00:00Z', { fromName: 'Atlassian' }),
      msg('Interview with Canva', 'careers@canva.com', '2026-09-12T02:00:00Z'),
    ]);
    const rules = byRule({
      'Atlassian update': { applicationId: 'atl', kind: 'rejection', confidence: 0.95 },
      'Interview with Canva': { applicationId: 'canva', kind: 'interview', confidence: 0.95 },
    });
    const batches: string[][] = [];
    const single: string[] = [];
    const sync = new EmailSync({
      store, fetcher: mb.fetcher, stages: sqlStages, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
      classify: async (i) => { single.push(i.subject); return rules(i); },
      classifyBatch: async (inputs) => { batches.push(inputs.map((i) => i.subject)); return Promise.all(inputs.map(rules)); },
    });
    const s = await sync.start();
    expect(batches).toEqual([['Atlassian update', 'Interview with Canva']]);
    expect(single).toEqual([]);
    expect(stageOf('atl')).toBe('rejected');
    expect(stageOf('canva')).toBe('interview');
    expect(s.autoApplied).toBe(2);
    expect(store.listEvents({ status: 'applied' }).map((e) => e.subject)).toContain('Thank you for applying to Canva');
  });

  it('falls back to one email at a time when a batch call fails', async () => {
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
    const mb = fakeMailbox([
      msg('Atlassian update', 'no-reply@us.greenhouse-mail.io', '2026-09-12T01:00:00Z', { fromName: 'Atlassian' }),
      msg('Interview with Canva', 'careers@canva.com', '2026-09-12T02:00:00Z'),
    ]);
    const rules = byRule({
      'Atlassian update': { applicationId: 'atl', kind: 'rejection', confidence: 0.95 },
      'Interview with Canva': { applicationId: 'canva', kind: 'interview', confidence: 0.95 },
    });
    const single: string[] = [];
    const sync = new EmailSync({
      store, fetcher: mb.fetcher, stages: sqlStages, getPassword: async () => 'pw', now: () => NOW,
      classify: async (i) => { single.push(i.subject); return rules(i); },
      classifyBatch: async () => { throw new Error('model busy'); },
    });
    await sync.start();
    expect(single.sort()).toEqual(['Atlassian update', 'Interview with Canva']);
    expect(stageOf('atl')).toBe('rejected');
  });
});

describe('action item detection (new emails only)', () => {
  it('turns a new scheduling email into an action item, once per application', async () => {
    addApp('mdyn', 'Massive Dynamic', 'interview');
    const calls: any[] = [];
    const actionItems = { upsertDetected: (ctx: any) => { calls.push(ctx); } };
    const mb = fakeMailbox([
      msg('Book your intro call', 'sam@example.com', '2026-09-29T00:00:00Z', { body: 'Pick a time: https://calendar.app.google/abc' }),
    ]);
    const s = new EmailSync({
      store, fetcher: mb.fetcher,
      classify: byRule({ 'Book your intro call': { applicationId: 'mdyn', kind: 'other', confidence: 0.9 } }),
      stages: sqlStages, actionItems, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
    });
    await s.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      detected: { type: 'schedule', url: 'https://calendar.app.google/abc' },
      applicationId: 'mdyn', company: 'Massive Dynamic', role: 'Engineer',
    });
  });

  it('does nothing for an email that matches neither pattern', async () => {
    const calls: any[] = [];
    const actionItems = { upsertDetected: (ctx: any) => { calls.push(ctx); } };
    const mb = fakeMailbox([msg('Thanks for applying', 'careers@canva.com', '2026-09-29T00:00:00Z', { body: 'We received your application.' })]);
    const s = new EmailSync({
      store, fetcher: mb.fetcher,
      classify: byRule({ 'Thanks for applying': { applicationId: 'canva', kind: 'received', confidence: 0.9 } }),
      stages: sqlStages, actionItems, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
    });
    await s.start();
    expect(calls).toHaveLength(0);
  });

  it('a failing action item write never costs the stage change', async () => {
    addApp('mdyn', 'Massive Dynamic', 'assessment');
    const actionItems = { upsertDetected: () => { throw new Error('disk full'); } };
    const mb = fakeMailbox([
      msg('Interview invitation', 'sam@example.com', '2026-09-29T00:00:00Z', { body: 'Pick a time: https://calendly.com/example/interview' }),
    ]);
    const s = new EmailSync({
      store, fetcher: mb.fetcher,
      classify: byRule({ 'Interview invitation': { applicationId: 'mdyn', kind: 'interview', confidence: 0.9 } }),
      stages: sqlStages, actionItems, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
    });
    await s.start();
    expect(stageOf('mdyn')).toBe('interview');
  });

  it('does not pin a scheduling item on an application matched below the auto-apply bar', async () => {
    addApp('mdyn', 'Massive Dynamic', 'interview');
    const calls: any[] = [];
    const actionItems = { upsertDetected: (ctx: any) => { calls.push(ctx); } };
    const mb = fakeMailbox([
      msg('Book a time', 'someone@elsewhere.com', '2026-09-29T00:00:00Z', { body: 'https://calendly.com/someone/chat' }),
    ]);
    const s = new EmailSync({
      store, fetcher: mb.fetcher,
      classify: byRule({ 'Book a time': { applicationId: 'mdyn', kind: 'interview', confidence: 0.3 } }),
      stages: sqlStages, actionItems, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
    });
    await s.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ applicationId: null, company: null });
  });

  it('is a no-op when nothing injects actionItems (production without the dep still works)', async () => {
    const mb = fakeMailbox([msg('Book a time to chat', 'careers@canva.com', '2026-09-29T00:00:00Z', { body: 'Please book a time that suits you.' })]);
    const s = new EmailSync({
      store, fetcher: mb.fetcher,
      classify: byRule({ 'Book a time to chat': { applicationId: 'canva', kind: 'other', confidence: 0.9 } }),
      stages: sqlStages, getPassword: async () => 'pw', now: () => NOW, concurrency: 2,
    });
    await expect(s.start()).resolves.toBeTruthy();
  });
});

describe('two inboxes', () => {
  it('syncs each with its own password, watermark and events; one failing inbox does not stop the other', async () => {
    store.addAccount('second@gmail.com', '2026-09-02T00:00:00Z');
    db.prepare('UPDATE email_accounts SET backlog_done = 1').run();
    const a = msg('Atlassian update', 'no-reply@us.greenhouse-mail.io', '2026-09-20T00:00:00Z', { fromName: 'Atlassian' });
    const b = msg('Application update for Engineer at Canva', 'noreply@s.seek.com.au', '2026-09-21T00:00:00Z', { fromName: 'SEEK Applications' });
    const fwd = msg('Fwd: Interview times', 'me@gmail.com', '2026-09-21T01:00:00Z');
    const boxes: Record<string, ReturnType<typeof fakeMailbox>> = {
      'me@gmail.com': fakeMailbox([a], 7),
      'second@gmail.com': fakeMailbox([b, fwd], 3),
    };
    const passwords: Record<string, string> = {};
    const classify = vi.fn(byRule({
      'Atlassian update': { applicationId: 'atl', kind: 'rejection' },
      'Application update for Engineer at Canva': { applicationId: 'canva', kind: 'interview' },
    }));
    const make = () => new EmailSync({
      store, classify, stages: sqlStages, now: () => NOW, concurrency: 2,
      fetcher: (opts) => { passwords[opts.email] = opts.password; return boxes[opts.email].fetcher(opts); },
      getPassword: async (email) => `pw for ${email}`,
    });
    await make().start();

    expect(passwords).toEqual({ 'me@gmail.com': 'pw for me@gmail.com', 'second@gmail.com': 'pw for second@gmail.com' });
    expect(store.getWatermark('me@gmail.com', '[Gmail]/All Mail')).toEqual({ uidValidity: 7, lastUid: a.uid });
    expect(store.getWatermark('second@gmail.com', '[Gmail]/All Mail')).toEqual({ uidValidity: 3, lastUid: fwd.uid });
    expect(stageOf('atl')).toBe('rejected');
    expect(stageOf('canva')).toBe('interview');
    const byMessage = Object.fromEntries(store.listEvents().map((e) => [e.messageId, e]));
    expect(byMessage[a.messageId].email).toBe('me@gmail.com');
    expect(byMessage[b.messageId].email).toBe('second@gmail.com');
    // Mail between their own two addresses is never a company writing back.
    expect(byMessage[fwd.messageId]).toMatchObject({ status: 'ignored', email: 'second@gmail.com' });
    expect(boxes['second@gmail.com'].seenOpts[0].ownAddresses).toEqual(expect.arrayContaining(['me@gmail.com', 'second@gmail.com']));
    expect(classify).toHaveBeenCalledTimes(2);

    // The first inbox's server is unreachable; the second still syncs.
    const later = msg('Offer letter', 'careers@canva.com', '2026-09-22T00:00:00Z');
    boxes['me@gmail.com'] = { ...boxes['me@gmail.com'], fetcher: async () => { throw new Error('ENOTFOUND imap.gmail.com'); } };
    boxes['second@gmail.com'] = fakeMailbox([b, fwd, later], 3);
    classify.mockImplementation(byRule({ 'Offer letter': { applicationId: 'canva', kind: 'offer' } }));
    const s = await make().start();
    expect(s.phase).toBe('error');
    expect(store.getAccount('me@gmail.com')!.lastError).toContain('ENOTFOUND');
    expect(store.getAccount('second@gmail.com')!.lastError).toBeNull();
    expect(stageOf('canva')).toBe('offer');
  });
});

describe('explainModelFailure', () => {
  it('turns the CLI failures the user can act on into words', async () => {
    const { explainModelFailure, isModelUnavailable } = await import('../email/sync');
    expect(explainModelFailure(new Error(SIGNED_OUT))).toMatch(/signed out.*run claude.*\/login/i);
    expect(isModelUnavailable(new Error(SIGNED_OUT))).toBe(true);
    expect(explainModelFailure(new Error('claude CLI not found / failed to start: spawn claude ENOENT'))).toMatch(/not installed|not found/i);
    expect(isModelUnavailable(new Error('claude CLI not found / failed to start: spawn claude ENOENT'))).toBe(true);
    expect(explainModelFailure(new Error('claude reported an error: Claude AI usage limit reached'))).toMatch(/usage limit/i);
    expect(explainModelFailure(new Error('claude subprocess timed out'))).toMatch(/too long/i);
    expect(isModelUnavailable(new Error('claude subprocess timed out'))).toBe(false);
    expect(isModelUnavailable(new Error('batch result count mismatch'))).toBe(false);
    expect(explainModelFailure(new Error('something odd'))).toContain('something odd');
    expect(explainModelFailure(null)).toMatch(/next sync/);
  });
});

describe('batch prompt', () => {
  it('lists each email with its own shortlist and numbered index', async () => {
    const { classifyBatchPrompt } = await import('../email/classify');
    const p = classifyBatchPrompt([
      { from: 'a@x.com', subject: 'S0', date: '2026-09-01T00:00:00Z', body: 'b0', candidates: [{ id: 'id-a', company: 'A', job_title: 'r', current_stage: 'applied', created_at: '2026-08-01' }] },
      { from: 'b@x.com', subject: 'S1', date: '2026-09-02T00:00:00Z', body: 'b1', candidates: [] },
    ]);
    expect(p).toContain('=== Email 0 ===');
    expect(p).toContain('=== Email 1 ===');
    expect(p.indexOf('id-a')).toBeLessThan(p.indexOf('=== Email 1 ==='));
    expect(p).toContain('(none)');
  });
});

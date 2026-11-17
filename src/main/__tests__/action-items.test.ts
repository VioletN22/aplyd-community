import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { configureCalendar, SYSTEM_CALENDAR_ZONE } from '../../shared/calendar';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, ipcMain: { handle: () => {} } }));

import { createSchema, runMigrationLadder, type MigrationDb } from '../database';
import {
  createActionItem, markActionItemDone, listOpenActionItems, toTodayActionItems,
  appendEmployerToGroupLabel, upsertDetectedActionItem, isActionItemLive, eventIsOver, dismissActionItem,
} from '../action-items';

function fixture(): MigrationDb {
  const db = new DatabaseSync(':memory:') as unknown as MigrationDb;
  createSchema(db);
  runMigrationLadder(db);
  db.exec(`INSERT INTO workflows (id, company, name, stages, is_default, created_at) VALUES ('standard','','Standard','[]',0,'2026-01-01')`);
  const add = db.prepare(`INSERT INTO applications (id, company, job_title, location, job_url, job_source, job_description,
      key_responsibilities, required_skills, nice_to_have_skills, current_stage, workflow_id, created_at, updated_at)
    VALUES (?, ?, ?, '', '', ?, 'd', '', '', '', ?, 'standard', ?, ?)`);
  add.run('mdyn', 'Massive Dynamic', 'Software Engineer', null, 'interview', '2026-09-01', '2026-09-01');
  return db;
}

const NOW = () => new Date('2026-09-29T12:00:00Z');
beforeEach(() => configureCalendar({ timeZone: 'Australia/Sydney', recurring: [] }));
afterEach(() => configureCalendar({ timeZone: SYSTEM_CALENDAR_ZONE, recurring: [] }));

describe('createActionItem / markActionItemDone / listOpenActionItems', () => {
  it('creates an open row, lists it joined to its application, and marking it done removes it from the open list', () => {
    const db = fixture();
    const row = createActionItem(db, {
      application_id: 'mdyn', kind: 'schedule', title: 'Book your interview time',
      url: 'https://calendar.app.google/D3wDTU1hxm32gBX5A', priority: 'high', source: 'agent',
    }, NOW);
    expect(row.id).toBeTruthy();
    expect(row.status).toBe('open');

    const open = listOpenActionItems(db);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: row.id, company: 'Massive Dynamic', role: 'Software Engineer', kind: 'schedule' });

    markActionItemDone(db, row.id, NOW);
    expect(listOpenActionItems(db)).toHaveLength(0);
  });

  it('an unlinked item (application_id null) lists with no company/role', () => {
    const db = fixture();
    createActionItem(db, { application_id: null, kind: 'verify', title: 'Verify SEEK Pass Digital Identity' }, NOW);
    const open = listOpenActionItems(db);
    expect(open[0].company).toBe(null);
    expect(open[0].role).toBe(null);
  });

  it('an unlinked item that names its own single employer keeps that company/role (not "Several employers")', () => {
    const db = fixture();
    createActionItem(db, { application_id: null, kind: 'captcha', title: 'Finish the Contoso hCaptcha', company: 'Contoso', role: 'Customer Experience Representative' }, NOW);
    const open = listOpenActionItems(db);
    expect(open[0]).toMatchObject({ company: 'Contoso', role: 'Customer Experience Representative' });
  });

  it('the linked application always wins over the item\'s own stored company/role, if both are set', () => {
    const db = fixture();
    createActionItem(db, { application_id: 'mdyn', kind: 'schedule', title: 'x', company: 'Stale Old Name', role: 'Stale Role' }, NOW);
    const open = listOpenActionItems(db);
    expect(open[0]).toMatchObject({ company: 'Massive Dynamic', role: 'Software Engineer' });
  });

  it('toTodayActionItems maps the join to camelCase', () => {
    const db = fixture();
    createActionItem(db, { application_id: 'mdyn', kind: 'schedule', title: 'Book your interview time', due_at: null, priority: 'high' }, NOW);
    const items = toTodayActionItems(listOpenActionItems(db));
    expect(items[0]).toMatchObject({ applicationId: 'mdyn', company: 'Massive Dynamic', role: 'Software Engineer', priority: 'high', title: 'Book your interview time' });
  });
});

describe('appendEmployerToGroupLabel', () => {
  it('starts a fresh group label', () => {
    expect(appendEmployerToGroupLabel(null, 'Globex Solutions')).toBe('SEEK Pass: Globex Solutions');
  });
  it('appends a new employer to an existing label', () => {
    expect(appendEmployerToGroupLabel('SEEK Pass: Globex Solutions', 'Umbrella Co'))
      .toBe('SEEK Pass: Globex Solutions, Umbrella Co');
  });
  it('does not repeat an employer already listed', () => {
    expect(appendEmployerToGroupLabel('SEEK Pass: Globex Solutions, Umbrella Co', 'Globex Solutions'))
      .toBe('SEEK Pass: Globex Solutions, Umbrella Co');
  });
});

describe('upsertDetectedActionItem', () => {
  it('creates one schedule item per application, and a second email for the same application does not duplicate it', () => {
    const db = fixture();
    const ctx = {
      detected: { type: 'schedule' as const, url: 'https://calendar.app.google/D3wDTU1hxm32gBX5A' },
      applicationId: 'mdyn', company: 'Massive Dynamic', role: 'Software Engineer',
      email: 'jobs@example.com', messageId: '<m1@x>', sentAt: '2026-09-29T00:00:00Z',
    };
    upsertDetectedActionItem(db, ctx, NOW);
    upsertDetectedActionItem(db, { ...ctx, detected: { type: 'schedule', url: 'https://calendar.app.google/other' }, messageId: '<m2@x>' }, NOW);
    const open = listOpenActionItems(db).filter((r) => r.kind === 'schedule');
    expect(open).toHaveLength(1);
    expect(open[0].url).toBe('https://calendar.app.google/D3wDTU1hxm32gBX5A');
  });

  it('stores the matched application\'s company/role on the item itself, not just via the join', () => {
    const db = fixture();
    upsertDetectedActionItem(db, {
      detected: { type: 'schedule', url: 'https://calendar.app.google/x' },
      applicationId: 'mdyn', company: 'Massive Dynamic', role: 'Software Engineer',
      email: 'jobs@example.com', messageId: '<m1@x>', sentAt: '2026-09-29T00:00:00Z',
    }, NOW);
    const row = db.prepare(`SELECT company, role FROM action_items WHERE kind = 'schedule'`).get() as any;
    expect(row).toEqual({ company: 'Massive Dynamic', role: 'Software Engineer' });
  });

  it('does nothing for a schedule email that never resolved to an application', () => {
    const db = fixture();
    upsertDetectedActionItem(db, {
      detected: { type: 'schedule', url: null }, applicationId: null, company: null, role: null,
      email: 'jobs@example.com', messageId: '<m1@x>', sentAt: '2026-09-29T00:00:00Z',
    }, NOW);
    expect(listOpenActionItems(db)).toHaveLength(0);
  });

  it('folds several SEEK Pass emails into one open item, growing its group_label, and leaves company/role null (it is not about one employer)', () => {
    const db = fixture();
    const base = { detected: { type: 'seek_pass_verify' as const }, applicationId: null, role: null, email: 'primary@example.com', sentAt: '2026-09-29T00:00:00Z' };
    upsertDetectedActionItem(db, { ...base, company: 'Globex Solutions', messageId: '<m1@x>' }, NOW);
    upsertDetectedActionItem(db, { ...base, company: 'Umbrella Co', messageId: '<m2@x>' }, NOW);
    upsertDetectedActionItem(db, { ...base, company: 'Globex Solutions', messageId: '<m3@x>' }, NOW); // repeat employer: no change
    const open = listOpenActionItems(db).filter((r) => r.kind === 'verify');
    expect(open).toHaveLength(1);
    expect(open[0].group_label).toBe('SEEK Pass: Globex Solutions, Umbrella Co');
    expect(open[0].url).toBe('https://app.seekpass.co/digital-identity/start');
    expect(open[0].company).toBe(null);
  });
});

describe('SEEK Pass with an employer that could not be named', () => {
  const base = { detected: { type: 'seek_pass_verify' as const }, applicationId: null, role: null, email: 'primary@example.com', sentAt: '2026-09-29T00:00:00Z' };

  it('opens the one row without writing "(employer unknown)" into it, then adds real names as they come', () => {
    const db = fixture();
    upsertDetectedActionItem(db, { ...base, company: null, messageId: '<m1@x>' }, NOW);
    let open = listOpenActionItems(db).filter((r) => r.kind === 'verify');
    expect(open).toHaveLength(1);
    expect(open[0].group_label).toBe('SEEK Pass');
    expect(open[0].detail).not.toMatch(/unknown/);
    upsertDetectedActionItem(db, { ...base, company: 'Zenith Retail', messageId: '<m2@x>' }, NOW);
    upsertDetectedActionItem(db, { ...base, company: null, messageId: '<m3@x>' }, NOW);
    open = listOpenActionItems(db).filter((r) => r.kind === 'verify');
    expect(open).toHaveLength(1);
    expect(open[0].group_label).toBe('SEEK Pass: Zenith Retail');
    expect(open[0].detail).toBe('Employers asking for Digital Identity: Zenith Retail');
  });

  it('appendEmployerToGroupLabel ignores a null employer and reads a bare prefix as empty', () => {
    expect(appendEmployerToGroupLabel('SEEK Pass: Zenith Retail', null)).toBe('SEEK Pass: Zenith Retail');
    expect(appendEmployerToGroupLabel('SEEK Pass', 'Zenith Retail')).toBe('SEEK Pass: Zenith Retail');
    expect(appendEmployerToGroupLabel(null, null)).toBe('SEEK Pass');
  });
});

describe('which open items Today shows', () => {
  const at = '2026-09-29T07:40:38.000Z';

  it('hides items whose application is rejected or withdrawn', () => {
    expect(isActionItemLive({ kind: 'answer', created_at: at, app_stage: 'rejected', app_interview_at: null })).toBe(false);
    expect(isActionItemLive({ kind: 'answer', created_at: at, app_stage: 'withdrawn', app_interview_at: null })).toBe(false);
    expect(isActionItemLive({ kind: 'answer', created_at: at, app_stage: 'applied', app_interview_at: null })).toBe(true);
    expect(isActionItemLive({ kind: 'verify', created_at: at, app_stage: null, app_interview_at: null })).toBe(true);
  });

  it('hides a "book a time" item once an interview is booked after it came in, not for an older interview', () => {
    expect(isActionItemLive({ kind: 'schedule', created_at: at, app_stage: 'interview', app_interview_at: '2026-10-02T10:00' })).toBe(false);
    expect(isActionItemLive({ kind: 'schedule', created_at: at, app_stage: 'interview', app_interview_at: '2026-09-20T10:00' })).toBe(true);
    expect(isActionItemLive({ kind: 'answer', created_at: at, app_stage: 'interview', app_interview_at: '2026-10-02T10:00' })).toBe(true);
  });

  it('listOpenActionItems applies it: a rejected application\'s item drops off, and the row shape has no extra columns', () => {
    const db = fixture();
    createActionItem(db, { application_id: 'mdyn', kind: 'answer', title: 'Reply' }, NOW);
    expect(listOpenActionItems(db)).toHaveLength(1);
    expect(Object.keys(listOpenActionItems(db)[0])).not.toContain('app_stage');
    db.exec(`UPDATE applications SET current_stage = 'rejected' WHERE id = 'mdyn'`);
    expect(listOpenActionItems(db)).toHaveLength(0);
  });
});

describe('dismissExpiredAssessments', () => {
  it.each([
    ['2026-11-16', '2026-11-16T13:00:00Z', '2026-11-17T07:59:59Z', '2026-11-17T08:00:00Z'],
    ['2026-03-08', '2026-03-08T13:00:00Z', '2026-03-09T06:59:59Z', '2026-03-09T07:00:00Z'],
    ['2026-11-01', '2026-11-01T13:00:00Z', '2026-11-02T07:59:59Z', '2026-11-02T08:00:00Z'],
  ])('keeps an assessment due %s open until Los Angeles midnight, including DST days', (due, morning, lastSecond, midnight) => {
    configureCalendar({ timeZone: 'America/Los_Angeles', recurring: [] });
    const db = fixture();
    const item = createActionItem(db, { kind: 'assessment', title: 'Example assessment', due_at: due }, () => new Date(morning));
    for (const instant of [morning, lastSecond]) {
      expect(listOpenActionItems(db, () => new Date(instant)).map(row => row.id)).toContain(item.id);
      expect(db.prepare('SELECT status FROM action_items WHERE id = ?').get(item.id)).toEqual({ status: 'open' });
    }
    expect(listOpenActionItems(db, () => new Date(midnight))).toHaveLength(0);
    expect(db.prepare('SELECT status FROM action_items WHERE id = ?').get(item.id)).toEqual({ status: 'dismissed' });
  });

  it('dismisses a quiz whose deadline passed, keeps one still open, an undated one, and an overdue non-quiz task', () => {
    const db = fixture();
    const now = () => new Date('2026-10-20T01:00:00Z'); // 12 pm Tue 20 Oct, Sydney
    const closed = createActionItem(db, { application_id: 'mdyn', kind: 'assessment', title: 'Logic quiz', due_at: '2026-10-14T00:00:00Z', priority: 'high', source: 'agent' }, now);
    const lastDay = createActionItem(db, { application_id: 'mdyn', kind: 'quiz', title: 'Quiz due today', due_at: '2026-10-20', priority: 'high', source: 'agent' }, now);
    const later = createActionItem(db, { application_id: 'mdyn', kind: 'assessment', title: 'Codility', due_at: '2026-10-21T06:00:00Z', priority: 'high', source: 'agent' }, now);
    const undated = createActionItem(db, { application_id: 'mdyn', kind: 'assessment', title: 'Choose screening', priority: 'normal', source: 'agent' }, now);
    const lateApply = createActionItem(db, { application_id: 'mdyn', kind: 'apply', title: 'Apply on portal', due_at: '2026-10-07T03:00:00Z', priority: 'normal', source: 'agent' }, now);

    const open = listOpenActionItems(db, now).map((r) => r.id);
    expect(open).not.toContain(closed.id);
    expect(open).toEqual(expect.arrayContaining([lastDay.id, later.id, undated.id, lateApply.id]));
    const status = db.prepare('SELECT status FROM action_items WHERE id = ?').get(closed.id) as { status: string };
    expect(status.status).toBe('dismissed');
  });
});

describe('dismissPassedEvents (via listOpenActionItems)', () => {
  it('keeps a day briefing and an event without an end time until their configured local day ends', () => {
    configureCalendar({ timeZone: 'America/Los_Angeles', recurring: [] });
    const db = fixture();
    const ids = [
      createActionItem(db, { kind: 'review', title: 'Today: interview preparation', due_at: '2026-11-16' }, NOW).id,
      createActionItem(db, { kind: 'meeting', title: 'Example meeting', due_at: '2026-11-16T00:30:00-08:00' }, NOW).id,
    ];
    expect(listOpenActionItems(db, () => new Date('2026-11-16T13:00:00Z')).map(row => row.id)).toEqual(expect.arrayContaining(ids));
    expect(listOpenActionItems(db, () => new Date('2026-11-17T07:59:59Z')).map(row => row.id)).toEqual(expect.arrayContaining(ids));
    expect(listOpenActionItems(db, () => new Date('2026-11-17T08:00:00Z'))).toHaveLength(0);
  });

  it('drops events and day briefings that are over, keeps missed to-dos and events still to come', () => {
    const db = fixture();
    const now = () => new Date('2026-11-01T01:00:00Z'); // 12 pm Sun 1 Nov, Sydney
    const add = (kind: string, title: string, due_at?: string, ends_at?: string) =>
      { const id = createActionItem(db, { kind, title, due_at, priority: 'normal', source: 'agent' } as Parameters<typeof createActionItem>[1], now).id;
        if (ends_at) db.prepare('UPDATE action_items SET ends_at = ? WHERE id = ?').run(ends_at, id);
        return id; };
    const dinner = add('other', 'Dinner with friends', '2026-10-26T08:00:00Z');
    const onNow = add('other', 'Volleyball, no end time', '2026-11-01T00:00:00Z');
    const shift = add('shift', 'Weekend shift', '2026-10-31T21:00:00Z', '2026-11-01T05:00:00Z');
    const brief = add('review', 'Today: Morning call; 2pm meeting', '2026-10-30T00:00:00Z');
    const lateCall = add('follow_up', 'Call Chandrani', '2026-10-30T05:00:00Z');
    const nextShift = add('shift', 'Weekend shift', '2026-11-01T21:00:00Z', '2026-11-02T05:00:00Z');
    const open = listOpenActionItems(db, now).map((r) => r.id);
    expect(open).toEqual(expect.arrayContaining([shift, onNow, lateCall, nextShift]));
    expect(open).not.toContain(dinner);
    expect(open).not.toContain(brief);
  });
  it('treats undated, date-only and unreadable events as not over', () => {
    const now = new Date('2026-11-01T01:00:00Z');
    expect(eventIsOver({ kind: 'other', title: 'Volleyball', due_at: null, ends_at: null }, now)).toBe(false);
    expect(eventIsOver({ kind: 'other', title: 'Volleyball', due_at: '2026-10-26', ends_at: null }, now)).toBe(false);
    expect(eventIsOver({ kind: 'other', title: 'Volleyball', due_at: '2026-10-26Tnope', ends_at: null }, now)).toBe(false);
    expect(eventIsOver({ kind: 'review', title: 'Today: plan', due_at: '2026-11-01', ends_at: null }, now)).toBe(false);
  });
  it('dismissActionItem closes the item without counting it as done', () => {
    const db = fixture();
    const id = createActionItem(db, { kind: 'apply', title: 'Old apply', priority: 'normal', source: 'agent' } as Parameters<typeof createActionItem>[1], NOW).id;
    dismissActionItem(db, id, NOW);
    expect((db.prepare('SELECT status, done_at FROM action_items WHERE id = ?').get(id) as { status: string; done_at: string | null })).toEqual({ status: 'dismissed', done_at: null });
  });
});

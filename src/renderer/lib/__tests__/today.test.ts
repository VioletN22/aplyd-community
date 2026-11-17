import { describe, it, expect } from 'vitest';
import { interviewWhen, isCaughtUp, dueInstant, dueWhen } from '../today';
import { setDisplayLocale } from '../../../shared/locale';

// Pin a day-first locale so the formatted dates below do not depend on the
// machine running the tests.
setDisplayLocale('en-AU');

const empty = { draftsReady: [], interviewsSoon: [], assessmentsDue: [], actionItems: [], goingQuiet: [] };

describe('isCaughtUp', () => {
  it('is true only when every list is empty', () => {
    expect(isCaughtUp(empty)).toBe(true);
    expect(isCaughtUp({ ...empty, goingQuiet: [{ applicationId: 'a', company: 'c', role: 'r', daysQuiet: 19 }] })).toBe(false);
  });
});

describe('interviewWhen', () => {
  const now = new Date(2026, 8, 24, 9, 0).getTime();
  it('names today and tomorrow', () => {
    expect(interviewWhen('2026-09-24T14:30', now)).toMatch(/^Today, 2:30\s?pm$/);
    expect(interviewWhen('2026-09-25T10:00', now)).toMatch(/^Tomorrow, 10:00\s?am$/);
  });
  it('uses a short date further out', () => {
    expect(interviewWhen('2026-09-29T09:00', now)).toMatch(/^Tue 29 Sept?, 9:00\s?am$/);
  });
  it('is empty for junk', () => {
    expect(interviewWhen('nope', now)).toBe('');
  });
});

import { todayItems, todayHeadline, sortActionItems } from '../today';

describe('todayItems ordering', () => {
  const now = new Date('2026-09-24T09:00:00').getTime();
  const base = { draftsReady: [], interviewsSoon: [], assessmentsDue: [], actionItems: [], goingQuiet: [] };

  it('puts an interview within 36h first, then later interviews, drafts, quiet', () => {
    const items = todayItems({
      draftsReady: [
        { applicationId: 'd1', company: 'Old', role: 'r', updatedAt: '2026-09-23T09:00:00' },
        { applicationId: 'd2', company: 'New', role: 'r', updatedAt: '2026-09-24T08:00:00' },
      ],
      interviewsSoon: [
        { applicationId: 'i2', company: 'Later', role: 'r', interviewAt: '2026-09-29T10:00:00', emailUrl: null, jobUrl: null },
        { applicationId: 'i1', company: 'Soon', role: 'r', interviewAt: '2026-09-24T16:30:00', emailUrl: null, jobUrl: null },
      ],
      assessmentsDue: [],
      actionItems: [],
      goingQuiet: [
        { applicationId: 'q1', company: 'A', role: 'r', daysQuiet: 18 },
        { applicationId: 'q2', company: 'B', role: 'r', daysQuiet: 20 },
      ],
    }, now);
    expect(items.map((i) => i.key)).toEqual(['iv-i1', 'iv-i2', 'dr-d2', 'dr-d1', 'q-q2', 'q-q1']);
  });

  it('has no email item: email applies by itself', () => {
    const items = todayItems({ ...base,
      draftsReady: [{ applicationId: 'd', company: 'C', role: 'r', updatedAt: '2026-09-24T08:00:00' }] }, now);
    expect(items.map((i) => i.kind)).toEqual(['draft']);
  });

  it('is empty when nothing needs the user', () => {
    expect(todayItems(base, now)).toEqual([]);
  });

  it('puts an assessment due within 36h right after soon interviews, and later ones before drafts', () => {
    const items = todayItems({
      draftsReady: [{ applicationId: 'd1', company: 'Drafted', role: 'r', updatedAt: '2026-09-24T08:00:00' }],
      interviewsSoon: [{ applicationId: 'i1', company: 'Soon interview', role: 'r', interviewAt: '2026-09-24T16:30:00', emailUrl: 'https://mail.example/i1', jobUrl: null }],
      assessmentsDue: [
        { applicationId: 'a2', company: 'Later assessment', role: 'r', dueAt: '2026-09-29T09:00:00', stage: 'assessment', emailUrl: null, jobUrl: null },
        { applicationId: 'a1', company: 'Soon assessment', role: 'r', dueAt: '2026-09-24T20:00:00', stage: 'assessment', emailUrl: 'https://mail.example/a1', jobUrl: 'https://jobs.example/a1' },
        { applicationId: 'a3', company: 'Undated assessment', role: 'r', dueAt: null, stage: 'assessment', emailUrl: null, jobUrl: null },
      ],
      actionItems: [],
      goingQuiet: [],
    }, now);
    expect(items.map((i) => i.key)).toEqual(['iv-i1', 'as-a1', 'as-a2', 'as-a3', 'dr-d1']);
    const a1 = items.find((i) => i.key === 'as-a1')!;
    expect(a1).toMatchObject({ kind: 'assessment', action: 'Finish your assessment', emailUrl: 'https://mail.example/a1', jobUrl: 'https://jobs.example/a1' });
    expect(a1.when).toMatch(/^Due Today, 8:00\s?pm$/);
    expect(items.find((i) => i.key === 'as-a3')?.when).toBe('');
    expect(items.find((i) => i.key === 'iv-i1')).toMatchObject({ emailUrl: 'https://mail.example/i1', jobUrl: null });
  });

  it('isCaughtUp counts assessmentsDue', () => {
    expect(isCaughtUp({ ...base })).toBe(true);
    expect(isCaughtUp({ ...base, assessmentsDue: [{ applicationId: 'a', company: 'c', role: 'r', dueAt: null, stage: 'assessment', emailUrl: null, jobUrl: null }] })).toBe(false);
  });

  it('a take_home reads "Finish your take-home" and merges into the same bucket as assessment, ordered by due time', () => {
    const items = todayItems({ ...base,
      assessmentsDue: [
        { applicationId: 'th1', company: 'Vandelay', role: 'r', dueAt: '2026-09-30T09:00:00', stage: 'take_home', emailUrl: null, jobUrl: null },
        { applicationId: 'as1', company: 'Nimbus AI', role: 'r', dueAt: '2026-09-26T13:44:00', stage: 'assessment', emailUrl: null, jobUrl: null },
      ] }, now);
    expect(items.map((i) => i.key)).toEqual(['as-as1', 'as-th1']);
    expect(items.find((i) => i.key === 'as-th1')).toMatchObject({ kind: 'assessment', action: 'Finish your take-home' });
    expect(items.find((i) => i.key === 'as-as1')).toMatchObject({ kind: 'assessment', action: 'Finish your assessment' });
  });

  const actionItem = (o: Partial<{ id: string; applicationId: string | null; kind: string; title: string; detail: string | null; company: string | null; role: string | null; groupLabel: string | null; dueAt: string | null; priority: 'high' | 'normal' | 'low'; url: string | null; emailUrl: string | null }>) => ({
    id: 'x', applicationId: null, kind: 'schedule', title: 'Do the thing', detail: null, company: null, role: null,
    groupLabel: null, dueAt: null, priority: 'normal' as const, url: null, emailUrl: null, ...o,
  });

  describe('sortActionItems', () => {
    it('sorts by due time, soonest first', () => {
      const sorted = sortActionItems([
        actionItem({ id: 'later', dueAt: '2026-09-30T09:00:00' }),
        actionItem({ id: 'sooner', dueAt: '2026-09-25T09:00:00' }),
      ]);
      expect(sorted.map((a) => a.id)).toEqual(['sooner', 'later']);
    });

    it('puts an undated high-priority item before an undated normal one', () => {
      const sorted = sortActionItems([
        actionItem({ id: 'normal', priority: 'normal' }),
        actionItem({ id: 'high', priority: 'high' }),
      ]);
      expect(sorted.map((a) => a.id)).toEqual(['high', 'normal']);
    });

    it('sinks every low-priority item to the end, dated or not', () => {
      const sorted = sortActionItems([
        actionItem({ id: 'low-dated', priority: 'low', dueAt: '2026-09-20T00:00:00' }),
        actionItem({ id: 'normal-undated', priority: 'normal' }),
        actionItem({ id: 'high-dated', priority: 'high', dueAt: '2026-09-30T00:00:00' }),
      ]);
      expect(sorted.map((a) => a.id)).toEqual(['high-dated', 'normal-undated', 'low-dated']);
    });
  });

  it('an action item card: title as the action, company/role or group_label as subtitle, links carried through', () => {
    const items = todayItems({ ...base,
      actionItems: [
        actionItem({ id: 'linked', applicationId: 'app1', company: 'Massive Dynamic', role: 'Software Engineer', title: 'Book your interview time', dueAt: '2026-09-24T20:00:00', priority: 'high', url: 'https://calendar.app.google/x', emailUrl: 'https://mail.example/fb' }),
        actionItem({ id: 'grouped', title: 'Verify SEEK Pass Digital Identity', groupLabel: 'SEEK Pass: Globex Solutions, Umbrella Co', priority: 'normal', url: 'https://app.seekpass.co/digital-identity/start' }),
      ] }, now);
    const linked = items.find((i) => i.key === 'ai-linked')!;
    expect(linked).toMatchObject({
      kind: 'action', action: 'Book your interview time', title: 'Massive Dynamic', subtitle: 'Software Engineer',
      applicationId: 'app1', jobUrl: 'https://calendar.app.google/x', jobUrlLabel: 'Open', emailUrl: 'https://mail.example/fb', actionItemId: 'linked',
    });
    expect(linked.when).toMatch(/^Due Today, 8:00\s?pm$/);
    const grouped = items.find((i) => i.key === 'ai-grouped')!;
    expect(grouped).toMatchObject({ title: 'Several employers', subtitle: 'SEEK Pass: Globex Solutions, Umbrella Co', applicationId: undefined });
  });

  it('an unlinked item that names its own single employer titles as that company, not "Several employers"', () => {
    const items = todayItems({ ...base,
      actionItems: [actionItem({ id: 'contoso', title: 'Finish the Contoso hCaptcha', company: 'Contoso', role: 'Customer Experience Representative' })] }, now);
    expect(items.find((i) => i.key === 'ai-contoso')).toMatchObject({ title: 'Contoso', subtitle: 'Customer Experience Representative' });
  });

  it('an unlinked item with neither a company nor a group_label falls back to "Action needed", never "Several employers"', () => {
    const items = todayItems({ ...base, actionItems: [actionItem({ id: 'mystery', title: 'Do the mystery thing' })] }, now);
    expect(items.find((i) => i.key === 'ai-mystery')).toMatchObject({ title: 'Action needed', subtitle: '' });
  });

  it('an action item due within 36h sits with the soon interviews/assessments; a low-priority one sinks below quiet', () => {
    const items = todayItems({
      draftsReady: [],
      interviewsSoon: [{ applicationId: 'i1', company: 'Soon interview', role: 'r', interviewAt: '2026-09-24T16:30:00', emailUrl: null, jobUrl: null }],
      assessmentsDue: [],
      actionItems: [
        actionItem({ id: 'soon', dueAt: '2026-09-24T20:00:00', priority: 'high' }),
        actionItem({ id: 'later', dueAt: '2026-09-30T00:00:00', priority: 'normal' }),
        actionItem({ id: 'low', dueAt: null, priority: 'low' }),
      ],
      goingQuiet: [{ applicationId: 'q1', company: 'A', role: 'r', daysQuiet: 18 }],
    }, now);
    expect(items.map((i) => i.key)).toEqual(['iv-i1', 'ai-soon', 'ai-later', 'q-q1', 'ai-low']);
  });

  it('isCaughtUp counts actionItems', () => {
    expect(isCaughtUp({ ...base })).toBe(true);
    expect(isCaughtUp({ ...base, actionItems: [actionItem({})] })).toBe(false);
  });

  it('words the headline', () => {
    expect(todayHeadline(0)).toBe('All caught up.');
    expect(todayHeadline(1)).toBe('1 thing needs you');
    expect(todayHeadline(4)).toBe('4 things need you');
  });
});

describe('due dates (local, not UTC)', () => {
  const now = new Date(2026, 8, 29, 12, 0).getTime();
  const as = (applicationId: string, dueAt: string | null) =>
    ({ applicationId, company: applicationId, role: 'r', dueAt, stage: 'assessment' as const, emailUrl: null, jobUrl: null });

  it('reads a bare date as the end of that local day, a local datetime as-is', () => {
    expect(dueInstant('2026-10-03')).toBe(new Date(2026, 9, 3, 23, 59, 59, 999).getTime());
    expect(dueInstant('2026-10-04T09:45:00')).toBe(new Date(2026, 9, 4, 9, 45).getTime());
    expect(dueInstant('4 weeks after posting date')).toBeNaN();
    expect(dueInstant(null)).toBeNaN();
  });

  it('words a bare date without a made-up time, and says nothing for an unreadable one', () => {
    expect(dueWhen('2026-09-29', now)).toBe('Due Today');
    expect(dueWhen('2026-09-30', now)).toBe('Due Tomorrow');
    expect(dueWhen('2026-09-30T09:45:00', now)).toMatch(/^Due Tomorrow, 9:45\s?am$/);
    expect(dueWhen('4 weeks after posting date', now)).toBe('');
  });

  it('a bare date due today still counts as soon all day, and unreadable ones sort last without a dangling "Due"', () => {
    const items = todayItems({ ...empty, assessmentsDue: [as('text', 'asap'), as('undated', null), as('later', '2026-10-20'), as('today', '2026-09-29')] }, now);
    expect(items.map((i) => i.applicationId)).toEqual(['today', 'later', 'text', 'undated']);
    expect(items.find((i) => i.applicationId === 'text')!.when).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { parseLeadImport } from '../lead-import';
import { LEAD_SEGMENTS, SEGMENT_LABELS, segmentFromInput } from '../leads';
const header = 'id,segment,org,to,subject,status,sent_at,followup_due,reply,next_step\n';

describe('outreach import', () => {
  it('reads quoted commas/newlines and original message evidence without treating auto-ack as a reply', () => {
    const rows = parseLeadImport(header + 'a1,clubs,"Club, Sydney",club@example.com,"A subject\nwith line",sent,2026-10-01T15:40,2026-10-06,auto-ack,<msg-1>\n', 'email,reason,date\n');
    expect(rows.leads[0]).toMatchObject({ org: 'Club, Sydney', segment: 'group_a', stage: 'contacted' });
    expect(rows.events[0]).toMatchObject({ kind: 'email_sent', at: '2026-10-01T15:40' });
    expect(rows.events[0].detail).toContain('<msg-1>');
    expect(rows.events.some(e => e.kind === 'reply')).toBe(false);
  });
  it('reads the older segment names 3d and local, suppresses and detects competitors', () => {
    const input = header + 'b1,3d,Globex Depot,hello@globex.com,Hi,sent,2026-10-01,, ,<m1>\n' +
      'c1,local,Dentist,clinic@example.com,Hi,sent,2026-10-01,,,<m2>\n' +
      'd1,local,Shop,shop@example.com,Hi,sent,2026-10-01,,,<m3>\n';
    const result = parseLeadImport(input, 'email,reason,date\nHELLO@globex.com,no thanks,2026-10-02\n', ['Globex']);
    expect(result.leads.map(l => l.segment)).toEqual(['group_d', 'group_b', 'group_b']);
    expect(result.leads[0]).toMatchObject({ do_not_contact: 1, conflict_flag: 1 });
  });
  it('deduplicates email recipients and message IDs, and refuses unsent rows', () => {
    const row = 'a1,clubs,Club,club@example.com,Hi,sent,2026-10-01,,,<m>\n';
    const result = parseLeadImport(header + row + row + 'a2,clubs,Other,no@example.com,Hi,draft,,,,\n', 'email,reason,date\n');
    expect(result.leads).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});

describe('segment values in an import', () => {
  const row = (segment: string, n: number) => `r${n},${segment},Org ${n},o${n}@example.com,Hi,sent,2026-10-01,,,<m${n}>\n`;
  it.each([
    ['clubs', 'group_a'], ['LOCAL', 'group_b'], ['Ai', 'group_c'], ['3D', 'group_d'],
    ['Group A', 'group_a'], ['group b', 'group_b'], ['GROUP  C', 'group_c'], [' Group D ', 'group_d'],
    ['A', 'group_a'], ['b', 'group_b'], ['C', 'group_c'], ['d', 'group_d'],
    ['group_a', 'group_a'], ['GROUP_D', 'group_d'],
  ])('reads %s as %s', (input, key) => {
    const result = parseLeadImport(header + row(input, 1), 'email,reason,date\n');
    expect(result.problems).toEqual([]);
    expect(result.leads[0].segment).toBe(key);
  });
  it('maps each letter to the segment its visible label names', () => {
    for (const key of LEAD_SEGMENTS) {
      const letter = SEGMENT_LABELS[key].slice(-1);
      expect(segmentFromInput(letter)).toBe(key);
      expect(segmentFromInput(SEGMENT_LABELS[key])).toBe(key);
    }
  });
  it('explains an unknown segment row by row and lists the accepted values', () => {
    const result = parseLeadImport(header + row('E', 1) + row('clubs', 2) + row('', 3), 'email,reason,date\n');
    expect(result.leads.map(l => l.org)).toEqual(['Org 2']);
    expect(result.skipped).toBe(2);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/^Row 1 \(Org 1\): the segment "E" is not one Aplyd knows\./);
    expect(result.problems[0]).toContain('Group A, Group B, Group C, Group D, or the letters A to D');
    expect(result.problems[1]).toMatch(/^Row 3 \(Org 3\): the segment is empty\./);
  });
  it('adds suppressed emails that were never sent to as prospect leads marked Do not contact', () => {
    const result = parseLeadImport(header, 'email,reason,date\nnew@example.com,asked to stop,2026-10-02\n');
    expect(result.leads).toEqual([expect.objectContaining({ contact_email: 'new@example.com', stage: 'prospect', do_not_contact: 1 })]);
  });
});

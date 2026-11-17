import { describe, it, expect } from 'vitest';
import { detectActionEmail } from '../email/action-detect';

describe('detectActionEmail', () => {
  it('spots a calendar.app.google booking link', () => {
    const r = detectActionEmail({
      subject: 'Book your intro call',
      body: 'Pick a time on his calendar: https://calendar.app.google/D3wDTU1hxm32gBX5A, or reply with times that suit you.',
    });
    expect(r).toEqual({ type: 'schedule', url: 'https://calendar.app.google/D3wDTU1hxm32gBX5A' });
  });

  it('spots a calendly link', () => {
    const r = detectActionEmail({ subject: 'Interview scheduling', body: 'Select a time here: https://acme.calendly.com/interview/30min' });
    expect(r).toEqual({ type: 'schedule', url: 'https://acme.calendly.com/interview/30min' });
  });

  it('strips trailing punctuation a sentence leaves on a bare link', () => {
    const r = detectActionEmail({ subject: '', body: 'Book here: https://calendar.app.google/abc123.' });
    expect(r).toEqual({ type: 'schedule', url: 'https://calendar.app.google/abc123' });
  });

  it('still detects a scheduling ask with no link, from wording alone', () => {
    expect(detectActionEmail({ subject: '', body: 'Please book a time that works for you.' })).toEqual({ type: 'schedule', url: null });
    expect(detectActionEmail({ subject: '', body: 'Could you select a time for your interview?' })).toEqual({ type: 'schedule', url: null });
    expect(detectActionEmail({ subject: 'Next steps', body: 'Please schedule your interview at your earliest convenience.' })).toEqual({ type: 'schedule', url: null });
  });

  it('spots a SEEK Pass Digital Identity request', () => {
    const r = detectActionEmail({ subject: 'Action needed', body: 'This employer has requested SEEK Pass Digital Identity verification.' });
    expect(r).toEqual({ type: 'seek_pass_verify' });
  });

  it('does not confuse SEEK Pass Right to Work (a different check) with Digital Identity', () => {
    expect(detectActionEmail({ subject: '', body: 'Your SEEK Pass Right to Work has been verified.' })).toBe(null);
  });

  it('is null for an ordinary email', () => {
    expect(detectActionEmail({ subject: 'Thanks for applying', body: 'We received your application and will be in touch.' })).toBe(null);
  });

  it('does not treat Calendly\'s own "you are booked" cancel/reschedule links as a booking ask', () => {
    expect(detectActionEmail({
      subject: 'Confirmed: Intro call with Sam',
      body: 'Need to make changes? Cancel: https://calendly.com/cancellations/abc-123 Reschedule: https://calendly.com/reschedulings/abc-123',
    })).toBe(null);
  });

  it('still finds the booking link when a manage link comes first', () => {
    expect(detectActionEmail({
      subject: 'Pick a new slot',
      body: 'Old: https://calendly.com/cancellations/x1 New: https://calendly.com/example/intro',
    })).toEqual({ type: 'schedule', url: 'https://calendly.com/example/intro' });
  });
});

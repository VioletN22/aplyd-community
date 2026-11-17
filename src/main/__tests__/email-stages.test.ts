import { describe, it, expect } from 'vitest';
import { targetStage, decideStage, isPhoneScreen, emailNote, changesSomething } from '../email/stages';

describe('kind -> stage', () => {
  it('maps each kind', () => {
    expect(targetStage('received')).toBe(null);
    expect(targetStage('rejection')).toBe('rejected');
    expect(targetStage('interview')).toBe('interview');
    expect(targetStage('interview', 'Could we set up a quick phone call?')).toBe('phone_screen');
    expect(targetStage('interview', 'Invitation to a screening call')).toBe('phone_screen');
    expect(targetStage('assessment')).toBe('assessment');
    expect(targetStage('offer')).toBe('offer');
    expect(targetStage('other')).toBe(null);
  });

  it('spots phone screens but not an in-person interview', () => {
    expect(isPhoneScreen('phone screen with the hiring manager')).toBe(true);
    expect(isPhoneScreen('Please join us for an interview at our Sydney office')).toBe(false);
  });
});

describe('decideStage: never backwards, never out of a final stage', () => {
  it('moves forward', () => {
    expect(decideStage('interview', 'applied')).toEqual({ proposedStage: 'interview', blocked: null });
    expect(decideStage('interview', 'phone_screen')).toEqual({ proposedStage: 'interview', blocked: null });
    expect(decideStage('rejection', 'interview')).toEqual({ proposedStage: 'rejected', blocked: null });
    expect(decideStage('offer', 'interview')).toEqual({ proposedStage: 'offer', blocked: null });
  });

  it('refuses to move backwards', () => {
    expect(decideStage('interview', 'interview', 'phone call')).toEqual({ proposedStage: null, blocked: 'backwards' });
    expect(decideStage('interview', 'offer')).toEqual({ proposedStage: null, blocked: 'final' });
  });

  it('never leaves rejected, offer or withdrawn', () => {
    for (const final of ['rejected', 'offer', 'withdrawn']) {
      for (const kind of ['rejection', 'interview', 'offer'] as const) {
        expect(decideStage(kind, final).proposedStage, `${kind} on ${final}`).toBe(null);
      }
    }
  });

  it('logs an email about an app already at that stage instead of re-applying', () => {
    expect(decideStage('interview', 'interview')).toEqual({ proposedStage: null, blocked: 'same' });
  });

  it('received changes nothing', () => {
    const r = decideStage('received', 'applied');
    expect(r.proposedStage).toBe(null);
    expect(changesSomething('received', r)).toBe(false);
  });

  it('an assessment email moves applied (No response included: it is applied) to Assessment', () => {
    const a = decideStage('assessment', 'applied');
    expect(a).toEqual({ proposedStage: 'assessment', blocked: null });
    expect(changesSomething('assessment', a)).toBe(true);
  });

  it('an assessment email never moves anything back, nor done back to to-do', () => {
    expect(decideStage('assessment', 'assessment')).toEqual({ proposedStage: null, blocked: 'same' });
    for (const stage of ['take_home', 'assessed', 'oa', 'phone_screen', 'interview']) {
      expect(decideStage('assessment', stage), `from ${stage}`).toEqual({ proposedStage: null, blocked: 'backwards' });
    }
    for (const stage of ['offer', 'rejected', 'withdrawn']) {
      expect(decideStage('assessment', stage), `from ${stage}`).toEqual({ proposedStage: null, blocked: 'final' });
    }
    expect(decideStage('assessment', 'final_round').proposedStage).toBe(null);
    // Still noted on the application even when the stage stays.
    expect(changesSomething('assessment', decideStage('assessment', 'assessed'))).toBe(true);
  });

  it('does not push a genuinely unknown custom stage around with an interview email', () => {
    expect(decideStage('interview', 'final_round').proposedStage).toBe(null);
    expect(decideStage('rejection', 'final_round').proposedStage).toBe('rejected');
  });

  it('does move the recognised Today custom stages forward: interview, offer and rejection all outrank them', () => {
    for (const stage of ['assessment', 'take_home', 'assessed']) {
      expect(decideStage('interview', stage).proposedStage, `interview from ${stage}`).toBe('interview');
      expect(decideStage('offer', stage).proposedStage, `offer from ${stage}`).toBe('offer');
      expect(decideStage('rejection', stage).proposedStage, `rejection from ${stage}`).toBe('rejected');
    }
  });
});

describe('emailNote', () => {
  it('formats "From email: <subject> (<d Mon>)"', () => {
    expect(emailNote('Interview   invitation', '2026-09-03T10:00:00Z')).toBe('From email: Interview invitation (3 Sep)');
  });
});

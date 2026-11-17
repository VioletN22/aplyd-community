import React from 'react';

/** How far along the funnel a stage is, as a pie fill from 0 to 100. */
export function stagePie(stage: string): number {
  switch (stage) {
    case 'applied': return 8;
    case 'assessment': case 'take_home': case 'oa': return 30;
    case 'assessed': return 50;
    case 'phone_screen': return 62;
    case 'interview': return 75;
    case 'offer': case 'rejected': case 'withdrawn': return 100;
    default: return 8;
  }
}

/** One colour per stage family, matching the calendar: red talking, orange tested, green won. */
export function stageColor(stage: string): string {
  switch (stage) {
    case 'offer': return 'var(--green)';
    case 'interview': case 'phone_screen': return 'var(--red)';
    case 'assessment': case 'take_home': case 'oa': return 'var(--orange)';
    case 'assessed': return '#b08a1e';
    case 'rejected': case 'withdrawn': return 'var(--faint)';
    default: return 'var(--accent)';
  }
}

/** The Things-style project pie: a ring with a filled wedge. */
export const Pie: React.FC<{ value: number; color: string; size?: number; title?: string }> = ({ value, color, size = 16, title }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ flex: 'none' }}>
    <circle cx="8" cy="8" r="6.6" fill="none" stroke={color} strokeWidth={1.4} />
    <circle cx="8" cy="8" r="2.7" fill="none" stroke={color} strokeWidth={5.4} pathLength={100} strokeDasharray={`${value} 100`} transform="rotate(-90 8 8)" />
  </svg>
);

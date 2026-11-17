import React from 'react';
import { MapPin } from 'lucide-react';
import { ChipTone, locationTone, sourceChip } from '../lib/chipColors';

/*
 * One shape per chip category, so a chip's kind reads before its colour does:
 *   stage    - square, filled, uppercase (StatusBadge / StageChip)
 *   source   - rounded, filled, normal case
 *   location - rounded, outlined in the hue, pin icon
 *   flag     - rounded, tinted, leading dot (RowTag-sized)
 * Colours come from lib/chipColors.ts.
 */

const base: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', flex: 'none', maxWidth: '100%',
  fontSize: '12px', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

/** The board or ATS the job came from: short label, full text on hover. */
export const SourceChip: React.FC<{ source: string | null | undefined; style?: React.CSSProperties }> = ({ source, style }) => {
  const chip = sourceChip(source);
  if (!chip) return null;
  return (
    <span
      title={source ?? undefined}
      style={{
        ...base, padding: '1px 7px', borderRadius: '8px', fontWeight: 600,
        backgroundColor: chip.tone.bg, color: chip.tone.fg, ...style,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chip.label}</span>
    </span>
  );
};

/** A metro (Sydney, Melbourne) or Regional. */
export const LocationChip: React.FC<{ place: string; title?: string; style?: React.CSSProperties }> = ({ place, title, style }) => {
  const t = locationTone(place);
  return (
    <span
      title={title}
      style={{
        ...base, gap: '3px', padding: '0 6px', borderRadius: '6px', fontWeight: 600,
        border: `1px solid ${t.dot}`, backgroundColor: '#fff', color: t.fg, ...style,
      }}
    >
      <MapPin size={10} aria-hidden style={{ flex: 'none' }} />
      {place}
    </span>
  );
};

/** A row flag that wants attention: interview booked, draft ready, no response. */
export const FlagChip: React.FC<{ tone: ChipTone; title?: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ tone, title, icon, children }) => (
  <span
    title={title}
    style={{
      ...base, gap: '5px', padding: '1px 7px', borderRadius: '6px',
      backgroundColor: tone.bg, color: tone.fg,
    }}
  >
    {icon ?? <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot, flex: 'none' }} />}
    {children}
  </span>
);

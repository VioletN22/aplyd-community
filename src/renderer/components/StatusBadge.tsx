import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { stageTone } from '../lib/chipColors';
import { stageLabel } from '../lib/stages';

// One distinct colour per stage so the pipeline reads at a glance; unknown and
// custom stages get a stable hashed colour (lib/chipColors.ts).
const meta = (s: string) => {
  const t = stageTone(s);
  return { label: s === 'oa' ? 'OA' : stageLabel(s), bg: t.bg, fg: t.fg, dot: t.dot };
};

export const stageMeta = meta;

/** The badge look without the menu: a read-only stage (or kind) label. */
export const StageChip: React.FC<{ stage: string; label?: string }> = ({ stage, label }) => {
  const m = meta(stage);
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '1px 9px', borderRadius: '10px',
        backgroundColor: m.bg, color: m.fg, fontSize: '12px',
        fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.5,
      }}
    >
      {label ?? m.label}
    </span>
  );
};

interface Props {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Drop the stacking margin: the badge is sitting inside a single-line row. */
  dense?: boolean;
}

export const StatusBadge: React.FC<Props> = ({ value, options, onChange, dense }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cur = meta(value);

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div style={{ display: 'inline-flex', marginBottom: dense ? 0 : '8px' }}>
      <button
        ref={triggerRef}
        type="button"
        title="Change status"
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openMenu(); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '2px 8px 2px 10px', backgroundColor: cur.bg, color: cur.fg, borderRadius: '11px',
          fontSize: '12px', lineHeight: 1.5,
          fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}
      >
        {cur.label}
        <ChevronDown size={11} style={{ color: cur.fg, opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, minWidth: '180px', zIndex: 1000,
            backgroundColor: 'var(--bg)', border: 'none', borderRadius: '10px', padding: '4px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {options.map((opt) => {
            const m = meta(opt);
            const isSel = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(opt); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 10px', backgroundColor: 'transparent', border: 'none', borderRadius: '6px',
                  fontFamily: 'inherit', fontSize: '13px',
                  color: 'var(--ink)', fontWeight: isSel ? 600 : 400, cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--panel)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{m.label}</span>
                {isSel && <Check size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};

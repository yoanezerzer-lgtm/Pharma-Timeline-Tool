import { useId, useState, type ReactNode } from 'react';
import './Info.css';

/**
 * A small (i) button holding a plain-language note on what a section shows.
 * Opens on hover, click, tap or keyboard; closes on Escape or moving away.
 */
export function Info({ label, children, align = 'left' }: { label: string; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="info"
      // Hover only for a real mouse: after a tap, phones report the pointer leaving.
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        type="button"
        className="info__button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        i
      </button>
      {open && (
        <span role="note" id={id} className={`info__note info__note--${align}`}>
          {children}
        </span>
      )}
    </span>
  );
}

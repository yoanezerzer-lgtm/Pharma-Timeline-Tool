import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { labelWidth, mergeMarkers, type MarkerCluster } from '../../lib/markers.js';
import './ApprovalMarkers.css';

export interface MarkerEvent {
  id: string;
  /** The product name drawn beside the diamond. */
  label: string;
  /** "First approval for this disease · 28 Mar 2017". */
  detail: string;
  /** 0–100 along the axis. */
  pct: number;
  href?: string;
  /** Citation chips (or anything else) shown after the event in the open list. */
  extra?: ReactNode;
}

/**
 * Event markers above the timeline's year axis: a diamond and a product name
 * at each event, with a dashed guide down to the axis. Markers whose labels
 * would overlap merge into a numbered circle; hovering, focusing or clicking
 * it lists the events. Hidden on phones, where the axis is too.
 */
export function ApprovalMarkers({ events, caption }: { events: MarkerEvent[]; caption: string }) {
  const band = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = band.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Escape or a click elsewhere closes an open group.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onDown = (e: PointerEvent) => !(e.target as HTMLElement).closest?.('.markers__cluster') && setOpen(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const clusters =
    width > 0
      ? mergeMarkers(
          events.map((e) => ({ id: e.id, x: (e.pct / 100) * width, width: labelWidth(e.label), item: e })),
          8,
        )
      : [];

  return (
    <div className="ind-timeline__axis markers__row">
      <div className="markers__caption">{caption}</div>
      <div className="markers" ref={band} role="list" aria-label={caption}>
        {clusters.map((c) =>
          c.members.length === 1 ? (
            <Single key={c.members[0].id} c={c} width={width} />
          ) : (
            <Cluster key={c.members.map((m) => m.id).join('|')} c={c} width={width} open={open} setOpen={setOpen} />
          ),
        )}
      </div>
      <div />
    </div>
  );
}

const leftOf = (x: number, width: number) => `${(x / width) * 100}%`;

function Single({ c, width }: { c: MarkerCluster<MarkerEvent>; width: number }) {
  const e = c.members[0].item;
  const tip = useId();
  // Keep a label near either end inside the band.
  const align = c.x < c.width / 2 ? 'start' : c.x > width - c.width / 2 ? 'end' : 'mid';
  const body = (
    <>
      <span className={`markers__label markers__label--${align}`}>{e.label}</span>
      <span className="markers__diamond" aria-hidden="true" />
      <span className="markers__tip" role="tooltip" id={tip}>
        <strong>{e.label}</strong> {e.detail}
      </span>
    </>
  );
  return (
    <div className="markers__item" role="listitem" style={{ left: leftOf(c.x, width) }}>
      <span className="markers__guide" aria-hidden="true" />
      {e.href ? (
        <a className="markers__hit" href={e.href} target="_blank" rel="noopener noreferrer" aria-describedby={tip} aria-label={`${e.label}: ${e.detail}`}>
          {body}
        </a>
      ) : (
        <span className="markers__hit" tabIndex={0} aria-describedby={tip} aria-label={`${e.label}: ${e.detail}`}>
          {body}
        </span>
      )}
    </div>
  );
}

function Cluster({
  c,
  width,
  open,
  setOpen,
}: {
  c: MarkerCluster<MarkerEvent>;
  width: number;
  open: string | null;
  setOpen: (k: string | null) => void;
}) {
  const key = c.members.map((m) => m.id).join('|');
  const isOpen = open === key;
  const list = useId();
  const names = c.members.map((m) => m.item.label).join(', ');
  const side = c.x > width * 0.6 ? 'end' : 'start';
  return (
    <div
      className={`markers__item markers__cluster${isOpen ? ' is-open' : ''}`}
      role="listitem"
      style={{ left: leftOf(c.x, width) }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(key)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && isOpen && setOpen(null)}
    >
      <span className="markers__guide" aria-hidden="true" />
      <button
        type="button"
        className="markers__circle"
        aria-expanded={isOpen}
        aria-controls={list}
        aria-label={`${c.members.length} events close together: ${names}. Show them.`}
        onClick={() => setOpen(isOpen ? null : key)}
      >
        {c.members.length}
      </button>
      {isOpen && (
        <ul className={`markers__list markers__list--${side}`} id={list}>
          {c.members.map(({ item: e }) => (
            <li key={e.id}>
              <span className="markers__diamond markers__diamond--small" aria-hidden="true" />
              {e.href ? (
                <a href={e.href} target="_blank" rel="noopener noreferrer">
                  <strong>{e.label}</strong>
                </a>
              ) : (
                <strong>{e.label}</strong>
              )}{' '}
              <span className="markers__detail">{e.detail}</span>
              {e.extra}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

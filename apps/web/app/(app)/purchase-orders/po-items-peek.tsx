'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatMoney } from '@/lib/estimate/format';

export type PeekLine = {
  id: string;
  description: string;
  qty: string;
  unit: string;
  costCents: number;
};

type PoItemsPeekProps = {
  lines: PeekLine[];
  totalLines: number;
};

const POPUP_WIDTH = 310;
const ESTIMATED_HEIGHT = 240;

/**
 * Hover/focus peek listing a purchase order's items straight from the list row,
 * so the items are readable without opening the PO.
 *
 * The popup renders through a portal with position:fixed: the procurement queue
 * is inside an overflow-auto scroll container, and an absolutely positioned
 * popup would simply be clipped by it. Same reason SelectControl portals.
 */
export function PoItemsPeek({ lines, totalLines }: PoItemsPeekProps) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);

  function place() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - POPUP_WIDTH - 8),
    );
    // Prefer opening upward (rows sit low in a scrolling list); flip down when
    // there isn't room above.
    const openUp = rect.top > ESTIMATED_HEIGHT;
    setPos(
      openUp
        ? { bottom: window.innerHeight - rect.top + 9, left }
        : { top: rect.bottom + 9, left },
    );
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    // A row can scroll out from under an open peek — the fixed popup would
    // otherwise hang in place over unrelated rows.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (totalLines === 0) {
    return <span className="text-[12px] text-slate-400">No items</span>;
  }

  const hiddenCount = totalLines - lines.length;

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={place}
      onMouseLeave={() => setOpen(false)}
      onFocus={place}
      onBlur={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        role="button"
        aria-expanded={open}
        className="cursor-default border-b border-dotted border-slate-300 pb-px text-[12px] font-semibold text-[var(--color-bv-text)] outline-none focus-visible:border-[var(--color-bv-accent)] focus-visible:text-[var(--color-bv-accent)]"
      >
        {totalLines} item{totalLines === 1 ? '' : 's'}
      </span>

      {open && pos
        ? createPortal(
            <div
              role="tooltip"
              style={{
                position: 'fixed',
                top: pos.top,
                bottom: pos.bottom,
                left: pos.left,
                width: POPUP_WIDTH,
              }}
              className="z-[1000] rounded-[12px] border border-slate-200 bg-white p-[11px_12px] px-3 py-3 shadow-[0_18px_44px_rgba(15,23,41,0.18)]"
            >
              <h4 className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.11em] text-slate-400">
                Ordered items
              </h4>
              {lines.map((line, index) => (
                <div
                  key={line.id}
                  className={`grid grid-cols-[1fr_auto_auto] items-baseline gap-2.5 py-[5px] text-[12px] ${
                    index === 0 ? '' : 'border-t border-slate-100'
                  }`}
                >
                  <span className="font-semibold text-[var(--color-bv-text)]">{line.description}</span>
                  <span className="text-[11px] tabular-nums text-[var(--color-bv-muted)]">
                    {line.qty} {line.unit}
                  </span>
                  <span className="font-bold tabular-nums text-[var(--color-bv-text)]">
                    {formatMoney(line.costCents)}
                  </span>
                </div>
              ))}
              {hiddenCount > 0 ? (
                <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] font-semibold text-slate-400">
                  +{hiddenCount} more item{hiddenCount === 1 ? '' : 's'} — open the PO to see all
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

// Plain text cell. The grid passes the value down and gets onChange
// back on every keystroke; no debouncing here. Spreadsheet rows are
// plenty small for React to re-render on every keystroke without
// noticeable lag.
//
// `data-cell-row` / `data-cell-col` / `data-cell-grid` attributes
// power the grid keyboard navigation helper
// (apps/web/lib/keyboard/grid-nav.ts). Pass them through.

export interface CellInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel: string;
  align?: 'left' | 'right' | 'center';
  cellRow: number;
  cellCol: string;
  cellGrid?: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  /** Non-invasive hook for parent features (e.g. pricing intel); must not steal focus. */
  onCellFocus?: () => void;
}

export function CellInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  align = 'left',
  cellRow,
  cellCol,
  cellGrid,
  maxLength,
  disabled,
  onCellFocus,
  className,
}: CellInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onFocus={() => onCellFocus?.()}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      maxLength={maxLength}
      data-cell-row={cellRow}
      data-cell-col={cellCol}
      data-cell-grid={cellGrid}
      autoComplete="off"
      spellCheck={false}
      className={twMerge(
        'w-full bg-transparent px-2 py-1.5 text-[13.5px] text-[var(--color-bv-text)] outline-none',
        'tabular-nums focus:bg-white focus:ring-1 focus:ring-[var(--color-bv-accent)] focus:ring-inset',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    />
  );
}

// Numeric cell with format-on-blur, parse-on-blur. Holds an internal
// "raw" string so the user can type freely (including invalid
// intermediate states like "1.") without losing focus or bouncing
// back to the formatted form on every keystroke.
//
// On blur:
//   - parse(raw) returns a number in storage units (cents or milli)
//     OR null on garbage. null reverts to the last good `value`.
//   - format(value) re-renders the canonical display.
//
// Errors are silent — the cell snaps back. If we ever need explicit
// "this cell is invalid" UI, surface it from the editor's reducer
// instead of inside this primitive.

export interface NumericCellProps {
  value: number;
  onCommit: (next: number) => void;
  format: (value: number) => string;
  parse: (input: string) => number | null;
  ariaLabel: string;
  align?: 'left' | 'right' | 'center';
  cellRow: number;
  cellCol: string;
  cellGrid?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Called when cell receives focus (spreadsheet intel hooks). */
  onCellFocus?: () => void;
}

export function NumericCell({
  value,
  onCommit,
  format,
  parse,
  ariaLabel,
  align = 'right',
  cellRow,
  cellCol,
  cellGrid,
  disabled,
  placeholder,
  className,
  onCellFocus,
}: NumericCellProps) {
  const [raw, setRaw] = useState<string>(() => format(value));
  const focused = useRef(false);

  // Re-sync when the parent commits a new value while we're not
  // editing (e.g. machine picker overwrote the unit cost).
  useEffect(() => {
    if (!focused.current) {
      setRaw(format(value));
    }
  }, [value, format]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => setRaw(e.currentTarget.value)}
      onFocus={(e) => {
        focused.current = true;
        onCellFocus?.();
        // Select the contents on focus so typing replaces, like Excel.
        try {
          e.currentTarget.select();
        } catch {
          // ignore
        }
      }}
      onBlur={() => {
        focused.current = false;
        const parsed = parse(raw);
        if (parsed === null) {
          setRaw(format(value));
        } else {
          if (parsed !== value) onCommit(parsed);
          setRaw(format(parsed));
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      data-cell-row={cellRow}
      data-cell-col={cellCol}
      data-cell-grid={cellGrid}
      autoComplete="off"
      spellCheck={false}
      className={twMerge(
        'w-full bg-transparent px-2 py-1.5 text-[13.5px] text-[var(--color-bv-text)] outline-none',
        'tabular-nums focus:bg-white focus:ring-1 focus:ring-[var(--color-bv-accent)] focus:ring-inset',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    />
  );
}

'use client';

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
};

type SelectControlProps = SelectHTMLAttributes<HTMLSelectElement> & {
  searchable?: boolean;
  searchPlaceholder?: string;
  // Async ("server-filtered") mode. When onSearchChange is supplied the
  // caller owns filtering — it re-renders <option> children in response to
  // the typed query — so the local substring filter is switched off and the
  // query box is reset each time the popup opens. Leave it undefined for the
  // default behaviour: filter the given options client-side.
  onSearchChange?: (query: string) => void;
  loading?: boolean;
  emptyLabel?: string;
};

type OptionElementProps = {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
};

function textFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return '';
}

function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionElementProps>(child) || child.type !== 'option') return [];
    const label = textFromNode(child.props.children).trim();
    return [
      {
        value: child.props.value == null ? label : String(child.props.value),
        label,
        disabled: Boolean(child.props.disabled),
      },
    ];
  });
}

export function SelectControl({
  className,
  style,
  children,
  searchable = true,
  searchPlaceholder = 'Search options...',
  onSearchChange,
  loading = false,
  emptyLabel = 'No matches',
  value,
  defaultValue,
  onChange,
  name,
  id,
  disabled,
  required,
  ...props
}: SelectControlProps) {
  const asyncSearch = typeof onSearchChange === 'function';
  const reactId = useId();
  const buttonId = id ?? `select-${reactId}`;
  const listboxId = `${buttonId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const options = useMemo(() => readOptions(children), [children]);
  const initialValue =
    value == null
      ? defaultValue == null
        ? options[0]?.value ?? ''
        : String(defaultValue)
      : String(value);
  const [internalValue, setInternalValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  // Popup coordinates in viewport space. The listbox renders through a
  // portal with position:fixed so it can never be clipped by scroll
  // containers (e.g. the estimate line grid's overflow-x-auto wrapper).
  const [popupPos, setPopupPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState('');
  const selectedValue = value == null ? internalValue : String(value);
  const selectedOption =
    options.find((option) => option.value === selectedValue) ??
    options.find((option) => !option.disabled) ??
    options[0];

  useEffect(() => {
    // In async mode the option list churns with every keystroke, so a value
    // that is momentarily absent from it must NOT be reset — that would
    // silently reassign the user's pick mid-search.
    if (asyncSearch) return;
    if (value != null || options.some((option) => option.value === internalValue)) return;
    setInternalValue(options[0]?.value ?? '');
  }, [asyncSearch, internalValue, options, value]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function closeOnScroll(event: Event) {
      // Scrolls inside the popup's own option list shouldn't close it.
      if (popupRef.current && event.target instanceof Node && popupRef.current.contains(event.target)) return;
      setOpen(false);
    }
    function closeOnResize() {
      setOpen(false);
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnResize);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 170);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const estimatedHeight = 380;
    const openUp = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight;
    setPopupPos(
      openUp
        ? { bottom: window.innerHeight - rect.top + 6, left, width }
        : { top: rect.bottom + 6, left, width },
    );
    if (asyncSearch) {
      setQuery('');
      onSearchChange?.('');
    }
    setOpen(true);
  }

  function commit(nextValue: string) {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled || disabled) return;

    setInternalValue(nextValue);
    setOpen(false);
    setQuery('');

    if (selectRef.current) {
      selectRef.current.value = nextValue;
      onChange?.({
        target: selectRef.current,
        currentTarget: selectRef.current,
      } as React.ChangeEvent<HTMLSelectElement>);
    }
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const enabled = options.filter((option) => !option.disabled);
      const currentIndex = enabled.findIndex((option) => option.value === selectedValue);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = enabled[(currentIndex + direction + enabled.length) % enabled.length];
      if (next) commit(next.value);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleOpen();
    }
    if (event.key === 'Escape') setOpen(false);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions =
    searchable && normalizedQuery && !asyncSearch
      ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
      : options;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <select
        {...props}
        ref={selectRef}
        aria-hidden="true"
        className="sr-only"
        disabled={disabled}
        id={id}
        name={name}
        required={required}
        tabIndex={-1}
        value={selectedValue}
        onChange={() => undefined}
      >
        {children}
      </select>
      <button
        type="button"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        disabled={disabled}
        id={buttonId}
        ref={buttonRef}
        onClick={toggleOpen}
        onKeyDown={onButtonKeyDown}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-3 rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 text-left text-[13.5px] font-medium text-[var(--color-bv-text)] shadow-[0_1px_2px_rgba(15,23,41,0.04),0_10px_24px_rgba(15,23,41,0.06)] outline-none transition-all hover:border-slate-300 hover:bg-white focus:border-[var(--color-bv-accent)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(242,135,68,0.16),0_12px_28px_rgba(28,73,114,0.08)] disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        style={style as CSSProperties}
      >
        <span className="min-w-0 truncate">{selectedOption?.label ?? ''}</span>
        <span
          aria-hidden
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-transform',
            open && 'rotate-180 bg-[#fff4eb] text-[var(--color-bv-accent)]',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path
              d="M5.75 7.75L10 12.25L14.25 7.75"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </span>
      </button>
      {open && popupPos
        ? createPortal(
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: popupPos.top,
            bottom: popupPos.bottom,
            left: popupPos.left,
            width: popupPos.width,
          }}
          className="z-[1000] overflow-hidden rounded-[16px] border border-slate-200 bg-white p-1.5 shadow-[0_20px_60px_rgba(15,23,41,0.18)] ring-1 ring-slate-950/5"
          id={listboxId}
          role="listbox"
          aria-labelledby={buttonId}
        >
          {searchable ? (
            <div className="p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  onSearchChange?.(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                    setQuery('');
                  }
                }}
                placeholder={searchPlaceholder}
                className="h-10 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-slate-900 outline-none transition focus:border-[var(--color-bv-accent)] focus:bg-white focus:ring-4 focus:ring-orange-500/10"
              />
            </div>
          ) : null}
          <div className="max-h-72 overflow-y-auto">
            {visibleOptions.map((option) => {
              const selected = option.value === selectedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => commit(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 transition-colors hover:bg-[#fff4eb] hover:text-[#1C4972] disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent',
                    selected && 'bg-[#1C4972] text-white shadow-[0_10px_26px_rgba(28,73,114,0.24)] hover:bg-[#1C4972] hover:text-white',
                  )}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {selected ? (
                    <span aria-hidden className="text-[13px]">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
            {visibleOptions.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12.5px] font-medium text-slate-400">
                {loading ? 'Searching…' : emptyLabel}
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
        )
        : null}
    </div>
  );
}

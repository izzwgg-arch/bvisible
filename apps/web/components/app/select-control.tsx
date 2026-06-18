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

import { cn } from '@/lib/cn';

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
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
  value,
  defaultValue,
  onChange,
  name,
  id,
  disabled,
  required,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const reactId = useId();
  const buttonId = id ?? `select-${reactId}`;
  const listboxId = `${buttonId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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
  const selectedValue = value == null ? internalValue : String(value);
  const selectedOption =
    options.find((option) => option.value === selectedValue) ??
    options.find((option) => !option.disabled) ??
    options[0];

  useEffect(() => {
    if (value != null || options.some((option) => option.value === internalValue)) return;
    setInternalValue(options[0]?.value ?? '');
  }, [internalValue, options, value]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  function commit(nextValue: string) {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled || disabled) return;

    setInternalValue(nextValue);
    setOpen(false);

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
      setOpen((current) => !current);
    }
    if (event.key === 'Escape') setOpen(false);
  }

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
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-3 rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 text-left text-[13.5px] font-medium text-[var(--color-bv-text)] shadow-[0_1px_2px_rgba(15,23,41,0.04),0_10px_24px_rgba(15,23,41,0.06)] outline-none transition-all hover:border-slate-300 hover:bg-white focus:border-[var(--color-bv-accent)] focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.12),0_12px_28px_rgba(15,23,41,0.08)] disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        style={style as CSSProperties}
      >
        <span className="min-w-0 truncate">{selectedOption?.label ?? ''}</span>
        <span
          aria-hidden
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-transform',
            open && 'rotate-180 bg-blue-50 text-[var(--color-bv-accent)]',
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
      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-[16px] border border-slate-200 bg-white p-1.5 shadow-[0_20px_60px_rgba(15,23,41,0.18)] ring-1 ring-slate-950/5"
          id={listboxId}
          role="listbox"
          aria-labelledby={buttonId}
        >
          <div className="max-h-72 overflow-y-auto">
            {options.map((option) => {
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
                    'flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-900 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent',
                    selected && 'bg-blue-600 text-white shadow-[0_10px_26px_rgba(47,90,243,0.24)] hover:bg-blue-600 hover:text-white',
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

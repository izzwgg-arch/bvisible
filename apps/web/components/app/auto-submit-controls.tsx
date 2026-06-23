'use client';

import type { ChangeEvent, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { useRef } from 'react';
import { SelectControl } from './select-control';

function submitClosestForm(target: HTMLInputElement | HTMLSelectElement, delayMs: number) {
  const form = target.form;
  if (!form) return;
  window.setTimeout(() => form.requestSubmit(), delayMs);
}

function submitForm(form: HTMLFormElement | null, delayMs: number) {
  if (!form) return;
  window.setTimeout(() => form.requestSubmit(), delayMs);
}

export function AutoSubmitInput({
  delayMs = 250,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { delayMs?: number }) {
  const timeoutRef = useRef<number | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange?.(event);
    const form = event.currentTarget.form;
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      submitForm(form, 0);
    }, delayMs);
  }

  return <input {...props} onChange={handleChange} />;
}

export function AutoSubmitSelect({
  delayMs = 0,
  onChange,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { delayMs?: number }) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange?.(event);
    submitClosestForm(event.currentTarget, delayMs);
  }

  return <SelectControl {...props} onChange={handleChange} />;
}

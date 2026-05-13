'use client';

import { useActionState } from 'react';
import { changePasswordAction, type ChangePasswordState } from './actions';
import { FormError, FormNotice } from '@/components/auth/form-error';

const INITIAL: ChangePasswordState = { error: null, ok: false };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field id="currentPassword" label="Current password" autoComplete="current-password" />
      <Field id="newPassword" label="New password" autoComplete="new-password" minLength={12} />
      <Field id="confirmPassword" label="Confirm new password" autoComplete="new-password" minLength={12} />
      <FormError message={state.error} />
      {state.ok ? (
        <FormNotice tone="success">Password changed. Other sessions have been signed out.</FormNotice>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 self-start inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
        {label}
      </span>
      <input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        required
        minLength={minLength}
        className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
      />
    </label>
  );
}

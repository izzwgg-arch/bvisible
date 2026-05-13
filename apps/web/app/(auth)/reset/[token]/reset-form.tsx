'use client';

import { useActionState } from 'react';
import { completeResetAction, type CompleteResetState } from './actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CompleteResetState = { error: null };

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(completeResetAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <PasswordField id="password" label="New password" />
      <PasswordField id="confirmPassword" label="Confirm new password" />
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save and sign in'}
      </button>
    </form>
  );
}

function PasswordField({ id, label }: { id: string; label: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
        {label}
      </span>
      <input
        id={id}
        name={id}
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
      />
    </label>
  );
}

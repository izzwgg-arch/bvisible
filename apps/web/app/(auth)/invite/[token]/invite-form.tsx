'use client';

import { useActionState } from 'react';
import { acceptInviteAction, type AcceptInviteState } from './actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: AcceptInviteState = { error: null };

export function InviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field id="name" label="Your name" type="text" autoComplete="name" />
      <Field
        id="password"
        label="Choose a password"
        type="password"
        autoComplete="new-password"
        minLength={12}
      />
      <Field
        id="confirmPassword"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        minLength={12}
      />
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  type: string;
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
        type={type}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
      />
    </label>
  );
}

'use client';

import { useActionState } from 'react';
import { requestResetAction, type RequestResetState } from './actions';
import { FormError, FormNotice } from '@/components/auth/form-error';

const INITIAL: RequestResetState = { error: null, ok: false, devLink: null };

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestResetAction, INITIAL);

  if (state.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice tone="success">
          If that email is on file, a reset link has been issued. The link expires in 30 minutes.
        </FormNotice>
        {state.devLink ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--color-bv-muted)]">
              Reset link (email is not yet wired — copy it manually):
            </span>
            <code className="break-all rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 font-mono text-[12px] text-[var(--color-bv-text)]">
              {state.devLink}
            </code>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        />
      </label>
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}

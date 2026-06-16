'use client';

import { useActionState } from 'react';
import { loginFormAction, type LoginState } from '@/app/(auth)/login/actions';
import { FormError } from './form-error';

const INITIAL: LoginState = { error: null };

export function LoginForm({
  next,
  devLoginEmail,
}: {
  next?: string;
  devLoginEmail?: string;
}) {
  const [state, formAction, pending] = useActionState(loginFormAction, INITIAL);

  function handleDevLogin() {
    const formData = new FormData();
    formData.set('intent', 'dev');
    if (next) formData.set('next', next);
    formAction(formData);
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        defaultValue={state?.email ?? ''}
        required
      />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {devLoginEmail ? (
        <button
          type="button"
          onClick={handleDevLogin}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[8px] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-muted)] transition-colors hover:border-[var(--color-bv-accent)] hover:text-[var(--color-bv-text)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Signing in…' : `Dev login (${devLoginEmail})`}
        </button>
      ) : null}
    </form>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  defaultValue,
  required,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
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
        defaultValue={defaultValue}
        required={required}
        className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none transition-colors focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
      />
    </label>
  );
}

'use client';

import { useActionState } from 'react';
import { createTenantAction, type CreateTenantState } from './actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CreateTenantState = { error: null };

export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState(createTenantAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field id="name" label="Tenant name" placeholder="Acme Signs" />
      <Field id="slug" label="Slug" placeholder="acme-signs" mono />
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className="mt-1 self-start inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create tenant'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  placeholder,
  mono,
}: {
  id: string;
  label: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">{label}</span>
      <input
        id={id}
        name={id}
        type="text"
        required
        placeholder={placeholder}
        className={
          'rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]' +
          (mono ? ' font-mono text-[13px]' : '')
        }
      />
    </label>
  );
}

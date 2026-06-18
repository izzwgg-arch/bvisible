'use client';

import { useActionState } from 'react';
import { createTenantAction, type CreateTenantState } from './actions';
import { FormError } from '@/components/auth/form-error';
import { adminInputClass, adminPrimaryButtonClass } from '@/components/app/admin-ui';

const INITIAL: CreateTenantState = { error: null };

export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState(createTenantAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-4">
      <Field id="name" label="Company name" placeholder="B Visible" />
      <Field id="slug" label="Slug" placeholder="bvisible" mono />
      <FormError message={state.error} />
      <button
        type="submit"
        disabled={pending}
        className={adminPrimaryButtonClass}
      >
        {pending ? 'Saving…' : 'Save company'}
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
    <label className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        id={id}
        name={id}
        type="text"
        required
        placeholder={placeholder}
        className={
          adminInputClass +
          (mono ? ' font-mono text-[13px]' : '')
        }
      />
    </label>
  );
}

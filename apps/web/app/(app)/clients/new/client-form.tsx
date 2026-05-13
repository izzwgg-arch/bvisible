'use client';

import { useActionState } from 'react';
import { createClientAction, type CreateClientState } from '../actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CreateClientState = { error: null };

export function CreateClientForm() {
  const [state, formAction, pending] = useActionState(createClientAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field id="companyName" label="Company name" required placeholder="Acme Signs LLC" />
      <Field id="contactName" label="Contact name" placeholder="Jane Doe" />
      <div className="grid grid-cols-2 gap-3">
        <Field id="email" label="Email" type="email" placeholder="jane@acme.com" />
        <Field id="phone" label="Phone" placeholder="(555) 123-4567" />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Notes</span>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        />
      </label>
      <FormError message={state.error} />
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create client'}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  placeholder,
  type = 'text',
  required,
}: {
  id: string;
  label: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
      />
    </label>
  );
}

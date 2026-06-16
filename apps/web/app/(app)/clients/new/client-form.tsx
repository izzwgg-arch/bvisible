'use client';

import { useActionState } from 'react';
import { createClientAction, type CreateClientState } from '../actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CreateClientState = { error: null };

export function CreateClientForm() {
  const [state, formAction, pending] = useActionState(createClientAction, INITIAL);
  return (
    <form action={formAction} className="grid gap-5">
      <Field id="companyName" label="Company name" required placeholder="Acme Signs LLC" />
      <Field id="contactName" label="Contact name" placeholder="Jane Doe" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="email" label="Email" type="email" placeholder="jane@acme.com" />
        <Field id="phone" label="Phone" placeholder="(555) 123-4567" />
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Notes</span>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          placeholder="Internal context, billing preferences, decision makers, or job notes."
          className="rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[14px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        />
      </label>
      <FormError message={state.error} />
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
        <p className="text-[12.5px] text-slate-500">You can create estimates for this customer immediately.</p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[14px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create customer'}
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
    <label className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
        className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
      />
    </label>
  );
}

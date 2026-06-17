'use client';

import { useActionState } from 'react';
import { createVendorAction, type CreateVendorState } from '../actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CreateVendorState = { error: null };

export function CreateVendorForm() {
  const [state, formAction, pending] = useActionState(createVendorAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field id="name" label="Vendor name" required placeholder="Acme Sign Supply" />
      <div className="grid grid-cols-2 gap-3">
        <Field id="email" label="Email" type="email" placeholder="orders@acmesupply.com" />
        <Field id="phone" label="Phone" placeholder="(555) 123-4567" />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">Notes</span>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Delivery schedule, account number, preferred contact…"
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>
      <FormError message={state.error} />
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[14px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create vendor'}
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
      <span className="text-[12.5px] font-semibold text-slate-500">
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
        className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
      />
    </label>
  );
}

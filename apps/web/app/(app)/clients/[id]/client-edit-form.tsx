'use client';

import { useActionState } from 'react';
import { updateClientAction, type UpdateClientState } from './actions';
import { FormError } from '@/components/auth/form-error';

interface Props {
  clientId: string;
  initialCompanyName: string;
  initialContactName: string | null;
  initialEmail: string | null;
  initialSecondaryEmail: string | null;
  initialPhone: string | null;
  initialAlternatePhone: string | null;
  initialAddress: string | null;
  initialNotes: string | null;
}

const INITIAL: UpdateClientState = { error: null };

export function ClientEditForm({
  clientId,
  initialCompanyName,
  initialContactName,
  initialEmail,
  initialSecondaryEmail,
  initialPhone,
  initialAlternatePhone,
  initialAddress,
  initialNotes,
}: Props) {
  const boundAction = updateClientAction.bind(null, clientId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">
          Company name <span className="text-rose-600">*</span>
        </span>
        <input
          name="companyName"
          defaultValue={initialCompanyName}
          required
          autoComplete="off"
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">Primary contact</span>
        <input
          name="contactName"
          defaultValue={initialContactName ?? ''}
          autoComplete="off"
          placeholder="Jane Doe"
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-slate-500">Main email</span>
          <input
            name="email"
            type="email"
            defaultValue={initialEmail ?? ''}
            placeholder="billing@company.com"
            autoComplete="off"
            className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-slate-500">Secondary email</span>
          <input
            name="secondaryEmail"
            type="email"
            defaultValue={initialSecondaryEmail ?? ''}
            placeholder="accounts@company.com"
            autoComplete="off"
            className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-slate-500">Main phone</span>
          <input
            name="phone"
            type="tel"
            defaultValue={initialPhone ?? ''}
            placeholder="(555) 123-4567"
            autoComplete="off"
            className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-slate-500">Alternate phone</span>
          <input
            name="alternatePhone"
            type="tel"
            defaultValue={initialAlternatePhone ?? ''}
            placeholder="(555) 987-6543"
            autoComplete="off"
            className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">Billing address</span>
        <textarea
          name="address"
          rows={3}
          defaultValue={initialAddress ?? ''}
          placeholder={'123 Main St\nCity, ST 12345'}
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">Notes</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={initialNotes ?? ''}
          placeholder="Billing preferences, decision makers, job context…"
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>

      <FormError message={state.error} />

      {state.success && !state.error ? (
        <p className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-700">
          Saved successfully.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[14px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

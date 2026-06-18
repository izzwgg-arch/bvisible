'use client';

import { useActionState, useState, useTransition } from 'react';
import { updateVendorAction, type UpdateVendorState } from './actions';
import { FormError } from '@/components/auth/form-error';

interface Props {
  vendorId: string;
  initialName: string;
  initialEmails: string[];
  initialPhones: string[];
  initialNotes: string | null;
}

const INITIAL: UpdateVendorState = { error: null };

export function VendorEditForm({
  vendorId,
  initialName,
  initialEmails,
  initialPhones,
  initialNotes,
}: Props) {
  const boundAction = updateVendorAction.bind(null, vendorId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  const [emails, setEmails] = useState<string[]>(
    initialEmails.length > 0 ? initialEmails : ['']
  );
  const [phones, setPhones] = useState<string[]>(
    initialPhones.length > 0 ? initialPhones : ['']
  );

  const addEmail = () => setEmails((prev) => [...prev, '']);
  const removeEmail = (i: number) =>
    setEmails((prev) => prev.filter((_, idx) => idx !== i));
  const updateEmail = (i: number, val: string) =>
    setEmails((prev) => prev.map((v, idx) => (idx === i ? val : v)));

  const addPhone = () => setPhones((prev) => [...prev, '']);
  const removePhone = (i: number) =>
    setPhones((prev) => prev.filter((_, idx) => idx !== i));
  const updatePhone = (i: number, val: string) =>
    setPhones((prev) => prev.map((v, idx) => (idx === i ? val : v)));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Vendor name */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">
          Vendor name <span className="text-rose-600">*</span>
        </span>
        <input
          name="name"
          defaultValue={initialName}
          required
          autoComplete="off"
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>

      {/* Email addresses */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[12.5px] font-semibold text-slate-500">Email addresses</legend>
        {emails.map((email, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              name="emails"
              type="email"
              value={email}
              onChange={(e) => updateEmail(i, e.target.value)}
              placeholder="orders@vendor.com"
              autoComplete="off"
              className="flex-1 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
            {emails.length > 1 && (
              <button
                type="button"
                onClick={() => removeEmail(i)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rose-200 bg-rose-50 text-[16px] text-rose-500 transition hover:bg-rose-100"
                aria-label="Remove email"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addEmail}
          className="flex w-fit items-center gap-1.5 rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12.5px] font-semibold text-violet-700 transition hover:bg-violet-100"
        >
          + Add email
        </button>
      </fieldset>

      {/* Phone numbers */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[12.5px] font-semibold text-slate-500">Phone numbers</legend>
        {phones.map((phone, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              name="phones"
              type="tel"
              value={phone}
              onChange={(e) => updatePhone(i, e.target.value)}
              placeholder="(555) 123-4567"
              autoComplete="off"
              className="flex-1 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
            {phones.length > 1 && (
              <button
                type="button"
                onClick={() => removePhone(i)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-rose-200 bg-rose-50 text-[16px] text-rose-500 transition hover:bg-rose-100"
                aria-label="Remove phone"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addPhone}
          className="flex w-fit items-center gap-1.5 rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12.5px] font-semibold text-violet-700 transition hover:bg-violet-100"
        >
          + Add phone
        </button>
      </fieldset>

      {/* Notes */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-slate-500">Notes</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={initialNotes ?? ''}
          placeholder="Delivery schedule, account number, preferred contact…"
          className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
      </label>

      <FormError message={state.error} />

      {state.success && !state.error && (
        <p className="rounded-[10px] bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-700 border border-emerald-200">
          Saved successfully.
        </p>
      )}

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

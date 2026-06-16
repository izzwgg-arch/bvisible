'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { createBlankPoAction, type CreatePoState } from '../actions';
import { FormError } from '@/components/auth/form-error';

const INITIAL: CreatePoState = { error: null };

interface VendorOption {
  id: string;
  name: string;
}
interface EstimateOption {
  id: string;
  number: string;
  title: string;
}

export function NewPoForm({
  vendors,
  estimates,
  defaultEstimateId,
}: {
  vendors: ReadonlyArray<VendorOption>;
  estimates: ReadonlyArray<EstimateOption>;
  defaultEstimateId: string | null;
}) {
  const [state, formAction, pending] = useActionState(createBlankPoAction, INITIAL);

  return (
    <form action={formAction} className="grid gap-5">
      <label className="group flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Vendor <span className="text-[var(--color-bv-muted)]">(optional — set later)</span>
        </span>
        {vendors.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px] text-slate-500">
            No vendors yet.{' '}
            <Link href="/vendors/new" className="font-semibold text-[var(--color-bv-accent)] underline">
              Add one
            </Link>{' '}
            if you want to attach now, or leave blank and assign later.
          </p>
        ) : (
          <select
            name="vendorId"
            defaultValue=""
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          >
            <option value="">— no vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="group flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Linked estimate{' '}
          <span className="text-[var(--color-bv-muted)]">(optional)</span>
        </span>
        <select
          name="estimateId"
          defaultValue={defaultEstimateId ?? ''}
          className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        >
          <option value="">— no estimate —</option>
          {estimates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.number} · {e.title}
            </option>
          ))}
        </select>
        <span className="rounded-[14px] border border-blue-100 bg-blue-50/70 px-4 py-3 text-[12px] leading-relaxed text-blue-900">
          Picking an estimate here just stores the link. To copy lines from the
          estimate, open the estimate and click <em>Create PO from estimate</em>.
        </span>
      </label>

      <label className="group flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Notes</span>
        <textarea
          name="notes"
          rows={4}
          placeholder="Add purchasing instructions, quote references, or delivery notes."
          className="rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[14px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        />
      </label>

      <FormError message={state.error} />
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
        <p className="text-[12.5px] text-slate-500">Drafts can be edited immediately after creation.</p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[14px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create PO'}
        </button>
      </div>
    </form>
  );
}

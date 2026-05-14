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
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Vendor <span className="text-[var(--color-bv-muted)]">(optional — set later)</span>
        </span>
        {vendors.length === 0 ? (
          <p className="text-[12.5px] text-[var(--color-bv-muted)]">
            No vendors yet.{' '}
            <Link href="/vendors/new" className="text-[var(--color-bv-accent)] underline">
              Add one
            </Link>{' '}
            if you want to attach now, or leave blank and assign later.
          </p>
        ) : (
          <select
            name="vendorId"
            defaultValue=""
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
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

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Linked estimate{' '}
          <span className="text-[var(--color-bv-muted)]">(optional)</span>
        </span>
        <select
          name="estimateId"
          defaultValue={defaultEstimateId ?? ''}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        >
          <option value="">— no estimate —</option>
          {estimates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.number} · {e.title}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-[var(--color-bv-muted)]">
          Picking an estimate here just stores the link. To copy lines from the
          estimate, open the estimate and click <em>Create PO from estimate</em>.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Notes</span>
        <textarea
          name="notes"
          rows={2}
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
          {pending ? 'Creating…' : 'Create PO'}
        </button>
      </div>
    </form>
  );
}

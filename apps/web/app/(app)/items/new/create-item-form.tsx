'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { createShopMaterialItemAction, type ShopMaterialActionState } from '../actions';

export function CreateShopMaterialItemForm() {
  const initial: ShopMaterialActionState = { error: null };
  const [state, action, pending] = useActionState(createShopMaterialItemAction, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Material name</span>
        <input
          name="name"
          required
          maxLength={400}
          placeholder="e.g. ACM 4X8 WHITE"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Category (optional)</span>
        <input
          name="category"
          maxLength={120}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Default unit (optional)</span>
        <input
          name="defaultUnit"
          maxLength={40}
          placeholder="sheet, sqft, roll…"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Notes (optional)</span>
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create item'}
      </button>
    </form>
  );
}

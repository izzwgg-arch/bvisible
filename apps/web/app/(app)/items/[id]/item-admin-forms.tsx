'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { FormError } from '@/components/auth/form-error';
import {
  addShopMaterialAliasAction,
  appendManualShopMaterialPriceAction,
  type ShopMaterialActionState,
} from '../actions';

export function ShopAliasForm({ shopMaterialItemId }: { shopMaterialItemId: string }) {
  const initial: ShopMaterialActionState = { error: null };
  const [state, action, pending] = useActionState(addShopMaterialAliasAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="shopMaterialItemId" value={shopMaterialItemId} />
      <label className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          New alias
        </span>
        <input
          name="alias"
          placeholder='e.g. "DIBOND WHITE"'
          maxLength={400}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)] disabled:opacity-60"
      >
        Add alias
      </button>
      <FormError message={state.error} />
    </form>
  );
}

export function ManualVendorPriceForm({
  shopMaterialItemId,
  vendors,
  catalogUnitHint,
}: {
  shopMaterialItemId: string;
  vendors: ReadonlyArray<{ id: string; name: string }>;
  catalogUnitHint: string;
}) {
  const initial: ShopMaterialActionState = { error: null };
  const [state, action, pending] = useActionState(appendManualShopMaterialPriceAction, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="shopMaterialItemId" value={shopMaterialItemId} />
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Vendor
          </span>
          <select
            name="vendorId"
            required
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
          >
            <option value="">Select…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Price (USD)
          </span>
          <input
            name="priceUsd"
            required
            placeholder="145.00"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Unit (optional)
          </span>
          <input
            name="unit"
            defaultValue={catalogUnitHint}
            maxLength={40}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Effective date (optional)
          </span>
          <input
            name="effectiveAt"
            type="date"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Vendor SKU (optional)
        </span>
        <input
          name="vendorSku"
          maxLength={120}
          placeholder="Stored on vendor catalog row"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Note (optional)
        </span>
        <input
          name="note"
          maxLength={500}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>
      <p className="text-[12px] text-[var(--color-bv-muted)]">
        Manual prices append to history — nothing is overwritten. Source shows as{' '}
        <strong className="text-[var(--color-bv-text)]">Manual</strong> in the ledger.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)] disabled:opacity-60"
      >
        {pending ? 'Recording…' : 'Record manual price'}
      </button>
      <p className="text-[11px] text-[var(--color-bv-muted)]">
        Need catalog intelligence from receipts?{' '}
        <Link href="/admin/ocr-review" className="font-medium text-[var(--color-bv-accent)]">
          Receipt OCR queue
        </Link>
      </p>
    </form>
  );
}

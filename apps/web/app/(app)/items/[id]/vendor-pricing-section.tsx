'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { SelectControl } from '@/components/app/select-control';
import {
  appendManualShopMaterialPriceAction,
  createRepricingRequestAction,
  type ShopMaterialActionState,
} from '../actions';

export interface VendorPriceRow {
  vendorId: string;
  vendorName: string;
  priceCents: number;
  updatedAt: string;
  isCheapest: boolean;
  isPreferred: boolean;
  skus: string[];
  trendNote: string;
  source: string;
}

export function VendorPricingSection({
  shopMaterialItemId,
  vendors,
  vendorRows,
  catalogUnitHint,
  cheapestVendorId,
}: {
  shopMaterialItemId: string;
  vendors: ReadonlyArray<{ id: string; name: string }>;
  vendorRows: VendorPriceRow[];
  catalogUnitHint: string;
  cheapestVendorId: string | null;
}) {
  const initial: ShopMaterialActionState = { error: null };
  const [state, action, pending] = useActionState(appendManualShopMaterialPriceAction, initial);
  const [repricingState, repricingAction, repricingPending] = useActionState(
    createRepricingRequestAction,
    initial,
  );
  const [showForm, setShowForm] = useState(false);
  const [success, setSuccess] = useState(false);

  const sorted = [...vendorRows].sort((a, b) => a.priceCents - b.priceCents);

  function fmtMoney(cents: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(cents / 100);
  }

  return (
    <div>
      {/* Vendor comparison table */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-[16px] bg-violet-50 text-2xl">🏷️</div>
          <p className="text-[13.5px] font-medium text-slate-700">No vendor prices recorded yet.</p>
          <p className="text-[12.5px] text-slate-500">Add how much each supplier charges — the system will track the cheapest one for you.</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(47,90,243,0.20)] transition-all hover:-translate-y-0.5"
          >
            <PlusIcon /> Add first vendor price
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-bv-muted)]">
                <th className="py-2 pr-4 font-semibold">Vendor</th>
                <th className="py-2 pr-4 font-semibold">Latest price</th>
                <th className="py-2 pr-4 font-semibold hidden sm:table-cell">SKU</th>
                <th className="py-2 font-semibold hidden sm:table-cell">Note</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.vendorId} className={`border-b border-[var(--color-bv-border)] last:border-b-0 ${row.isCheapest ? 'bg-emerald-50/60' : ''}`}>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/vendors/${row.vendorId}`} className="font-semibold text-[var(--color-bv-accent)] hover:underline underline-offset-2">
                        {row.vendorName}
                      </Link>
                      {row.isCheapest && (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                          ✓ Cheapest
                        </span>
                      )}
                      {row.isPreferred && (
                        <span className="inline-flex rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
                          Preferred
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`font-semibold tabular-nums ${row.isCheapest ? 'text-emerald-900' : 'text-slate-900'}`}>
                      {fmtMoney(row.priceCents)}
                    </span>
                    <div className="text-[11px] text-slate-400">{row.updatedAt}</div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px] text-slate-400 hidden sm:table-cell">
                    {row.skus.length > 0 ? row.skus.join(', ') : '—'}
                  </td>
                  <td className="py-3 text-[11px] text-slate-400 hidden sm:table-cell">
                    <div>{row.trendNote || '—'}</div>
                    <form action={repricingAction} className="mt-1">
                      <input type="hidden" name="shopMaterialItemId" value={shopMaterialItemId} />
                      <input type="hidden" name="vendorId" value={row.vendorId} />
                      <input type="hidden" name="oldCostCents" value={row.priceCents} />
                      <input type="hidden" name="reason" value="Pricing appears outdated; review vendor quote." />
                      <input type="hidden" name="notes" value={`Requested from item detail vendor row (${row.vendorName}).`} />
                      <button
                        type="submit"
                        disabled={repricingPending}
                        className="rounded-[6px] border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 disabled:opacity-60"
                      >
                        Request repricing
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {repricingState.error ? (
        <p className="mt-2 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {repricingState.error}
        </p>
      ) : null}

      {/* Add price section */}
      {sorted.length > 0 && !showForm && (
        <div className="mt-4 border-t border-[var(--color-bv-border)] pt-4">
          {success && (
            <div className="mb-3 rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">
              Price recorded ✓
            </div>
          )}
          <button
            type="button"
            onClick={() => { setShowForm(true); setSuccess(false); }}
            className="inline-flex items-center gap-1.5 rounded-[12px] border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50"
          >
            <PlusIcon /> Record vendor price
          </button>
        </div>
      )}

      {showForm && (
        <div className="mt-4 border-t border-[var(--color-bv-border)] pt-4">
          <p className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Record vendor price</p>
          <form
            action={async (fd) => {
              await action(fd);
              setShowForm(false);
              setSuccess(true);
            }}
            className="grid gap-3"
          >
            <input type="hidden" name="shopMaterialItemId" value={shopMaterialItemId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">Vendor</span>
                <SelectControl
                  name="vendorId"
                  required
                  className="h-10 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none focus:border-blue-300 focus:bg-white"
                >
                  <option value="">Select vendor…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </SelectControl>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">Price (USD)</span>
                <input
                  name="priceUsd"
                  required
                  placeholder="0.00"
                  inputMode="decimal"
                  className="h-10 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none focus:border-blue-300 focus:bg-white"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">Unit</span>
                <input
                  name="unit"
                  defaultValue={catalogUnitHint}
                  maxLength={40}
                  className="h-10 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none focus:border-blue-300 focus:bg-white"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">Vendor SKU <span className="normal-case text-slate-400">(optional)</span></span>
                <input
                  name="vendorSku"
                  maxLength={120}
                  placeholder="SKU or part #"
                  className="h-10 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none focus:border-blue-300 focus:bg-white"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">Effective date <span className="normal-case text-slate-400">(optional)</span></span>
                <input
                  name="effectiveAt"
                  type="date"
                  className="h-10 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none focus:border-blue-300 focus:bg-white"
                />
              </label>
            </div>

            {state.error && (
              <p className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{state.error}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(47,90,243,0.18)] transition-all hover:-translate-y-0.5 disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Save price'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

'use client';

// "Place order with Amazon" — the approval gate.
//
// The cart that PunchOut returned is priced and itemised but NOT bought. This
// panel is where a person reviews it and decides. Once an order is placed the
// panel becomes a receipt: there is no second button, because a second
// OrderRequest would make Amazon ship the whole order again.

import { useActionState } from 'react';
import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/estimate/format';
import { placeAmazonOrderAction, type PlaceOrderState } from '../amazon-actions';
import type { AmazonOrderPanelData } from '@/lib/amazon/order-panel';

const CARD =
  'rounded-[16px] border border-[#E7E2DA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.05)]';

export function AmazonOrderPanel({ data }: { data: AmazonOrderPanelData }) {
  const [state, formAction, pending] = useActionState<PlaceOrderState, FormData>(
    placeAmazonOrderAction,
    { ok: false, message: null }
  );
  // A success in this session supersedes the server snapshot, so the panel
  // becomes a receipt without waiting for a refresh.
  const placed = data.placed || state.ok;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state.ok]);

  return (
    <section className={`${CARD} mt-4 p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-[#1C4972]">Amazon Business</h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            {placed
              ? 'This order was placed with Amazon.'
              : 'These items came from an Amazon cart. Nothing has been bought yet.'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Total</p>
          <p className="text-[18px] font-bold tabular-nums text-[#1C4972]">
            {formatMoney(data.totalCents)}
          </p>
        </div>
      </div>

      {placed ? (
        <p className="mt-4 rounded-[10px] bg-emerald-50 px-4 py-3 text-[12.5px] font-semibold text-emerald-800">
          ✓ Ordered{data.placedAt ? ` on ${new Date(data.placedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          {' — '}
          {data.itemCount} item{data.itemCount === 1 ? '' : 's'}. Amazon will ship to the company
          address.
        </p>
      ) : data.blockedReason ? (
        <p className="mt-4 rounded-[10px] bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-900">
          {data.blockedReason}
        </p>
      ) : (
        <div className="mt-4">
          {/* Two-step on purpose: this button spends real money, and a
              single misplaced click should not be able to do that. */}
          {confirming ? (
            <form action={formAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="purchaseOrderId" value={data.purchaseOrderId} />
              <span className="text-[12.5px] font-semibold text-slate-700">
                Place this order for {formatMoney(data.totalCents)}?
              </span>
              <button
                type="submit"
                disabled={pending}
                className="rounded-[10px] px-4 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50"
                style={{ background: '#C2410C' }}
              >
                {pending ? 'Placing…' : 'Yes, place the order'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="rounded-[10px] border border-[#E7E2DA] bg-white px-4 py-2.5 text-[12.5px] font-bold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-[10px] px-4 py-2.5 text-[12.5px] font-bold text-white"
              style={{ background: '#C2410C' }}
            >
              {data.failureMessage ? 'Try again' : 'Place order with Amazon'}
            </button>
          )}
        </div>
      )}

      {!placed && (state.message || data.failureMessage) && !state.ok ? (
        <p className="mt-3 text-[12px] font-semibold text-rose-600">
          {state.message ?? data.failureMessage}
        </p>
      ) : null}
    </section>
  );
}

'use client';

// "Order ready" — the result page for a retail (Amazon / Home Depot / …)
// purchase order.
//
// Deliberately image-free. Every row is text plus a generic package glyph, so
// there is nothing to upload, scrape, download, store, or break: no image
// URLs, no placeholders, no broken-image states. The product link is the only
// external reference a row carries.

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { POReminderStatus } from '@bvisible/db';
import { formatMoney, formatQty } from '@/lib/estimate/format';
import { resendOfficeReminderAction, type ResendReminderState } from './actions';

export interface OrderReadyLine {
  id: string;
  description: string;
  specs: string;
  sku: string;
  productUrl: string;
  qtyMilli: number;
  unit: string;
  unitCostCents: number;
  computedCostCents: number;
}

export interface OrderReadyReminder {
  id: string;
  recipient: string;
  status: POReminderStatus;
  attempt: number;
  sentAt: string | null;
  failureMessage: string | null;
}

/// Decorative only — conveys nothing the text does not already say, so it is
/// hidden from assistive tech. One glyph for every material, by design.
function PackageIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#FFF3E8] text-[#C2410C]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
        <path d="m3 8 9 5 9-5" />
        <path d="M12 13v8" />
      </svg>
    </span>
  );
}

function CheckIcon() {
  return (
    <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m20 6-11 11-5-5" />
      </svg>
    </span>
  );
}

function WarningIcon() {
  return (
    <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    </span>
  );
}

/// "just now" for the first minute, then a plain absolute time. Rendered
/// after mount so the server and client cannot disagree on the clock.
function useRelativeTime(iso: string | null): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!iso) {
      setLabel('');
      return;
    }
    const compute = () => {
      const then = new Date(iso).getTime();
      const diffMs = Date.now() - then;
      if (diffMs < 60_000) return 'just now';
      if (diffMs < 3_600_000) {
        const mins = Math.floor(diffMs / 60_000);
        return `${mins} minute${mins === 1 ? '' : 's'} ago`;
      }
      return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    };
    setLabel(compute());
    const timer = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(timer);
  }, [iso]);
  return label;
}

const CARD = 'rounded-[16px] border border-[#E7E2DA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.05)]';
const NAVY = '#1C4972';

export function OrderReadyView({
  po,
  reminder,
  defaultRecipient,
}: {
  po: {
    id: string;
    number: string;
    createdAt: string;
    vendorName: string;
    createdByLabel: string;
    lines: OrderReadyLine[];
  };
  reminder: OrderReadyReminder | null;
  defaultRecipient: string;
}) {
  const createdLabel = useRelativeTime(po.createdAt);
  // Order total is derived from the lines on screen, so what is shown always
  // equals the sum of what is listed.
  const orderTotalCents = po.lines.reduce((sum, line) => sum + line.computedCostCents, 0);

  return (
    <div className="min-h-screen bg-[#FBF8F4] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1120px]">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/purchase-orders/all"
              className="text-[12.5px] font-semibold text-slate-500 hover:text-[#C2410C]"
            >
              ← Past orders
            </Link>
            <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]" style={{ color: NAVY }}>
              Order ready
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {po.number}
              {createdLabel ? <> · Created {createdLabel}</> : null}
            </p>
          </div>
          <Link
            href={`/purchase-orders/${po.id}`}
            className="rounded-[10px] border border-[#E7E2DA] bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 shadow-sm hover:bg-[#FBF8F4]"
          >
            Open PO
          </Link>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <section className={CARD}>
            <h2 className="border-b border-[#F0EBE3] px-5 py-4 text-[15px] font-bold" style={{ color: NAVY }}>
              Items to order
            </h2>

            <ul className="divide-y divide-[#F0EBE3]">
              {po.lines.map((line) => (
                <li key={line.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:flex-nowrap">
                  <PackageIcon />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-slate-900">{line.description}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      {[line.specs, line.sku ? `SKU ${line.sku}` : '']
                        .filter(Boolean)
                        .join(' · ') || `${unitLabel(line.unit)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 sm:gap-6">
                    <span className="whitespace-nowrap text-[12.5px] text-slate-500">
                      Qty {formatQty(line.qtyMilli)}
                    </span>
                    <span className="whitespace-nowrap text-[14px] font-bold tabular-nums text-slate-900">
                      {formatMoney(line.computedCostCents)}
                    </span>
                    {line.productUrl ? (
                      <a
                        href={line.productUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="whitespace-nowrap rounded-[9px] border border-[#E7E2DA] bg-white px-3 py-2 text-[12px] font-bold text-slate-700 hover:bg-[#FBF8F4]"
                      >
                        View on {po.vendorName}
                      </a>
                    ) : (
                      // No link on file. A fake or guessed URL could send the
                      // office to the wrong product, so the row simply says so
                      // — it still appears in the order and in the email.
                      <span className="whitespace-nowrap px-1 text-[11.5px] text-slate-400">Link unavailable</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EBE3] px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Order total</p>
                <p className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: NAVY }}>
                  {formatMoney(orderTotalCents)}
                </p>
              </div>
              <Link
                href={`/po-print/${po.id}`}
                target="_blank"
                className="rounded-[10px] border border-[#E7E2DA] bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 shadow-sm hover:bg-[#FBF8F4]"
              >
                PDF / Print
              </Link>
            </div>
          </section>

          <OfficeReminderCard
            purchaseOrderId={po.id}
            reminder={reminder}
            defaultRecipient={defaultRecipient}
          />
        </div>

        <p className="mt-5 text-center text-[12.5px] text-slate-500">
          {po.vendorName} checkout is completed by the office.
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link
            href="/purchase-orders/shop-order"
            className="rounded-[10px] px-5 py-3 text-[13.5px] font-bold text-white shadow-[0_14px_28px_rgba(194,65,12,0.22)] hover:opacity-95"
            style={{ background: '#C2410C' }}
          >
            Order more materials
          </Link>
          <Link
            href="/purchase-orders/all"
            className="rounded-[10px] border border-[#E7E2DA] bg-white px-5 py-3 text-[13.5px] font-bold text-slate-700 shadow-sm hover:bg-[#FBF8F4]"
          >
            Past orders
          </Link>
        </div>
      </div>
    </div>
  );
}

function OfficeReminderCard({
  purchaseOrderId,
  reminder,
  defaultRecipient,
}: {
  purchaseOrderId: string;
  reminder: OrderReadyReminder | null;
  defaultRecipient: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ResendReminderState, FormData>(
    resendOfficeReminderAction,
    { ok: false, error: null },
  );

  // After a successful resend the newest values come back from the action, so
  // the card updates without waiting for a refresh.
  const recipient = state.recipient ?? reminder?.recipient ?? defaultRecipient;
  const sentAtIso = state.ok ? (state.sentAt ?? null) : (reminder?.sentAt ?? null);
  const sentLabel = useRelativeTime(sentAtIso);
  const failed = !state.ok && (reminder?.status === POReminderStatus.FAILED || !!state.error);

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state.ok]);

  return (
    <section className={CARD}>
      <h2 className="border-b border-[#F0EBE3] px-5 py-4 text-[15px] font-bold" style={{ color: NAVY }}>
        Office reminder
      </h2>

      <div className="px-5 py-5">
        <div className="flex flex-col items-center text-center">
          {failed ? <WarningIcon /> : <CheckIcon />}
          <p className="mt-3 text-[15px] font-bold text-slate-900">
            {failed ? 'Reminder not sent' : 'Reminder sent'}
          </p>
          <p className="mt-1 break-all text-[13px] font-semibold text-slate-700">{recipient}</p>
          {failed ? (
            <p className="mt-1 text-[12px] text-slate-500">
              {state.error ?? reminder?.failureMessage ?? 'The email could not be delivered.'}
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-slate-500">{sentLabel ? `Sent ${sentLabel}` : 'Sent'}</p>
          )}
        </div>

        {editing ? (
          <form action={formAction} className="mt-4 space-y-2">
            <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
            <label className="block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400" htmlFor="resend-recipient">
              Send to
            </label>
            <input
              id="resend-recipient"
              name="recipient"
              type="email"
              required
              defaultValue={recipient}
              className="w-full rounded-[10px] border border-[#E7E2DA] px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-[#C2410C]"
            />
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                // Disabled while in flight so a double-click cannot queue a
                // second send; the action also collapses rapid duplicates.
                disabled={pending}
                className="flex-1 rounded-[10px] px-3 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50"
                style={{ background: '#C2410C' }}
              >
                {pending ? 'Sending…' : 'Resend reminder'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="rounded-[10px] border border-[#E7E2DA] bg-white px-3 py-2.5 text-[12.5px] font-bold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-2">
            {failed ? (
              <form action={formAction}>
                <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
                <input type="hidden" name="recipient" value={recipient} />
                <button
                  type="submit"
                  disabled={pending}
                  className="w-full rounded-[10px] px-3 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50"
                  style={{ background: '#C2410C' }}
                >
                  {pending ? 'Sending…' : 'Try again'}
                </button>
              </form>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full rounded-[10px] border border-[#E7E2DA] bg-white px-3 py-2.5 text-[12.5px] font-bold text-slate-700 hover:bg-[#FBF8F4]"
            >
              {failed ? 'Change recipient' : 'Change recipient & resend'}
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Default recipient: {defaultRecipient}
        </p>
      </div>
    </section>
  );
}

function unitLabel(unit: string): string {
  return unit.toLowerCase().replace(/_/g, ' ');
}

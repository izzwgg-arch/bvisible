import Link from 'next/link';
import type { SpendAlertKind } from '@bvisible/db';
import { dismissSpendAlertFormAction } from '@/lib/reconciliation/actions';
import { RECON_ACTION_HINTS } from '@/lib/reconciliation/ui-copy';
import { SpendAlertKindChip } from '@/components/reconciliation/reconciliation-badges';

export function SpendAlertRow({
  alertId,
  title,
  body,
  kind,
  purchaseOrderId,
  purchaseOrderNumber,
  vendorName,
  vendorId,
  variant = 'inbox',
}: {
  alertId: string;
  title: string;
  body?: string | null;
  kind: SpendAlertKind;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  vendorName?: string | null;
  vendorId?: string | null;
  variant?: 'inbox' | 'dashboard';
}) {
  const shellClass =
    variant === 'dashboard'
      ? 'border-rose-200 bg-white text-rose-950'
      : 'border-slate-100 bg-white text-slate-950 shadow-sm hover:border-amber-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)]';

  return (
    <li
      className={`flex flex-col gap-3 rounded-[18px] border px-4 py-4 text-[13px] transition-all hover:-translate-y-0.5 sm:flex-row sm:items-start sm:justify-between ${shellClass}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <SpendAlertKindChip kind={kind} />
          {purchaseOrderNumber ? (
            <span className="font-mono text-[12px] font-semibold text-[var(--color-bv-accent)]">
              {purchaseOrderNumber}
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-semibold">{title}</p>
        {body ? (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{body}</p>
        ) : null}
        {vendorName && vendorId ? (
          <Link
            href={`/vendors/${vendorId}`}
            className="mt-1 inline-block text-[11.5px] text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
          >
            {vendorName}
          </Link>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {purchaseOrderId ? (
          <Link
            href={`/purchase-orders/${purchaseOrderId}/reconciliation`}
            className="rounded-[12px] bg-[var(--color-bv-accent)] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_10px_22px_rgba(47,90,243,0.20)] hover:opacity-95"
          >
            Review variance
          </Link>
        ) : null}
        <form>
          <input type="hidden" name="alertId" value={alertId} />
          <button
            type="submit"
            formAction={dismissSpendAlertFormAction}
            title={RECON_ACTION_HINTS.dismissAlert}
            className="rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Dismiss
          </button>
        </form>
      </div>
    </li>
  );
}

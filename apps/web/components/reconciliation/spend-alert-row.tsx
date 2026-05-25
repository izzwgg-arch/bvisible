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
      : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-text)]';

  return (
    <li
      className={`flex flex-col gap-2 rounded-[10px] border px-3 py-2.5 text-[13px] sm:flex-row sm:items-start sm:justify-between ${shellClass}`}
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
        <p className="mt-1 font-medium">{title}</p>
        {body ? (
          <p className="mt-0.5 text-[12px] text-[var(--color-bv-muted)]">{body}</p>
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
            className="rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-95"
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
            className="rounded-[8px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)] hover:text-[var(--color-bv-text)]"
          >
            Dismiss
          </button>
        </form>
      </div>
    </li>
  );
}

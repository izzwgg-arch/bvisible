import Link from 'next/link';
import {
  markPoReconciledFormAction,
  refreshReconciliationFormAction,
} from '@/lib/reconciliation/actions';
import { RECON_ACTION_HINTS } from '@/lib/reconciliation/ui-copy';

export function ReconciliationToolbar({
  purchaseOrderId,
  showMarkReconciledPrimary,
  staleMark,
}: {
  purchaseOrderId: string;
  showMarkReconciledPrimary: boolean;
  staleMark: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {staleMark ? (
        <p className="rounded-[8px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
          <span className="font-semibold">Stale operator stamp.</span> A newer snapshot landed after
          you marked reconciled — review variance rows again before relying on the stamp.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {showMarkReconciledPrimary ? (
          <form action={markPoReconciledFormAction}>
            <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
            <button
              type="submit"
              title={RECON_ACTION_HINTS.markReconciled}
              className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-95"
            >
              Mark reconciled
            </button>
          </form>
        ) : null}

        <form action={refreshReconciliationFormAction}>
          <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
          <button
            type="submit"
            title={RECON_ACTION_HINTS.recompute}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Recompute snapshot
          </button>
        </form>

        {!showMarkReconciledPrimary ? (
          <form action={markPoReconciledFormAction}>
            <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
            <button
              type="submit"
              title={RECON_ACTION_HINTS.markReconciled}
              className="rounded-[8px] border border-[var(--color-bv-border)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Mark reconciled
            </button>
          </form>
        ) : null}

        <Link
          href="/admin/reconciliation"
          className="inline-flex items-center rounded-[8px] border border-[var(--color-bv-border)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)] hover:text-[var(--color-bv-text)]"
        >
          Inbox
        </Link>
      </div>
    </div>
  );
}

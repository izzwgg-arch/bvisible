'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  clearPoBlockedAction,
  markPoBlockedAction,
  markPoReceivedCompleteAction,
  markPoVendorAcknowledgedAction,
} from '@/lib/po/po-lifecycle-actions';

export function PoLifecycleControls({
  poId,
  isBlocked,
}: {
  poId: string;
  isBlocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [blockReason, setBlockReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? 'Action failed.');
      else router.refresh();
    });
  }

  return (
    <div className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
        Operator actions
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => markPoVendorAcknowledgedAction(poId))}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-50"
        >
          Mark vendor acknowledged
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => markPoReceivedCompleteAction(poId))}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-50"
        >
          Mark received complete
        </button>
        {!isBlocked ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => markPoBlockedAction({ purchaseOrderId: poId, reason: blockReason }))
            }
            className="rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
          >
            Mark blocked
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => clearPoBlockedAction(poId))}
            className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[12px] font-medium text-emerald-950 hover:bg-emerald-100 disabled:opacity-50"
          >
            Clear blocked
          </button>
        )}
      </div>
      {!isBlocked ? (
        <input
          type="text"
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="Optional block reason"
          maxLength={500}
          className="mt-2 w-full max-w-md rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1.5 text-[12px]"
        />
      ) : null}
      {err ? <p className="mt-2 text-[12px] text-red-700">{err}</p> : null}
    </div>
  );
}

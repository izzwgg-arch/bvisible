'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createInvoiceFromEstimateAction } from '@/app/(app)/invoices/actions';

export function CreateInvoiceFromEstimateButton({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await createInvoiceFromEstimateAction({ estimateId });
            if (res.error) {
              setError(res.error);
              return;
            }
            if (res.invoiceId) {
              router.push(`/invoices/${res.invoiceId}`);
              router.refresh();
            }
          });
        }}
        className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create invoice'}
      </button>
      {error ? (
        <p className="text-[12.5px] leading-snug text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

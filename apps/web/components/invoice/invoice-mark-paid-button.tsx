'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { markInvoicePaidAction } from '@/app/(app)/invoices/actions';

export function InvoiceMarkPaidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await markInvoicePaidAction({ invoiceId });
            if (res.error) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        className="inline-flex items-center justify-center rounded-[8px] bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Mark paid'}
      </button>
      {error ? (
        <p className="max-w-[280px] text-right text-[12px] leading-snug text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

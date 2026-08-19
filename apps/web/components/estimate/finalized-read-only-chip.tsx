import Link from 'next/link';
import { BID_READ_ONLY_CHIP_LABEL, FINALIZED_READ_ONLY_CHIP_LABEL } from '@/lib/estimate/estimate-read-only-ui';

export function FinalizedReadOnlyChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-violet-800 ${className}`}
      title="Unfinalize from the totals panel to edit lines again."
    >
      {FINALIZED_READ_ONLY_CHIP_LABEL}
    </span>
  );
}

/** Bid Estimator estimates open read-only here; editing happens in the seven-step workflow. */
export function BidReadOnlyChip({ estimateId, className = '' }: { estimateId: string; className?: string }) {
  return (
    <Link
      href={`/estimates/${estimateId}/bid`}
      className={`inline-flex shrink-0 items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-orange-800 hover:bg-orange-100 ${className}`}
      title="Lines, pricing and questions are managed by the Bid Estimator. Open the workflow to change them."
    >
      {BID_READ_ONLY_CHIP_LABEL} →
    </Link>
  );
}

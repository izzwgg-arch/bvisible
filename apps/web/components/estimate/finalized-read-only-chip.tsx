import { FINALIZED_READ_ONLY_CHIP_LABEL } from '@/lib/estimate/estimate-read-only-ui';

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

import { RECON_COMPARE_ONLY_BANNER } from '@/lib/reconciliation/ui-copy';

export function ReconciliationSafetyBanner({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[12px] text-[var(--color-bv-muted)]">
        {RECON_COMPARE_ONLY_BANNER}
      </p>
    );
  }

  return (
    <div className="rounded-[10px] border border-sky-200 bg-sky-50/60 px-4 py-3 text-[12.5px] leading-relaxed text-sky-950">
      <span className="font-semibold">Compare-only workspace.</span>{' '}
      {RECON_COMPARE_ONLY_BANNER}
    </div>
  );
}

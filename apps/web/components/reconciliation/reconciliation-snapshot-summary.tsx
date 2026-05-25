import {
  POReconciliationLineMatch,
  POReconciliationLineResolution,
  POReconciliationStatus,
} from '@bvisible/db';
import { needsOperatorReview } from '@/lib/reconciliation/ui-format';
import { ReconciliationStatusChip } from '@/components/reconciliation/reconciliation-badges';

export type ReconciliationLineSummaryInput = {
  match: POReconciliationLineMatch;
  resolution: POReconciliationLineResolution;
};

export function buildReconciliationSnapshotSummary(
  lines: ReconciliationLineSummaryInput[],
): {
  total: number;
  varianceCount: number;
  unresolvedCount: number;
  matchedCount: number;
  isClean: boolean;
} {
  let varianceCount = 0;
  let unresolvedCount = 0;
  let matchedCount = 0;

  for (const line of lines) {
    if (needsOperatorReview(line.match)) varianceCount += 1;
    if (line.resolution === POReconciliationLineResolution.NONE && needsOperatorReview(line.match)) {
      unresolvedCount += 1;
    }
    if (line.match === POReconciliationLineMatch.MATCHED) matchedCount += 1;
  }

  return {
    total: lines.length,
    varianceCount,
    unresolvedCount,
    matchedCount,
    isClean: lines.length > 0 && varianceCount === 0 && unresolvedCount === 0,
  };
}

export function ReconciliationSnapshotSummaryBar({
  status,
  runAt,
  summary,
  openAlertCount,
}: {
  status: POReconciliationStatus;
  runAt: Date;
  summary: ReturnType<typeof buildReconciliationSnapshotSummary>;
  openAlertCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2.5 text-[12px]">
      <ReconciliationStatusChip status={status} />
      <span className="text-[var(--color-bv-muted)]">
        {runAt.toISOString().slice(0, 19).replace('T', ' ')}
      </span>
      <span className="hidden h-3 w-px bg-[var(--color-bv-border)] sm:inline-block" aria-hidden />
      <StatPill label="Lines" value={summary.total} />
      <StatPill label="Matched" value={summary.matchedCount} tone="emerald" />
      {summary.varianceCount > 0 ? (
        <StatPill label="Needs review" value={summary.varianceCount} tone="amber" />
      ) : null}
      {summary.unresolvedCount > 0 ? (
        <StatPill label="Unresolved" value={summary.unresolvedCount} tone="amber" />
      ) : null}
      {openAlertCount > 0 ? (
        <StatPill label="Open alerts" value={openAlertCount} tone="rose" />
      ) : null}
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'emerald' | 'amber' | 'rose';
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : tone === 'rose'
          ? 'border-rose-200 bg-rose-50 text-rose-950'
          : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-text)]';

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}>
      {label}: {value}
    </span>
  );
}

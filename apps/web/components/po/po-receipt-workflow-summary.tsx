import Link from 'next/link';
import { OcrJobStatus, Role } from '@bvisible/db';
import type { PoReceiptWorkflowSummary } from '@/lib/po/get-po-receipt-workflow-summary';
import { buildPoReceiptNextActions } from '@/lib/po/po-receipt-next-actions';
import { labelOcrJobStatus, labelPoReconciliationStatus } from '@/lib/ui/status-labels';

function chipClass(tone: 'neutral' | 'amber' | 'emerald'): string {
  switch (tone) {
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case 'emerald':
      return 'border-emerald-200 bg-emerald-50 text-emerald-950';
    default:
      return 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-text)]';
  }
}

export function PoReceiptWorkflowSummaryCard({
  poId,
  summary,
  role,
}: {
  poId: string;
  summary: PoReceiptWorkflowSummary;
  role: Role;
}) {
  const showOperator = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  if (!showOperator) return null;

  const nextActions = buildPoReceiptNextActions(poId, summary);

  return (
    <section className="mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Receipt → pricing → reconciliation
        </h2>
        <p className="text-[11px] text-[var(--color-bv-muted)]">
          Compare-only — no estimate or invoice lines change here.
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MiniStat
          label="OCR status"
          value={summary.latestOcrStatus ? labelOcrJobStatus(summary.latestOcrStatus) : 'No jobs'}
          hint={
            summary.ocrDocumentsTotal > 0
              ? `${summary.ocrDocumentsTotal} document${summary.ocrDocumentsTotal === 1 ? '' : 's'}`
              : undefined
          }
          tone={summary.latestOcrStatus === OcrJobStatus.REVIEW_REQUIRED ? 'amber' : 'neutral'}
        />
        <MiniStat
          label="Approved lines"
          value={String(summary.approvedReceiptLineCount)}
          hint="Written to vendor price history"
          tone={summary.approvedReceiptLineCount > 0 ? 'emerald' : 'neutral'}
        />
        <MiniStat
          label="Reconciliation"
          value={
            summary.latestReconciliationStatus
              ? labelPoReconciliationStatus(summary.latestReconciliationStatus)
              : 'Not run'
          }
          hint={
            summary.latestReconciliationAt
              ? summary.latestReconciliationAt.toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : undefined
          }
          tone={summary.reconciliationNeedsAttention ? 'amber' : 'neutral'}
        />
        <MiniStat
          label="Variance lines"
          value={String(summary.varianceLineCount)}
          hint={
            summary.unresolvedVarianceLineCount > 0
              ? `${summary.unresolvedVarianceLineCount} unresolved`
              : 'Latest snapshot'
          }
          tone={
            summary.unresolvedVarianceLineCount > 0
              ? 'amber'
              : summary.varianceLineCount > 0
                ? 'neutral'
                : 'neutral'
          }
        />
        <MiniStat
          label="Open alerts"
          value={String(summary.openSpendAlertCount)}
          hint="Spend inbox"
          tone={summary.openSpendAlertCount > 0 ? 'amber' : 'neutral'}
        />
      </div>
      {nextActions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {nextActions.map((a) => (
            <Link
              key={a.label}
              href={a.href as never}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${chipClass(a.tone)}`}
            >
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MiniStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'neutral' | 'amber' | 'emerald';
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${chipClass(tone)}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-[10.5px] opacity-75">{hint}</p> : null}
    </div>
  );
}

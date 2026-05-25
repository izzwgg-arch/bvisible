import Link from 'next/link';
import { OcrJobStatus, Role } from '@bvisible/db';
import type { PoLifecycleSnapshot } from '@/lib/po/get-po-lifecycle-snapshot';
import type { PoReceiptWorkflowSummary } from '@/lib/po/get-po-receipt-workflow-summary';
import { buildPoReceiptNextActions } from '@/lib/po/po-receipt-next-actions';
import { labelOcrJobStatus, labelPoReconciliationStatus } from '@/lib/ui/status-labels';
import { PoLifecycleControls } from './po-lifecycle-controls';
import { PoLifecycleRail } from './po-lifecycle-rail';

type ExecutionAction = {
  label: string;
  href: string;
  tone: 'primary' | 'amber' | 'emerald' | 'neutral';
  priority: number;
};

function mergeExecutionActions(
  lifecycle: PoLifecycleSnapshot,
  receiptActions: ReturnType<typeof buildPoReceiptNextActions>,
): ExecutionAction[] {
  const byHref = new Map<string, ExecutionAction>();

  for (const a of receiptActions) {
    byHref.set(a.href, {
      label: a.label,
      href: a.href,
      tone: a.tone === 'emerald' ? 'emerald' : 'amber',
      priority: a.priority,
    });
  }

  const lifecycleHref = lifecycle.nextAction.href;
  const lifecyclePriority =
    lifecycle.state === 'reconciliation_needed' || lifecycle.state === 'variance_detected'
      ? 5
      : lifecycle.state === 'partially_received'
        ? 25
        : 50;

  const existing = byHref.get(lifecycleHref);
  if (!existing || lifecyclePriority < existing.priority) {
    byHref.set(lifecycleHref, {
      label: lifecycle.nextAction.label,
      href: lifecycleHref,
      tone:
        lifecycle.state === 'reconciliation_needed' || lifecycle.state === 'variance_detected'
          ? 'primary'
          : 'neutral',
      priority: lifecyclePriority,
    });
  }

  return [...byHref.values()].sort((a, b) => a.priority - b.priority);
}

function actionButtonClass(tone: ExecutionAction['tone'], primary: boolean): string {
  if (primary && tone === 'primary') {
    return 'inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-90';
  }
  if (tone === 'amber') {
    return 'inline-flex items-center justify-center rounded-[8px] border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 hover:bg-amber-100';
  }
  if (tone === 'emerald') {
    return 'inline-flex items-center justify-center rounded-[8px] border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-950 hover:bg-emerald-100';
  }
  return 'inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]';
}

export function PoExecutionWorkspace({
  poId,
  poNumber,
  lifecycle,
  receiptSummary,
  role,
  vendorReplyCount,
}: {
  poId: string;
  poNumber: string;
  lifecycle: PoLifecycleSnapshot;
  receiptSummary: PoReceiptWorkflowSummary | null;
  role: Role;
  vendorReplyCount: number;
}) {
  const showOperator = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  const receiptActions =
    receiptSummary && showOperator ? buildPoReceiptNextActions(poId, receiptSummary) : [];
  const actions = mergeExecutionActions(lifecycle, receiptActions);
  const [primary, ...secondary] = actions;

  const blockerTone = lifecycle.isBlocked
    ? 'border-amber-300 bg-amber-50 text-amber-950'
    : 'border-emerald-200 bg-emerald-50 text-emerald-900';

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)]/95 px-4 py-3 backdrop-blur-sm lg:-mx-6 lg:px-6">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
                Operations
              </h2>
              <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-bv-text)]">
                {lifecycle.label}
              </span>
              {lifecycle.staleLabel ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-950">
                  Stale {lifecycle.staleLabel}
                </span>
              ) : null}
              {vendorReplyCount > 0 ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-950">
                  {vendorReplyCount} vendor {vendorReplyCount === 1 ? 'reply' : 'replies'}
                </span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-[var(--color-bv-muted)]">
              {lifecycle.reason}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {primary ? (
              <Link href={primary.href as never} className={actionButtonClass(primary.tone, true)}>
                {primary.label}
              </Link>
            ) : null}
            {showOperator ? (
              <Link
                href={`/purchase-orders/${poId}/reconciliation`}
                className={actionButtonClass('neutral', false)}
              >
                Reconciliation
              </Link>
            ) : null}
            {secondary.map((a) => (
              <Link
                key={`${a.href}-${a.label}`}
                href={a.href as never}
                className={actionButtonClass(a.tone, false)}
              >
                {a.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <StatPill label="Vendor" value={lifecycle.vendorResponseLabel} />
          <StatPill label="Receipt / recon" value={lifecycle.receiptProgressLabel} />
          <StatPill
            label="Blocker"
            value={lifecycle.isBlocked ? 'Needs attention' : 'On track'}
            className={blockerTone}
          />
        </div>

        <div className="mt-2">
          <PoLifecycleRail
            poId={poId}
            poNumber={poNumber}
            snapshot={lifecycle}
            role={role}
            variant="compact"
            hideNextAction
          />
        </div>

        {receiptSummary && showOperator ? (
          <ReceiptPipelineStrip summary={receiptSummary} />
        ) : null}

        {showOperator ? (
          <div className="mt-2">
            <PoLifecycleControls poId={poId} isBlocked={lifecycle.signals.isOperatorBlocked} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  className = 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-text)]',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-[8px] border px-2.5 py-1.5 ${className}`}>
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] opacity-70">{label}</p>
      <p className="mt-0.5 line-clamp-2 text-[11.5px] font-medium leading-snug">{value}</p>
    </div>
  );
}

function ReceiptPipelineStrip({ summary }: { summary: PoReceiptWorkflowSummary }) {
  const ocrTone =
    summary.latestOcrStatus === OcrJobStatus.REVIEW_REQUIRED ? 'text-amber-950' : '';

  return (
    <details className="group mt-2 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]">
      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-bv-muted)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          Receipt pipeline
          <span className="font-normal normal-case tracking-normal text-[var(--color-bv-text)]">
            {summary.latestOcrStatus ? labelOcrJobStatus(summary.latestOcrStatus) : 'No OCR'} ·{' '}
            {summary.latestReconciliationStatus
              ? labelPoReconciliationStatus(summary.latestReconciliationStatus)
              : 'No recon'}
          </span>
          <span className="text-[10px] font-normal text-[var(--color-bv-muted)] group-open:hidden">
            (expand)
          </span>
        </span>
      </summary>
      <div className="grid gap-2 border-t border-[var(--color-bv-border)] px-3 py-2 sm:grid-cols-5">
        <Mini label="OCR" value={summary.latestOcrStatus ? labelOcrJobStatus(summary.latestOcrStatus) : '—'} className={ocrTone} />
        <Mini label="Approved" value={String(summary.approvedReceiptLineCount)} />
        <Mini
          label="Recon"
          value={
            summary.latestReconciliationStatus
              ? labelPoReconciliationStatus(summary.latestReconciliationStatus)
              : 'Not run'
          }
        />
        <Mini label="Variance" value={String(summary.varianceLineCount)} />
        <Mini label="Alerts" value={String(summary.openSpendAlertCount)} />
      </div>
      <p className="border-t border-[var(--color-bv-border)] px-3 py-1.5 text-[10px] text-[var(--color-bv-muted)]">
        Compare-only — PO and estimate totals never change from this path.
      </p>
    </details>
  );
}

function Mini({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-bv-muted)]">{label}</p>
      <p className={`text-[12px] font-semibold tabular-nums ${className}`}>{value}</p>
    </div>
  );
}

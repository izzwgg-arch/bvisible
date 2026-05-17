import Link from 'next/link';
import {
  EmailIngestStatus,
  OcrJobStatus,
  POReconciliationStatus,
  POStatus,
  Role,
} from '@bvisible/db';
import {
  labelEmailIngestStatus,
  labelOcrJobStatus,
  labelPoReconciliationStatus,
  labelPoStatus,
} from '@/lib/ui/status-labels';
import { WORKFLOW_STATE_LABELS } from '@/lib/workflow/operational-state';

const STEPS = [
  POStatus.DRAFT,
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.RECEIVED,
] as const;

function poLifecycleIndex(status: POStatus): number {
  switch (status) {
    case POStatus.DRAFT:
      return 0;
    case POStatus.SENT:
      return 1;
    case POStatus.ORDERED:
      return 2;
    case POStatus.PARTIALLY_RECEIVED:
      return 2;
    case POStatus.RECEIVED:
      return 3;
    case POStatus.CANCELED:
      return -1;
    default:
      return 0;
  }
}

export function PoOperationalRail({
  poId,
  poNumber,
  status,
  attachmentTotal,
  receiptishCount,
  attachmentsFromEmailCount,
  latestReconciliation,
  operatorMarkedReconciledAt,
  ocrDocuments,
  emailsTouchingPo,
  matchedEmailsCount,
  role,
}: {
  poId: string;
  poNumber: string;
  status: POStatus;
  attachmentTotal: number;
  receiptishCount: number;
  attachmentsFromEmailCount: number;
  latestReconciliation: { status: POReconciliationStatus; createdAt: Date } | null;
  operatorMarkedReconciledAt: Date | null;
  ocrDocuments: ReadonlyArray<{ id: string; status: OcrJobStatus }>;
  emailsTouchingPo: number;
  matchedEmailsCount: number;
  role: Role;
}) {
  const showOperator = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  const canceled = status === POStatus.CANCELED;
  const idx = canceled ? -1 : poLifecycleIndex(status);
  const partial = status === POStatus.PARTIALLY_RECEIVED;

  const ocrPendingStatuses = new Set<OcrJobStatus>([
    OcrJobStatus.REVIEW_REQUIRED,
    OcrJobStatus.PENDING,
    OcrJobStatus.PROCESSING,
  ]);

  const ocrPending = ocrDocuments.filter((d) => ocrPendingStatuses.has(d.status)).length;

  const ocrAgg = ocrDocuments.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<OcrJobStatus, number>>,
  );

  const reconAttentionStatuses = new Set<POReconciliationStatus>([
    POReconciliationStatus.VARIANCE,
    POReconciliationStatus.REVIEW_REQUIRED,
    POReconciliationStatus.PARTIAL,
  ]);

  const reconNeedsAttention =
    !!latestReconciliation &&
    reconAttentionStatuses.has(latestReconciliation.status);

  const next =
    !canceled && attachmentTotal === 0
      ? {
          title: 'Upload vendor paperwork',
          body: 'Drag in receipts or invoices on this PO — that kicks off OCR queues and gives reconciliation something to pair.',
          href: `/purchase-orders/${poId}#po-attachments` as const,
        }
      : !canceled && reconNeedsAttention && showOperator
        ? {
            title: WORKFLOW_STATE_LABELS.variance_detected,
            body: `Latest snapshot: ${labelPoReconciliationStatus(latestReconciliation!.status)} — review lines or stamp reconciled.`,
            href: `/purchase-orders/${poId}/reconciliation` as const,
          }
        : !canceled && ocrPending > 0 && showOperator
          ? {
              title: WORKFLOW_STATE_LABELS.ocr_review_needed,
              body: `${ocrPending} document${ocrPending === 1 ? '' : 's'} need operator review before pricing feeds forward.`,
              href: '/admin/ocr-review' as const,
            }
          : emailsTouchingPo > matchedEmailsCount && showOperator
            ? {
                title: WORKFLOW_STATE_LABELS.unmatched_email,
                body: 'Some vendor mail tied to this PO is still pending operator linking.',
                href: '/admin/email-ingestion' as const,
              }
            : null;

  return (
    <div className="mb-8 flex flex-col gap-5">
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Purchase order lifecycle
          </h2>
          <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 font-mono text-[12px] font-medium text-[var(--color-bv-text)]">
            {poNumber}
          </span>
        </div>

        {canceled ? (
          <p className="mt-4 rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-900">
            This PO is <strong>Canceled</strong>.
          </p>
        ) : (
          <>
            <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => {
                const stepIdx = i;
                const received = status === POStatus.RECEIVED;
                if (received) {
                  return (
                    <li key={step}>
                      <div className="flex min-h-[3rem] flex-col items-center justify-center rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-[12.5px] font-semibold leading-snug text-emerald-900">
                        <span>
                          <span className="tabular-nums text-[11px] opacity-70">{stepIdx + 1}. </span>
                          {labelPoStatus(step)}
                        </span>
                      </div>
                    </li>
                  );
                }

                const completed = idx > stepIdx;
                const amberPartial = partial && stepIdx === 2;
                const current = !partial && idx === stepIdx;

                return (
                  <li key={step}>
                    <div
                      className={`flex min-h-[3rem] flex-col items-center justify-center rounded-[10px] border px-3 py-2 text-center text-[12.5px] font-semibold leading-snug ${
                        amberPartial
                          ? 'border-amber-300 bg-amber-50 text-amber-950'
                          : completed
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : current
                              ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
                              : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                      }`}
                    >
                      <span>
                        <span className="tabular-nums text-[11px] opacity-70">{stepIdx + 1}. </span>
                        {labelPoStatus(step)}
                      </span>
                      {amberPartial ? (
                        <span className="mt-1 text-[10.5px] font-normal text-amber-900">
                          {labelPoStatus(POStatus.PARTIALLY_RECEIVED)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Attachments
          </h3>
          <p className="mt-2 text-[22px] font-semibold tabular-nums text-[var(--color-bv-text)]">{attachmentTotal}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-bv-muted)]">
            {receiptishCount} receipt / invoice · {attachmentsFromEmailCount} from vendor email
          </p>
        </div>

        <div className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Reconciliation
          </h3>
          {latestReconciliation ? (
            <>
              <p className="mt-2 text-[13.5px] font-semibold text-[var(--color-bv-text)]">
                {labelPoReconciliationStatus(latestReconciliation.status)}
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-bv-muted)]">
                Latest snapshot{' '}
                {latestReconciliation.createdAt.toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-[var(--color-bv-muted)]">No reconciliation snapshots yet.</p>
          )}
          <p className="mt-2 text-[12px] text-[var(--color-bv-muted)]">
            Operator stamp:{' '}
            {operatorMarkedReconciledAt
              ? operatorMarkedReconciledAt.toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : 'Not stamped'}
          </p>
          {showOperator ? (
            <Link
              href={`/purchase-orders/${poId}/reconciliation`}
              className="mt-3 inline-flex text-[12.5px] font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
            >
              Open reconciliation →
            </Link>
          ) : null}
        </div>

        <div className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Receipt OCR · inbound mail
          </h3>
          {ocrDocuments.length === 0 ? (
            <p className="mt-2 text-[13px] text-[var(--color-bv-muted)]">No OCR jobs on attachments yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-[var(--color-bv-text)]">
              {(Object.entries(ocrAgg) as [OcrJobStatus, number][]).map(([st, n]) => (
                <li key={st} className="flex justify-between gap-2">
                  <span>{labelOcrJobStatus(st)}</span>
                  <span className="tabular-nums text-[var(--color-bv-muted)]">{n}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-[var(--color-bv-border)] pt-3 text-[12.5px] text-[var(--color-bv-muted)]">
            Messages referencing this PO: <span className="font-semibold text-[var(--color-bv-text)]">{emailsTouchingPo}</span>
            {emailsTouchingPo > 0 ? (
              <>
                {' '}
                ({matchedEmailsCount} {labelEmailIngestStatus(EmailIngestStatus.MATCHED).toLowerCase()})
              </>
            ) : null}
          </p>
        </div>
      </section>

      {next ? (
        <section className="rounded-[var(--radius-bv)] border border-sky-200 bg-sky-50/70 p-5 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-sky-950">Next recommended action</h3>
          <p className="mt-2 text-[14px] font-semibold text-sky-950">{next.title}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-sky-950/90">{next.body}</p>
          <Link
            href={next.href as never}
            className="mt-3 inline-flex text-[13px] font-medium text-sky-900 underline-offset-2 hover:underline"
          >
            Continue →
          </Link>
        </section>
      ) : null}
    </div>
  );
}

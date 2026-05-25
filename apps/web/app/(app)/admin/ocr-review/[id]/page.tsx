import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OcrJobStatus, prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import {
  OcrDecisionRail,
  OcrLineReviewTable,
  type ApprovalLineRow,
} from '@/app/(app)/admin/ocr-review/ocr-approval-form';
import {
  OcrStatusChip,
  ocrFailureHint,
} from '@/app/(app)/admin/ocr-review/ocr-review-ui';
import { labelOcrJobStatus } from '@/lib/ui/status-labels';

export const dynamic = 'force-dynamic';

function formatMoney(cents: number | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export default async function OcrReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const { id } = await params;

  const doc = await prisma.ocrDocument.findFirst({
    where: { id, tenantId: me.tenantId },
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' } },
      poAttachment: {
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          purchaseOrderId: true,
          purchaseOrder: {
            select: {
              number: true,
              vendorId: true,
              vendor: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!doc) notFound();

  const previewHref =
    doc.poAttachment &&
    `/api/po/${doc.poAttachment.purchaseOrderId}/attachments/${doc.poAttachment.id}`;

  const poId = doc.poAttachment?.purchaseOrderId ?? null;
  const poNumber = doc.poAttachment?.purchaseOrder.number ?? null;

  const lines: ApprovalLineRow[] = doc.lineItems.map((l) => ({
    id: l.id,
    rawLineText: l.rawLineText,
    itemLabelNormalized: l.itemLabelNormalized,
    unitPriceCentsGuess: l.unitPriceCentsGuess,
    quantityMilliGuess: l.quantityMilliGuess,
    extractionSource: l.extractionSource,
    confidence: l.confidence,
  }));

  const isReview = doc.status === OcrJobStatus.REVIEW_REQUIRED;
  const isFailed = doc.status === OcrJobStatus.FAILED;
  const isConfirmed = doc.status === OcrJobStatus.CONFIRMED;
  const failureHint = isFailed ? ocrFailureHint(doc.lastError) : null;

  return (
    <div className="-mx-1 rounded-xl bg-[var(--color-bv-bg)] px-1 pb-2">
      <PageHeader
        title={doc.poAttachment?.originalFilename ?? 'Receipt OCR'}
        subtitle={`${labelOcrJobStatus(doc.status)} · ${doc.lineItems.length} line${doc.lineItems.length === 1 ? '' : 's'}`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2 text-[12px]">
            <OcrStatusChip status={doc.status} />
            {doc.poAttachment ? (
              <>
                <span className="text-[var(--color-bv-muted)]">·</span>
                <Link
                  className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                  href={`/purchase-orders/${doc.poAttachment.purchaseOrderId}`}
                >
                  PO {doc.poAttachment.purchaseOrder.number}
                </Link>
                <span className="text-[var(--color-bv-muted)]">·</span>
                <span className="truncate text-[var(--color-bv-muted)]">
                  {doc.poAttachment.purchaseOrder.vendor?.name ?? 'No vendor on PO'}
                </span>
              </>
            ) : null}
            {previewHref ? (
              <>
                <span className="text-[var(--color-bv-muted)]">·</span>
                <a
                  href={previewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                >
                  Open attachment
                </a>
              </>
            ) : null}
            <span className="ml-auto text-[11px] text-[var(--color-bv-muted)]">{doc.engineLabel}</span>
          </div>

          {isFailed && doc.lastError ? (
            <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-[12px]">
              <p className="font-medium text-red-950">OCR engine failed</p>
              <p className="mt-0.5 text-red-900/90">{doc.lastError}</p>
              {failureHint ? (
                <p className="mt-1 text-[11px] text-red-800/80">{failureHint}</p>
              ) : null}
              <p className="mt-1.5 text-[11px] text-[var(--color-bv-muted)]">
                Failed jobs did not produce reviewable lines. Re-upload from the PO attachments panel
                or open the source file to enter prices manually.
              </p>
            </div>
          ) : null}

          {isReview ? (
            <OcrLineReviewTable documentId={doc.id} lines={lines} />
          ) : null}

          <details className="rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]">
            <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]">
              Document metadata & OCR preview
            </summary>
            <div className="border-t border-[var(--color-bv-border)] px-3 py-2 text-[12px]">
              <dl className="mb-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                <Meta label="Vendor guess" value={doc.vendorNameGuess} />
                <Meta label="Invoice #" value={doc.invoiceNumberGuess} />
                <Meta label="Receipt #" value={doc.receiptNumberGuess} />
                <Meta
                  label="Totals guess"
                  value={`Sub ${formatMoney(doc.subtotalCentsGuess)} · Tax ${formatMoney(doc.taxCentsGuess)} · ${formatMoney(doc.totalCentsGuess)}`}
                />
                {doc.rawTextCharCount != null ? (
                  <Meta label="OCR chars" value={doc.rawTextCharCount.toLocaleString()} />
                ) : null}
              </dl>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-bv-bg)] p-2 font-mono text-[10px] leading-snug text-[var(--color-bv-muted)]">
                {doc.rawTextSnippet ?? '—'}
              </pre>
            </div>
          </details>
        </div>

        <OcrDecisionRail
          documentId={doc.id}
          lines={lines}
          previewHref={previewHref}
          purchaseOrderId={poId}
          purchaseOrderNumber={poNumber}
          disabled={!isReview}
        />
      </div>

      {isConfirmed && doc.poAttachment ? (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-[12px] text-emerald-950">
          <span className="font-medium">Approved</span>
          {' — '}
          vendor price history was written for selected lines. A reconciliation snapshot was created
          (or already existed).{' '}
          <Link
            href={`/purchase-orders/${doc.poAttachment.purchaseOrderId}/reconciliation`}
            className="font-medium underline-offset-2 hover:underline"
          >
            Open PO reconciliation
          </Link>
        </div>
      ) : null}

      {!isReview && !isConfirmed && !isFailed ? (
        <p className="mt-3 text-[12px] text-[var(--color-bv-muted)]">
          This job is not awaiting review ({labelOcrJobStatus(doc.status)}).
        </p>
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-[var(--color-bv-text)]">{value ?? '—'}</dd>
    </div>
  );
}

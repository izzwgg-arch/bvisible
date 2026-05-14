import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { OcrJobStatus, prisma, Role } from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import {
  OcrApprovalForm,
  type ApprovalLineRow,
} from '@/app/(app)/admin/ocr-review/ocr-approval-form';

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
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) redirect('/dashboard?error=no-tenant');

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

  const lines: ApprovalLineRow[] = doc.lineItems.map((l) => ({
    id: l.id,
    rawLineText: l.rawLineText,
    itemLabelNormalized: l.itemLabelNormalized,
    unitPriceCentsGuess: l.unitPriceCentsGuess,
    confidence: l.confidence,
  }));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="OCR extraction detail"
        subtitle="Suggestions only — approve to append vendor price observations."
        actions={
          <Link
            href="/admin/ocr-review"
            className="rounded-md border border-[var(--color-bv-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-bv-text)]"
          >
            Back to queue
          </Link>
        }
      />

      <div className="grid gap-4 rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 text-[13px]">
        <div className="flex flex-wrap gap-4">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-slate-800">
            {doc.status}
          </span>
          <span className="text-[var(--color-bv-muted)]">
            Engine: {doc.engineLabel}
          </span>
        </div>
        {doc.poAttachment ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[var(--color-bv-text)]">
              {doc.poAttachment.originalFilename}
            </span>
            <span className="text-[var(--color-bv-muted)]">
              PO{' '}
              <Link
                className="text-emerald-700 underline"
                href={`/purchase-orders/${doc.poAttachment.purchaseOrderId}`}
              >
                {doc.poAttachment.purchaseOrder.number}
              </Link>
              {' · '}
              Vendor:{' '}
              {doc.poAttachment.purchaseOrder.vendor?.name ?? '— (assign vendor on PO)'}
            </span>
            {previewHref ? (
              <a
                href={previewHref}
                className="mt-1 text-[13px] font-medium text-emerald-700 underline"
              >
                Download original attachment (authenticated)
              </a>
            ) : null}
          </div>
        ) : null}

        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold uppercase text-[var(--color-bv-muted)]">
              Vendor guess
            </dt>
            <dd>{doc.vendorNameGuess ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase text-[var(--color-bv-muted)]">
              Invoice #
            </dt>
            <dd>{doc.invoiceNumberGuess ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase text-[var(--color-bv-muted)]">
              Receipt #
            </dt>
            <dd>{doc.receiptNumberGuess ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase text-[var(--color-bv-muted)]">
              Totals guess
            </dt>
            <dd>
              Subtotal {formatMoney(doc.subtotalCentsGuess)} · Tax{' '}
              {formatMoney(doc.taxCentsGuess)} · Total{' '}
              {formatMoney(doc.totalCentsGuess)}
            </dd>
          </div>
        </dl>

        {doc.lastError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-900">
            Last error: {doc.lastError}
          </p>
        ) : null}

        <div>
          <h2 className="mb-2 text-[14px] font-semibold text-[var(--color-bv-text)]">
            OCR text preview (truncated)
          </h2>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-bv-bg)] p-3 font-mono text-[11px] text-[var(--color-bv-muted)]">
            {doc.rawTextSnippet ?? '—'}
          </pre>
        </div>
      </div>

      {doc.status === OcrJobStatus.REVIEW_REQUIRED ? (
        <div className="rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4">
          <h2 className="mb-3 text-[14px] font-semibold text-[var(--color-bv-text)]">
            Operator decision
          </h2>
          <OcrApprovalForm documentId={doc.id} lines={lines} />
        </div>
      ) : (
        <p className="text-[13px] text-[var(--color-bv-muted)]">
          This job is not awaiting review ({doc.status}).
        </p>
      )}
    </div>
  );
}

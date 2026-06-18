import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EstimateStatus, prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { buildCustomerQuoteLines } from '@/lib/estimate/customer-quote-view';
import { loadEstimateQuoteStaffUi } from '@/lib/estimate/load-estimate-quote-staff-ui';
import { QuoteDocument } from './quote-document';
import { QuotePreviewToolbar } from './quote-preview-toolbar';
import { SendEstimateEmailForm } from './send-estimate-form';
import { EstimateQuoteResponseSummary } from '@/components/estimate/estimate-quote-response-summary';
import { EstimateQuoteLinkPanel } from '@/components/estimate/estimate-quote-link-panel';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { getTenantInvoiceProfile } from '@/lib/company/tenant-invoice-profile';

export const metadata = { title: 'Estimate quote' };
export const dynamic = 'force-dynamic';

function formatQuoteDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(d);
}

export default async function EstimatePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const estimate = await prisma.estimate.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      title: true,
      notes: true,
      status: true,
      subtotalCostCents: true,
      finalPriceCents: true,
      updatedAt: true,
      tenant: { select: { id: true, name: true } },
      client: {
        select: {
          companyName: true,
          contactName: true,
          email: true,
          phone: true,
        },
      },
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          description: true,
          qtyMilli: true,
          kind: true,
          computedCostCents: true,
        },
      },
    },
  });

  if (!estimate) {
    notFound();
  }

  const quoteUi = await loadEstimateQuoteStaffUi(
    prisma,
    me.tenantId,
    estimate.id,
    estimate.number,
    estimate.status
  );

  const quoteLines = buildCustomerQuoteLines(
    estimate.lines,
    estimate.subtotalCostCents,
    estimate.finalPriceCents
  );

  const backHref = `/estimates/${estimate.id}`;
  const isFinalized = estimate.status === EstimateStatus.FINALIZED;
  const company = await getTenantInvoiceProfile(prisma, estimate.tenant);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Quote preview"
          subtitle={
            isFinalized
              ? 'Finalized estimate — customer-facing sell totals only. Print/PDF hides app chrome and internal costs.'
              : 'Customer-facing layout — use Print for PDF. Selling totals only (no internal costs).'
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {isFinalized ? <FinalizedReadOnlyChip /> : null}
              <Link
                href="/estimates"
                className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
              >
                All estimates
              </Link>
            </div>
          }
        />
      </div>

      <QuotePreviewToolbar backHref={backHref} />

      <div className="mx-auto mb-8 flex max-w-[880px] flex-col gap-4 px-4 print:hidden">
        <EstimateQuoteResponseSummary {...quoteUi.quoteSummaryProps} />
        <EstimateQuoteLinkPanel
          estimateId={estimate.id}
          estimateStatus={estimate.status}
          quoteLinkRowsDesc={quoteUi.quoteLinkRows}
          activeLink={quoteUi.quotePanelProps.activeLink}
          phaseBadgeLabel={quoteUi.quotePanelProps.phaseBadgeLabel}
          disableRegenerate={quoteUi.quotePanelProps.disableRegenerate}
          regenerateDisabledReason={quoteUi.quotePanelProps.regenerateDisabledReason}
        />
      </div>

      <QuoteDocument
        company={company}
        estimateNumber={estimate.number}
        title={estimate.title}
        quoteDateLabel={`Updated ${formatQuoteDate(estimate.updatedAt)}`}
        billTo={{
          companyName: estimate.client.companyName,
          contactName: estimate.client.contactName,
          email: estimate.client.email,
          phone: estimate.client.phone,
        }}
        lines={quoteLines}
        totalSellCents={estimate.finalPriceCents}
        notes={estimate.notes}
      />

      <div className="mt-10">
        <SendEstimateEmailForm
          estimateId={estimate.id}
          clientEmail={estimate.client.email}
          status={estimate.status}
        />
      </div>
    </>
  );
}

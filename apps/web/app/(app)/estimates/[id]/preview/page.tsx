import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { buildCustomerQuoteLines } from '@/lib/estimate/customer-quote-view';
import { QuoteDocument } from './quote-document';
import { QuotePreviewToolbar } from './quote-preview-toolbar';
import { SendEstimateEmailForm } from './send-estimate-form';

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
      tenant: { select: { name: true } },
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

  const quoteLines = buildCustomerQuoteLines(
    estimate.lines,
    estimate.subtotalCostCents,
    estimate.finalPriceCents
  );

  const backHref = `/estimates/${estimate.id}`;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Quote preview"
          subtitle="Customer-facing layout — use Print for PDF. Selling totals only (no internal costs)."
          actions={
            <Link
              href="/estimates"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              All estimates
            </Link>
          }
        />
      </div>

      <QuotePreviewToolbar backHref={backHref} />

      <QuoteDocument
        companyName={estimate.tenant.name}
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

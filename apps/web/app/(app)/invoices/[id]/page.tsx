import Link from 'next/link';
import { notFound } from 'next/navigation';

import { InvoiceStatus, prisma } from '@bvisible/db';

import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { InvoiceEstimateOriginSection } from '@/components/invoice/invoice-estimate-origin-section';
import { InvoiceMarkPaidButton } from '@/components/invoice/invoice-mark-paid-button';
import { formatMoney } from '@/lib/estimate/format';
import { loadEstimateQuoteStaffUi } from '@/lib/estimate/load-estimate-quote-staff-ui';
import { labelInvoiceStatus } from '@/lib/ui/status-labels';

export const metadata = { title: 'Invoice' };
export const dynamic = 'force-dynamic';

const STATUS_CHIP: Record<InvoiceStatus, string> = {
  UNPAID: 'border-amber-200 bg-amber-50 text-amber-950',
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  VOIDED: 'border-slate-200 bg-slate-50 text-slate-800',
};

function formatQty(qtyMilli: number): string {
  const n = qtyMilli / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      subtotalCents: true,
      notes: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      estimateId: true,
      createdBy: { select: { name: true, email: true } },
      client: { select: { id: true, companyName: true } },
      estimate: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          client: { select: { companyName: true } },
        },
      },
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          kind: true,
          description: true,
          qtyMilli: true,
          lineTotalCents: true,
          notes: true,
        },
      },
    },
  });

  if (!invoice) {
    notFound();
  }

  const linkedPoCount =
    invoice.estimateId != null
      ? await prisma.purchaseOrder.count({
          where: {
            tenantId: me.tenantId,
            estimateId: invoice.estimateId,
            deletedAt: null,
          },
        })
      : 0;

  const estimateQuoteUi =
    invoice.estimate != null
      ? await loadEstimateQuoteStaffUi(
          prisma,
          me.tenantId,
          invoice.estimate.id,
          invoice.estimate.number,
          invoice.estimate.status
        )
      : null;

  return (
    <>
      <PageHeader
        title={invoice.number}
        subtitle={`${invoice.client.companyName} · created by ${invoice.createdBy.name ?? invoice.createdBy.email}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {invoice.status === InvoiceStatus.UNPAID ? (
              <InvoiceMarkPaidButton invoiceId={invoice.id} />
            ) : null}
            <Link
              href="/invoices"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              All invoices
            </Link>
          </div>
        }
      />

      <div className="mx-auto mb-6 max-w-[1200px] px-4 lg:px-6">
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 shadow-[var(--shadow-bv-card)]">
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_CHIP[invoice.status]}`}
          >
            {labelInvoiceStatus(invoice.status)}
          </span>
          <span className="text-[13px] text-[var(--color-bv-text)]">
            Sell total <span className="font-mono font-semibold">{formatMoney(invoice.subtotalCents)}</span>
          </span>
          {invoice.status === InvoiceStatus.PAID && invoice.paidAt ? (
            <span className="text-[12.5px] text-emerald-900">
              Paid{' '}
              <time dateTime={invoice.paidAt.toISOString()}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(invoice.paidAt)}
              </time>
            </span>
          ) : null}
          {invoice.estimate ? (
            <Link
              href={`/estimates/${invoice.estimate.id}`}
              className="text-[13px] font-medium text-[var(--color-bv-accent)] hover:underline"
            >
              Source estimate {invoice.estimate.number} →
            </Link>
          ) : null}
        </div>

        {estimateQuoteUi != null && invoice.estimate != null ? (
          <InvoiceEstimateOriginSection
            estimateId={invoice.estimate.id}
            estimateNumber={invoice.estimate.number}
            estimateTitle={invoice.estimate.title}
            clientCompanyName={invoice.estimate.client.companyName}
            estimateStatus={invoice.estimate.status}
            linkedPoCount={linkedPoCount}
            quoteSummaryProps={estimateQuoteUi.quoteSummaryProps}
          />
        ) : null}

        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Line items
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line, idx) => (
                  <tr key={`${idx}-${line.description.slice(0, 24)}`} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                    <td className="max-w-[480px] py-2 pr-3 align-top">
                      <span className="font-medium text-[var(--color-bv-text)]">{line.description}</span>
                      {line.notes ? (
                        <span className="mt-0.5 block text-[12px] text-[var(--color-bv-muted)]">{line.notes}</span>
                      ) : null}
                      <span className="mt-0.5 block font-mono text-[11px] text-[var(--color-bv-muted)]">{line.kind}</span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 align-top tabular-nums">{formatQty(line.qtyMilli)}</td>
                    <td className="py-2 pr-3 text-right align-top tabular-nums font-medium">{formatMoney(line.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {invoice.notes ? (
          <section className="mt-5 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Notes
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-bv-text)]">{invoice.notes}</p>
          </section>
        ) : null}

        <p className="mt-4 text-[11px] text-[var(--color-bv-muted)]">
          Issued{' '}
          <time dateTime={invoice.createdAt.toISOString()}>
            {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
              invoice.createdAt
            )}
          </time>
          {' · '}
          Updated{' '}
          <time dateTime={invoice.updatedAt.toISOString()}>
            {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
              invoice.updatedAt
            )}
          </time>
        </p>
      </div>
    </>
  );
}

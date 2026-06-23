import Link from 'next/link';
import { prisma, InvoiceStatus } from '@bvisible/db';

import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney } from '@/lib/estimate/format';
import { labelInvoiceStatus } from '@/lib/ui/status-labels';

export const metadata = { title: 'Invoices' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<InvoiceStatus, string> = {
  UNPAID: 'border-amber-200 bg-amber-50 text-amber-950',
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  VOIDED: 'border-slate-200 bg-slate-50 text-slate-800',
};

export default async function InvoicesPage() {
  const me = await requireTenantId();

  const invoices = await prisma.invoice.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      number: true,
      status: true,
      subtotalCents: true,
      updatedAt: true,
      estimateId: true,
      estimate: { select: { id: true, number: true } },
      client: { select: { companyName: true } },
    },
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`Sales invoices for ${me.tenant.name}. ${invoices.length} on file.`}
      />

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Convert an approved estimate to create an unpaid invoice with copied lines and totals."
          primaryAction={{ label: 'Go to estimates', href: '/estimates' }}
          secondaryAction={{ label: 'Dashboard', href: '/dashboard' }}
        />
      ) : (
        <section className="flex max-h-[calc(100vh-220px)] min-h-[320px] flex-col overflow-hidden rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="min-h-0 overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-5 py-2 font-medium">Number</th>
                  <th className="px-5 py-2 font-medium">Client</th>
                  <th className="px-5 py-2 font-medium">Estimate</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium text-right">Subtotal</th>
                  <th className="px-5 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]"
                  >
                    <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--color-bv-text)]">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="hover:text-[var(--color-bv-accent)]"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate px-5 py-2.5 text-[var(--color-bv-text)]">
                      {inv.client.companyName}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--color-bv-muted)]">
                      {inv.estimate ? (
                        <Link
                          href={`/estimates/${inv.estimate.id}`}
                          className="hover:text-[var(--color-bv-accent)]"
                        >
                          {inv.estimate.number}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${STATUS_TONE[inv.status]}`}
                      >
                        {labelInvoiceStatus(inv.status)}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-[var(--color-bv-text)]">
                      {formatMoney(inv.subtotalCents)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-[12px] text-[var(--color-bv-muted)]">
                      <time dateTime={inv.updatedAt.toISOString()}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(inv.updatedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

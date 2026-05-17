import Link from 'next/link';
import { prisma, EstimateStatus } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney } from '@/lib/estimate/format';
import { getEstimateListNextAction } from '@/lib/estimate/estimate-list-next-action';
import { labelEstimateStatus } from '@/lib/ui/status-labels';

export const metadata = { title: 'Estimates' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<EstimateStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
  FINALIZED: 'border-violet-200 bg-violet-50 text-violet-700',
};

export default async function EstimatesPage() {
  const me = await requireTenantId();

  const [estimates, hasClients] = await Promise.all([
    prisma.estimate.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        finalPriceCents: true,
        updatedAt: true,
        client: { select: { id: true, companyName: true } },
        _count: {
          select: {
            purchaseOrders: { where: { deletedAt: null } },
            invoices: { where: { deletedAt: null } },
          },
        },
      },
      take: 200,
    }),
    prisma.client.count({
      where: { tenantId: me.tenantId, deletedAt: null },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Estimates"
        subtitle={`Quotes and jobs for ${me.tenant.name}. ${estimates.length} on file.`}
        actions={
          hasClients > 0 ? (
            <Link
              href="/estimates/new"
              className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
            >
              New estimate
            </Link>
          ) : (
            <Link
              href="/clients/new"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Add client first
            </Link>
          )
        }
      />

      {estimates.length === 0 ? (
        <EmptyState
          title="No estimates yet"
          description={
            hasClients > 0 ? (
              <>
                Start with job info, then add catalog items or pricing-helper lines in the editor.
              </>
            ) : (
              <>
                Add a{' '}
                <Link href="/clients/new" className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline">
                  client
                </Link>{' '}
                first — every estimate belongs to a customer.
              </>
            )
          }
          primaryAction={
            hasClients > 0
              ? { label: 'New estimate', href: '/estimates/new' }
              : { label: 'Create client', href: '/clients/new' }
          }
        />
      ) : (
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Sell</th>
                  <th className="px-4 py-2 font-medium">Next</th>
                  <th className="px-4 py-2 font-medium text-right">Quick</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((e) => {
                  const hasPo = e._count.purchaseOrders > 0;
                  const hasInvoice = e._count.invoices > 0;
                  const next = getEstimateListNextAction({
                    id: e.id,
                    status: e.status,
                    hasLinkedPo: hasPo,
                    hasLinkedInvoice: hasInvoice,
                  });
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/estimates/${e.id}` as never}
                          className="block hover:text-[var(--color-bv-accent)]"
                        >
                          <span className="font-mono text-[11.5px] text-[var(--color-bv-muted)]">{e.number}</span>
                          <span className="mt-0.5 block font-medium text-[var(--color-bv-text)]">{e.title}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-bv-muted)]">{e.client.companyName}</td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={e.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-[var(--color-bv-text)]">
                        {formatMoney(e.finalPriceCents)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={next.href as never}
                          className={`text-[12.5px] font-medium hover:underline ${
                            next.tone === 'primary'
                              ? 'text-[var(--color-bv-accent)]'
                              : 'text-[var(--color-bv-muted)]'
                          }`}
                        >
                          {next.label}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <QuickActions
                          id={e.id}
                          status={e.status}
                          hasPo={hasPo}
                          hasInvoice={hasInvoice}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function QuickActions({
  id,
  status,
  hasPo,
  hasInvoice,
}: {
  id: string;
  status: EstimateStatus;
  hasPo: boolean;
  hasInvoice: boolean;
}) {
  const base = `/estimates/${id}`;
  const links: { label: string; href: string }[] = [];

  if (status === EstimateStatus.DRAFT || status === EstimateStatus.REJECTED) {
    links.push({ label: 'Edit', href: base });
  }
  if (status !== EstimateStatus.FINALIZED) {
    links.push({ label: 'Quote', href: `${base}/preview` });
  }
  if (status === EstimateStatus.APPROVED && !hasPo) {
    links.push({ label: 'PO', href: `${base}#estimate-create-po` });
  }
  if (status === EstimateStatus.APPROVED && hasPo && !hasInvoice) {
    links.push({ label: 'Invoice', href: `${base}#estimate-linked-invoice` });
  }

  return (
    <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href as never}
          className="text-[11.5px] font-medium text-[var(--color-bv-muted)] hover:text-[var(--color-bv-accent)] hover:underline"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: EstimateStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${STATUS_TONE[status]}`}
    >
      {labelEstimateStatus(status)}
    </span>
  );
}

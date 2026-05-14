import Link from 'next/link';
import { prisma, EstimateStatus } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatMoney } from '@/lib/estimate/format';

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
        subtotalCostCents: true,
        updatedAt: true,
        client: { select: { id: true, companyName: true } },
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
        subtitle={`Quotes for ${me.tenant.name}. ${estimates.length} on file.`}
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
              Add a client first
            </Link>
          )
        }
      />

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-5 py-2 font-medium">Number</th>
                <th className="px-5 py-2 font-medium">Title</th>
                <th className="px-5 py-2 font-medium">Client</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium text-right">Sell price</th>
                <th className="px-5 py-2 font-medium text-right">Cost</th>
                <th className="px-5 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]">
                  <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--color-bv-text)]">
                    <Link href={`/estimates/${e.id}` as never} className="hover:text-[var(--color-bv-accent)]">
                      {e.number}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-text)]">
                    <Link href={`/estimates/${e.id}` as never} className="hover:text-[var(--color-bv-accent)]">
                      {e.title}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{e.client.companyName}</td>
                  <td className="px-5 py-2.5">
                    <StatusPill status={e.status} />
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium text-[var(--color-bv-text)] tabular-nums">
                    {formatMoney(e.finalPriceCents)}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[var(--color-bv-muted)] tabular-nums">
                    {formatMoney(e.subtotalCostCents)}
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                    {e.updatedAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
              {estimates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[var(--color-bv-muted)]">
                    {hasClients > 0
                      ? 'No estimates yet. Click “New estimate” to start one.'
                      : 'No estimates yet. Add a client first.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function StatusPill({ status }: { status: EstimateStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${STATUS_TONE[status]}`}
    >
      {status}
    </span>
  );
}

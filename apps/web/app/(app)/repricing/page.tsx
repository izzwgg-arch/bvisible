import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { DEFAULT_PAGE_SIZE, PaginationControls, pageSkip, parsePageParam } from '@/components/app/pagination-controls';
import { SelectControl } from '@/components/app/select-control';
import { updateRepricingRequestStatusAction } from '../items/actions';

export const metadata = { title: 'Repricing requests' };
export const dynamic = 'force-dynamic';

export default async function RepricingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const [requests, total] = await Promise.all([
    prisma.repricingRequest.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ createdAt: 'desc' }],
      skip: pageSkip(page),
      take: DEFAULT_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        oldCostCents: true,
        reason: true,
        notes: true,
        createdAt: true,
        completedAt: true,
        shopMaterialItem: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        requestedBy: { select: { name: true, email: true } },
        completedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.repricingRequest.count({ where: { tenantId: me.tenantId } }),
  ]);

  return (
    <>
      <PageHeader
        title="Repricing requests"
        subtitle="Flag catalog/vendor costs for review without changing estimate pricing automatically."
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Back to catalog
          </Link>
        }
      />
      <section className="overflow-hidden rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Old cost</th>
              <th className="px-3 py-2">Requested by</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="border-b border-[var(--color-bv-border)] align-top">
                <td className="px-3 py-3">
                  <Link href={`/items/${request.shopMaterialItem.id}`} className="font-semibold text-[var(--color-bv-accent)] hover:underline">
                    {request.shopMaterialItem.name}
                  </Link>
                </td>
                <td className="px-3 py-3">{request.vendor?.name ?? 'Any vendor'}</td>
                <td className="px-3 py-3 tabular-nums">
                  {typeof request.oldCostCents === 'number'
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(request.oldCostCents / 100)
                    : '—'}
                </td>
                <td className="px-3 py-3">
                  {(request.requestedBy.name || request.requestedBy.email) ?? 'Unknown'}
                </td>
                <td className="px-3 py-3">
                  <p className="font-medium text-[var(--color-bv-text)]">{request.reason}</p>
                  {request.notes ? <p className="mt-1 text-[12px] text-[var(--color-bv-muted)]">{request.notes}</p> : null}
                </td>
                <td className="px-3 py-3">
                  <form action={updateRepricingRequestStatusAction} className="flex flex-col gap-2">
                    <input type="hidden" name="requestId" value={request.id} />
                    <SelectControl
                      name="status"
                      defaultValue={request.status}
                      className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 text-[12px] font-semibold text-[var(--color-bv-text)]"
                    >
                      <option value="REQUESTED">Requested</option>
                      <option value="IN_REVIEW">In review</option>
                      <option value="UPDATED">Updated</option>
                      <option value="IGNORED">Ignored</option>
                    </SelectControl>
                    <button
                      type="submit"
                      className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1.5 text-[12px] font-semibold text-[var(--color-bv-text)]"
                    >
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <PaginationControls basePath="/repricing" page={page} total={total} />
      </section>
    </>
  );
}

import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';

export const metadata = { title: 'Vendors' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  created?: string;
}

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const vendors = await prisma.vendor.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      _count: { select: { purchaseOrders: true } },
      updatedAt: true,
    },
    take: 500,
  });

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle={`Suppliers you order from. ${vendors.length} on file.`}
        actions={
          <Link
            href="/vendors/new"
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
          >
            New vendor
          </Link>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-medium">{sp.created}</span>.
        </div>
      ) : null}

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-5 py-2 font-medium">Name</th>
                <th className="px-5 py-2 font-medium">Email</th>
                <th className="px-5 py-2 font-medium">Phone</th>
                <th className="px-5 py-2 font-medium">POs</th>
                <th className="px-5 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/vendors/${v.id}`}
                      className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{v.email ?? '—'}</td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{v.phone ?? '—'}</td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                    {v._count.purchaseOrders}
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                    {v.updatedAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
              {vendors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[var(--color-bv-muted)]">
                    No vendors yet. Add your first one to start writing POs.
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

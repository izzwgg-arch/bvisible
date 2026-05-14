import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { NewPoForm } from './new-po-form';

export const metadata = { title: 'New PO' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  estimateId?: string;
}

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const [vendors, estimates] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true },
      take: 500,
    }),
    prisma.estimate.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      select: { id: true, number: true, title: true },
      take: 200,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="New purchase order"
        subtitle="Pick a vendor and (optionally) link an estimate. Add lines after."
        actions={
          <Link
            href="/purchase-orders"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Cancel
          </Link>
        }
      />
      <section className="max-w-xl rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
        <NewPoForm
          vendors={vendors}
          estimates={estimates}
          defaultEstimateId={sp.estimateId ?? null}
        />
      </section>
    </>
  );
}

import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { NewEstimateForm } from './new-estimate-form';

export const metadata = { title: 'New estimate' };
export const dynamic = 'force-dynamic';

export default async function NewEstimatePage() {
  const me = await requireTenantId();

  const clients = await prisma.client.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ companyName: 'asc' }],
    select: { id: true, companyName: true },
    take: 500,
  });

  return (
    <>
      <PageHeader
        title="New estimate"
        subtitle="Pick a client and a job title. You'll add line items next."
        actions={
          <Link
            href="/estimates"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Cancel
          </Link>
        }
      />
      <section className="max-w-xl rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
        {clients.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] text-[var(--color-bv-text)]">
              You need at least one client before you can create an estimate.
            </p>
            <Link
              href="/clients/new"
              className="self-start inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
            >
              Add a client
            </Link>
          </div>
        ) : (
          <NewEstimateForm clients={clients} />
        )}
      </section>
    </>
  );
}

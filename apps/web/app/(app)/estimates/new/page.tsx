import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { NewEstimateForm } from './new-estimate-form';

export const metadata = { title: 'New estimate' };
export const dynamic = 'force-dynamic';

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const clients = await prisma.client.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ companyName: 'asc' }],
    select: { id: true, companyName: true },
  });

  return (
    <>
      <PageHeader
        title="New estimate"
        subtitle="Client and job title first — lines come on the next screen."
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
          <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-4">
            <p className="text-[13px] leading-snug text-[var(--color-bv-text)]">
              Add a client record first — every estimate belongs to a customer.
            </p>
            <Link
              href="/clients/new"
              className="self-start inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95"
            >
              Create client →
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-4 text-[13px] leading-snug text-[var(--color-bv-muted)]">
              <span className="font-medium text-[var(--color-bv-text)]">1.</span> Pick the customer ·{' '}
              <span className="font-medium text-[var(--color-bv-text)]">2.</span> Name the job ·{' '}
              <span className="font-medium text-[var(--color-bv-text)]">3.</span> Add catalog or pricing-helper lines on the next screen.
            </p>
            <NewEstimateForm clients={clients} defaultClientId={sp.clientId ?? null} />
          </>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { StartBidForm } from './start-bid-form';

export const metadata = { title: 'New bid estimate' };
export const dynamic = 'force-dynamic';

export default async function NewBidEstimatePage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const [clients, users, defaultClient] = await Promise.all([
    prisma.client.findMany({ where: { tenantId: me.tenantId, deletedAt: null }, orderBy: [{ companyName: 'asc' }], take: 50, select: { id: true, companyName: true } }),
    prisma.user.findMany({ where: { tenantId: me.tenantId, disabledAt: null }, orderBy: [{ name: 'asc' }], select: { id: true, name: true, email: true } }),
    sp.clientId ? prisma.client.findFirst({ where: { id: sp.clientId, tenantId: me.tenantId, deletedAt: null }, select: { id: true, companyName: true } }) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New bid estimate"
        subtitle="Seven guided steps: project details → upload the takeoff and plans → review pricing → office questions → design → installation → customer-ready estimate and QBME. Everything autosaves; you can leave and resume any time."
        actions={
          <Link href="/estimates/new" className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]">
            Use the quick builder instead
          </Link>
        }
      />
      <StartBidForm clients={clients} defaultClientId={defaultClient?.id ?? null} defaultClientName={defaultClient?.companyName ?? null} users={users.map((u) => ({ id: u.id, name: u.name ?? u.email }))} currentUserId={me.id} />
    </div>
  );
}

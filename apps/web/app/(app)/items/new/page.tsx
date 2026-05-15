import Link from 'next/link';
import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { CreateShopMaterialItemForm } from './create-item-form';

export const metadata = { title: 'New item' };
export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const me = await requireTenantId();
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const machines = await prisma.machine.findMany({
    where: { tenantId: me.tenantId, isActive: true },
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, ratePerHourCents: true },
    take: 200,
  });

  if (!canManage) {
    return (
      <>
        <PageHeader title="New item" subtitle="Admin access required." />
        <p className="text-[13px] text-[var(--color-bv-muted)]">
          Ask an administrator to create catalog items.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New item"
        subtitle="Estimating catalog entry — materials use vendor pricing; other kinds use internal rates."
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            All items
          </Link>
        }
      />
      <div className="mx-auto max-w-xl rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
        <CreateShopMaterialItemForm machines={machines} />
      </div>
    </>
  );
}

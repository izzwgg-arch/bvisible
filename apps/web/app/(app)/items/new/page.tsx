import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { CatalogItemEditor } from '../catalog-item-editor';

export const metadata = { title: 'Create catalog item' };
export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const me = await requireTenantId();
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const [machines, savedCategories, vendors] = await Promise.all([
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, ratePerHourCents: true },
      take: 200,
    }),
    prisma.shopItemCategory.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ name: 'asc' }],
      select: { name: true },
      take: 200,
    }),
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 400,
    }),
  ]);

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
      <CatalogItemEditor
        mode="create"
        machines={machines}
        savedCategories={savedCategories.map((c) => c.name)}
        vendors={vendors}
        vendorRows={[]}
      />
    </>
  );
}

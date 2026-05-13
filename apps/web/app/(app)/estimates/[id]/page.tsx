import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EstimateEditor, type EditorBootstrap } from './editor';

export const metadata = { title: 'Estimate' };
export const dynamic = 'force-dynamic';

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const [estimate, machines, clients] = await Promise.all([
    prisma.estimate.findFirst({
      where: { id, tenantId: me.tenantId, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        notes: true,
        multiplierMilli: true,
        designFlatCents: true,
        subtotalCostCents: true,
        finalPriceCents: true,
        updatedAt: true,
        client: { select: { id: true, companyName: true } },
        createdBy: { select: { email: true, name: true } },
        lines: {
          orderBy: [{ sortOrder: 'asc' }],
          select: {
            id: true,
            kind: true,
            description: true,
            qtyMilli: true,
            unitCostCents: true,
            machineId: true,
            notes: true,
          },
        },
      },
    }),
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, ratePerHourCents: true },
    }),
    prisma.client.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ companyName: 'asc' }],
      select: { id: true, companyName: true },
      take: 500,
    }),
  ]);

  if (!estimate) {
    notFound();
  }

  const bootstrap: EditorBootstrap = {
    estimate: {
      id: estimate.id,
      number: estimate.number,
      title: estimate.title,
      status: estimate.status,
      notes: estimate.notes ?? '',
      multiplierMilli: estimate.multiplierMilli,
      designFlatCents: estimate.designFlatCents,
      subtotalCostCents: estimate.subtotalCostCents,
      finalPriceCents: estimate.finalPriceCents,
      updatedAt: estimate.updatedAt.toISOString(),
      client: estimate.client,
    },
    lines: estimate.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      description: l.description,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      machineId: l.machineId,
      notes: l.notes,
    })),
    machines,
    clients,
    canDelete: me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN,
  };

  return (
    <>
      <PageHeader
        title={`${estimate.number} · ${estimate.title}`}
        subtitle={`Client: ${estimate.client.companyName} · created by ${
          estimate.createdBy.name ?? estimate.createdBy.email
        }`}
        actions={
          <Link
            href="/estimates"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Back to estimates
          </Link>
        }
      />
      <EstimateEditor bootstrap={bootstrap} />
    </>
  );
}

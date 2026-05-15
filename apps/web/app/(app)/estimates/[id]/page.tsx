import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EstimateWorkflowRail } from '@/components/workflow/estimate-workflow-rail';
import { EstimateQuoteLinkPanel } from '@/components/estimate/estimate-quote-link-panel';
import { EstimateEditor, type EditorBootstrap } from './editor';
import { loadEstimateCatalogPickerRows } from '@/lib/shop-material/estimate-catalog-bootstrap';

export const metadata = { title: 'Estimate' };
export const dynamic = 'force-dynamic';

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const now = new Date();

  const [estimate, machines, clients, linkedPos, vendors, shopCatalog, activeQuoteLink] = await Promise.all([
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
    prisma.purchaseOrder.findMany({
      where: { tenantId: me.tenantId, estimateId: id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        number: true,
        status: true,
        qboPoNumber: true,
        subtotalCents: true,
        vendor: { select: { id: true, name: true } },
      },
    }),
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true },
      take: 500,
    }),
    loadEstimateCatalogPickerRows(prisma, me.tenantId),
    prisma.estimateQuoteLink.findFirst({
      where: {
        estimateId: id,
        tenantId: me.tenantId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        expiresAt: true,
        lastViewedAt: true,
        createdAt: true,
      },
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
    vendors,
    linkedPos,
    canDelete: me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN,
    canUnfinalize: me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN,
    shopCatalog,
  };

  return (
    <>
      <PageHeader
        title={`${estimate.number} · ${estimate.title}`}
        subtitle={`Client: ${estimate.client.companyName} · created by ${
          estimate.createdBy.name ?? estimate.createdBy.email
        }`}
        actions={
          <>
            <Link
              href={`/estimates/${estimate.id}/preview`}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Preview quote
            </Link>
            <Link
              href={`/estimates/${estimate.id}/preview`}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Print / PDF
            </Link>
            <Link
              href={`/estimates/${estimate.id}/preview#customer-send`}
              className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95"
            >
              Send to customer
            </Link>
            <Link
              href="/estimates"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Back to estimates
            </Link>
          </>
        }
      />
      <EstimateWorkflowRail
        estimateNumber={estimate.number}
        status={estimate.status}
        linkedPos={linkedPos.map((p) => ({
          id: p.id,
          number: p.number,
          status: p.status,
          qboPoNumber: p.qboPoNumber,
          vendorName: p.vendor?.name ?? null,
        }))}
      />
      <div className="mx-auto mb-6 max-w-[1200px] px-4 lg:px-6">
        <EstimateQuoteLinkPanel
          estimateId={estimate.id}
          activeLink={
            activeQuoteLink
              ? {
                  id: activeQuoteLink.id,
                  expiresAtIso: activeQuoteLink.expiresAt?.toISOString() ?? null,
                  lastViewedAtIso: activeQuoteLink.lastViewedAt?.toISOString() ?? null,
                  createdAtIso: activeQuoteLink.createdAt.toISOString(),
                }
              : null
          }
        />
      </div>
      <EstimateEditor bootstrap={bootstrap} />
    </>
  );
}

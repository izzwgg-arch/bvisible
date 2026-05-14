import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  POAttachmentKind,
  POEventKind,
  POLineKind,
  POStatus,
  Role,
  prisma,
} from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { PoEditor, type PoEditorBootstrap } from './editor';

export const metadata = { title: 'Purchase order' };
export const dynamic = 'force-dynamic';

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const [po, vendors, events] = await Promise.all([
    prisma.purchaseOrder.findFirst({
      where: { id, tenantId: me.tenantId, deletedAt: null },
      select: {
        id: true,
        number: true,
        status: true,
        qboPoNumber: true,
        notes: true,
        subtotalCents: true,
        updatedAt: true,
        createdAt: true,
        vendor: { select: { id: true, name: true } },
        estimate: { select: { id: true, number: true, title: true } },
        createdBy: { select: { name: true, email: true } },
        lines: {
          orderBy: [{ sortOrder: 'asc' }],
          select: {
            id: true,
            kind: true,
            description: true,
            qtyMilli: true,
            unitCostCents: true,
            notes: true,
          },
        },
        attachments: {
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            kind: true,
            createdAt: true,
            sourceEmailId: true,
            uploadedBy: { select: { name: true, email: true } },
          },
        },
      },
    }),
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true },
      take: 500,
    }),
    prisma.pOEvent.findMany({
      where: { purchaseOrderId: id, tenantId: me.tenantId },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        kind: true,
        message: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    }),
  ]);

  if (!po) {
    notFound();
  }

  const bootstrap: PoEditorBootstrap = {
    po: {
      id: po.id,
      number: po.number,
      status: po.status,
      qboPoNumber: po.qboPoNumber,
      notes: po.notes ?? '',
      subtotalCents: po.subtotalCents,
      updatedAt: po.updatedAt.toISOString(),
      vendor: po.vendor,
      estimate: po.estimate,
      createdByLabel: po.createdBy.name ?? po.createdBy.email,
    },
    lines: po.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      description: l.description,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      notes: l.notes,
    })),
    vendors,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
      actorLabel: e.actor ? e.actor.name ?? e.actor.email : null,
    })),
    attachments: po.attachments.map((a) => ({
      id: a.id,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      kind: a.kind,
      createdAt: a.createdAt.toISOString(),
      sourceEmailId: a.sourceEmailId,
      uploadedByLabel: a.uploadedBy.name ?? a.uploadedBy.email,
    })),
    canDelete: me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN,
  };

  return (
    <>
      <PageHeader
        title={`${po.number}${po.estimate ? ` · from ${po.estimate.number}` : ''}`}
        subtitle={`Created by ${po.createdBy.name ?? po.createdBy.email}${
          po.vendor ? ` · vendor ${po.vendor.name}` : ' · no vendor yet'
        }`}
        actions={
          <Link
            href="/purchase-orders"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Back to POs
          </Link>
        }
      />
      <PoEditor bootstrap={bootstrap} />
    </>
  );
}

'use server';

import { redirect } from 'next/navigation';
import { EstimateStatus, POEventKind, POLineKind, prisma } from '@bvisible/db';
import {
  createPoFromEstimateSchema,
  createPurchaseOrderSchema,
  type CreatePoFromEstimateInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { nextPoNumber } from '@/lib/po/number';

export interface CreatePoState {
  error: string | null;
}

// EstimateLineKind and POLineKind are intentionally aligned 1:1; this
// guards against future drift.
function mapEstimateKindToPoKind(kind: string): POLineKind {
  switch (kind) {
    case 'MATERIAL':
      return POLineKind.MATERIAL;
    case 'MACHINE':
      return POLineKind.MACHINE;
    case 'LABOR':
      return POLineKind.LABOR;
    case 'DESIGN':
      return POLineKind.DESIGN;
    case 'INSTALL':
      return POLineKind.INSTALL;
    case 'MISC':
      return POLineKind.MISC;
    default:
      return POLineKind.MISC;
  }
}

// Used by the "New PO" form for blank POs.
export async function createBlankPoAction(
  _prev: CreatePoState,
  formData: FormData
): Promise<CreatePoState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = createPurchaseOrderSchema.safeParse({
    estimateId: formData.get('estimateId'),
    vendorId: formData.get('vendorId'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { estimateId, vendorId, notes } = parsed.data;

  if (estimateId) {
    const ok = await prisma.estimate.findFirst({
      where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return { error: 'That estimate does not exist.' };
  }
  if (vendorId) {
    const ok = await prisma.vendor.findFirst({
      where: { id: vendorId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return { error: 'That vendor does not exist.' };
  }

  const po = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, me.tenantId);
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: me.tenantId,
        estimateId: estimateId ?? null,
        vendorId: vendorId ?? null,
        number,
        notes: notes ?? null,
        createdById: me.id,
      },
      select: { id: true, number: true },
    });
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: created.id,
        kind: POEventKind.CREATED,
        message: `PO ${created.number} created`,
        actorId: me.id,
      },
    });
    return created;
  });

  await writeAuditLog({
    action: 'po_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: po.number, estimateId, vendorId },
  });

  redirect(`/purchase-orders/${po.id}`);
}

// Estimate → PO conversion. Copies all lines, preserves quantities and
// cost. Does not mutate the source estimate. Both pages link to this.
export async function createPoFromEstimateAction(
  payload: CreatePoFromEstimateInput
): Promise<{ error: string | null; purchaseOrderId?: string }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = createPoFromEstimateSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { estimateId, vendorId } = parsed.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          kind: true,
          description: true,
          qtyMilli: true,
          unitCostCents: true,
          computedCostCents: true,
          notes: true,
        },
      },
    },
  });
  if (!estimate) {
    return { error: 'Estimate not found.' };
  }

  if (estimate.status !== EstimateStatus.APPROVED) {
    return {
      error:
        'Only accepted (Approved) estimates can convert to a purchase order. Wait for customer acceptance or set status to Approved when appropriate.',
    };
  }

  if (vendorId) {
    const ok = await prisma.vendor.findFirst({
      where: { id: vendorId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return { error: 'That vendor does not exist.' };
  }

  const subtotalCents = estimate.lines.reduce(
    (acc, l) => acc + l.computedCostCents,
    0
  );

  const po = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, me.tenantId);
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: me.tenantId,
        estimateId: estimate.id,
        vendorId: vendorId ?? null,
        number,
        subtotalCents,
        createdById: me.id,
      },
      select: { id: true, number: true },
    });
    if (estimate.lines.length > 0) {
      await tx.pOLineItem.createMany({
        data: estimate.lines.map((l, i) => ({
          tenantId: me.tenantId,
          purchaseOrderId: created.id,
          sortOrder: i,
          kind: mapEstimateKindToPoKind(l.kind),
          description: l.description,
          qtyMilli: l.qtyMilli,
          unitCostCents: l.unitCostCents,
          computedCostCents: l.computedCostCents,
          notes: l.notes,
        })),
      });
    }
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: created.id,
        kind: POEventKind.CREATED_FROM_ESTIMATE,
        message: `Converted from estimate ${estimate.number} (${estimate.lines.length} line${
          estimate.lines.length === 1 ? '' : 's'
        })`,
        metadata: {
          estimateId: estimate.id,
          estimateNumber: estimate.number,
          lineCount: estimate.lines.length,
          subtotalCents,
        },
        actorId: me.id,
      },
    });
    return created;
  });

  await writeAuditLog({
    action: 'po_created_from_estimate',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: po.number,
      estimateId: estimate.id,
      estimateNumber: estimate.number,
      lineCount: estimate.lines.length,
      subtotalCents,
    },
  });

  return { error: null, purchaseOrderId: po.id };
}

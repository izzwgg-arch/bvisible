'use server';

import { redirect } from 'next/navigation';
import { EstimateStatus, POEventKind, prisma } from '@bvisible/db';
import {
  createPoFromEstimateSchema,
  createPurchaseOrderSchema,
  type CreatePoFromEstimateInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { nextPoNumber } from '@/lib/po/number';
import { createPoFromInternalMaterials } from '@/lib/purchase-orders/create-po-from-internal-materials';
import { notifyAdminsOfDraftPo } from '@/lib/po/admin-notify';
import { autoAddPoLinesToCatalog } from '@/lib/po/catalog-autoadd';

export interface CreatePoState {
  error: string | null;
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

  // Admins place every order — tell them a draft exists. Fire-and-forget
  // so a mailer hiccup never blocks PO creation.
  void notifyAdminsOfDraftPo({
    tenantId: me.tenantId,
    purchaseOrderId: po.id,
    reason: 'created',
    actorId: me.id,
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
  const { estimateId } = parsed.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
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

  const poResult = await prisma.$transaction(async (tx) =>
    createPoFromInternalMaterials(tx, {
      tenantId: me.tenantId,
      estimateId: estimate.id,
      actorId: me.id,
    })
  );
  if (!poResult.ok) {
    return { error: poResult.error };
  }

  await writeAuditLog({
    action: 'po_created_from_estimate',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: poResult.purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: poResult.purchaseOrderNumber,
      estimateId: estimate.id,
      estimateNumber: estimate.number,
      lineCount: poResult.lineCount,
      vendorCount: poResult.vendorCount,
      subtotalCents: poResult.subtotalCents,
    },
  });

  // Catalog auto-add for any estimate line that wasn't catalog-linked,
  // then the admin "draft awaiting placement" email.
  await autoAddPoLinesToCatalog({
    tenantId: me.tenantId,
    purchaseOrderId: poResult.purchaseOrderId,
    actorId: me.id,
  });
  void notifyAdminsOfDraftPo({
    tenantId: me.tenantId,
    purchaseOrderId: poResult.purchaseOrderId,
    reason: 'created',
    actorId: me.id,
  });

  return { error: null, purchaseOrderId: poResult.purchaseOrderId };
}

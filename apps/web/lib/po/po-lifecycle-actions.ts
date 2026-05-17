'use server';

import { revalidatePath } from 'next/cache';
import { POEventKind, Role, prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { z } from 'zod';

const poIdSchema = z.object({
  purchaseOrderId: z.string().min(1),
});

const blockSchema = poIdSchema.extend({
  reason: z.string().max(500).optional(),
});

async function appendLifecycleEvent(input: {
  tenantId: string;
  purchaseOrderId: string;
  actorId: string;
  kind: POEventKind;
  message: string;
}): Promise<{ error: string | null; number?: string }> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!po) return { error: 'PO not found.' };

  await prisma.pOEvent.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: input.purchaseOrderId,
      kind: input.kind,
      message: input.message,
      actorId: input.actorId,
    },
  });

  return { error: null, number: po.number };
}

export async function markPoVendorAcknowledgedAction(
  purchaseOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const parsed = poIdSchema.safeParse({ purchaseOrderId });
  if (!parsed.success) return { ok: false, error: 'Invalid PO.' };

  const result = await appendLifecycleEvent({
    tenantId: me.tenantId,
    purchaseOrderId,
    actorId: me.id,
    kind: POEventKind.OPERATOR_VENDOR_ACKNOWLEDGED,
    message: 'Operator marked vendor acknowledged.',
  });
  if (result.error) return { ok: false, error: result.error };

  await writeAuditLog({
    action: 'po_lifecycle_vendor_acknowledged',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: result.number },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function markPoBlockedAction(
  input: { purchaseOrderId: string; reason?: string },
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };

  const msg = parsed.data.reason?.trim()
    ? `Operator marked blocked: ${parsed.data.reason.trim()}`
    : 'Operator marked blocked / backordered.';

  const result = await appendLifecycleEvent({
    tenantId: me.tenantId,
    purchaseOrderId: parsed.data.purchaseOrderId,
    actorId: me.id,
    kind: POEventKind.OPERATOR_BLOCKED,
    message: msg,
  });
  if (result.error) return { ok: false, error: result.error };

  await writeAuditLog({
    action: 'po_lifecycle_blocked',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: parsed.data.purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: result.number },
  });

  revalidatePath(`/purchase-orders/${parsed.data.purchaseOrderId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function clearPoBlockedAction(
  purchaseOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const parsed = poIdSchema.safeParse({ purchaseOrderId });
  if (!parsed.success) return { ok: false, error: 'Invalid PO.' };

  const result = await appendLifecycleEvent({
    tenantId: me.tenantId,
    purchaseOrderId,
    actorId: me.id,
    kind: POEventKind.OPERATOR_BLOCKED_CLEARED,
    message: 'Operator cleared blocked / backordered state.',
  });
  if (result.error) return { ok: false, error: result.error };

  await writeAuditLog({
    action: 'po_lifecycle_blocked_cleared',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: result.number },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function markPoReceivedCompleteAction(
  purchaseOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const parsed = poIdSchema.safeParse({ purchaseOrderId });
  if (!parsed.success) return { ok: false, error: 'Invalid PO.' };

  const result = await appendLifecycleEvent({
    tenantId: me.tenantId,
    purchaseOrderId,
    actorId: me.id,
    kind: POEventKind.OPERATOR_RECEIVED_COMPLETE,
    message:
      'Operator marked receipt complete (attestation only — does not change PO line pricing).',
  });
  if (result.error) return { ok: false, error: result.error };

  await writeAuditLog({
    action: 'po_lifecycle_received_complete',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: result.number },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

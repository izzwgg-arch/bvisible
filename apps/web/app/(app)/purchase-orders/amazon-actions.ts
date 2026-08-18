'use server';

// Server actions for the Amazon Business integration.
//
// Both are tenant-scoped and available to any authenticated user, matching
// how the rest of the ordering workflow behaves — operational actions are not
// restricted to whoever happened to create the record.

import { revalidatePath } from 'next/cache';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/auth/audit';
import { startPunchoutSession } from '@/lib/amazon/punchout-service';
import { placeAmazonOrder } from '@/lib/amazon/order-service';

export interface StartShoppingState {
  ok: boolean;
  /// Amazon's hosted shopping URL. The client navigates the browser here.
  startPageUrl?: string;
  error?: string;
}

/// Open a PunchOut shopping session. Returns the URL rather than redirecting
/// so the client can send the top-level window to Amazon itself.
export async function startAmazonShoppingAction(): Promise<StartShoppingState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const result = await startPunchoutSession({
    tenantId: me.tenantId,
    userId: me.id,
    userEmail: me.email,
    userName: me.name || me.email,
  });

  await writeAuditLog({
    action: result.ok ? 'amazon_punchout_started' : 'amazon_punchout_start_failed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'amazon_punchout',
    targetId: result.ok ? result.sessionId : 'none',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    // No cXML, no credential, no start URL (it is a session-bearing link).
    metadata: { ok: result.ok },
  });

  return result.ok
    ? { ok: true, startPageUrl: result.startPageUrl }
    : { ok: false, error: result.error };
}

export interface PlaceOrderState {
  ok: boolean;
  message: string | null;
}

/// Place a reviewed Amazon draft as a real order.
///
/// Deliberately takes the PO id from a form field and re-reads everything
/// server-side: nothing about what gets ordered, or at what price, is taken
/// from the client.
export async function placeAmazonOrderAction(
  _prev: PlaceOrderState,
  formData: FormData
): Promise<PlaceOrderState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const purchaseOrderId = String(formData.get('purchaseOrderId') ?? '').trim();
  if (!purchaseOrderId) return { ok: false, message: 'Invalid request.' };

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!po) return { ok: false, message: 'Order not found.' };

  const result = await placeAmazonOrder({
    tenantId: me.tenantId,
    purchaseOrderId: po.id,
    actorId: me.id,
  });

  await writeAuditLog({
    action: result.ok ? 'amazon_order_placed' : 'amazon_order_failed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: po.number, ok: result.ok, category: result.failureCategory },
  });

  revalidatePath(`/purchase-orders/${po.id}`);
  revalidatePath('/purchase-orders');

  return { ok: result.ok, message: result.message };
}

// Server-side data for the "Place order with Amazon" panel on a PO.
//
// Everything the panel needs is decided here, on the server: whether the
// integration is configured, whether the lines are actually orderable, and
// what the latest attempt did. The client component only renders it — it
// never learns the identity, the secret, or the endpoints.

import { AmazonOrderStatus, prisma } from '@bvisible/db';
import { amazonCxmlConfig, amazonOrderingEnabled, amazonShipTo } from './config';
import { latestAmazonOrder } from './order-service';
import { orderFailureMessage } from './order-request';

export interface AmazonOrderPanelData {
  purchaseOrderId: string;
  /// Already placed — the panel shows a receipt instead of a button.
  placed: boolean;
  placedAt: string | null;
  attempt: number;
  /// Safe, user-facing failure text for the newest failed attempt.
  failureMessage: string | null;
  /// Why the button is unavailable, or null when it can be pressed.
  blockedReason: string | null;
  itemCount: number;
  totalCents: number;
}

/// Null when this PO has nothing to do with Amazon, so the panel disappears
/// entirely rather than rendering an empty card on every purchase order.
export async function loadAmazonOrderPanel(input: {
  tenantId: string;
  purchaseOrderId: string;
  vendorName: string | null | undefined;
  lines: ReadonlyArray<{ vendorSku: string | null; qtyMilli: number; unitCostCents: number }>;
}): Promise<AmazonOrderPanelData | null> {
  if (!/amazon/i.test(input.vendorName ?? '')) return null;

  const config = amazonCxmlConfig();
  const latest = await latestAmazonOrder(input.tenantId, input.purchaseOrderId);
  const placed = latest?.status === AmazonOrderStatus.PLACED;

  // A PO that was already ordered still shows the panel — that receipt is the
  // answer to "did this actually go through?".
  if (!config && !placed) return null;

  const orderable = input.lines.filter((l) => (l.vendorSku ?? '').trim().length > 0);
  const totalCents = input.lines.reduce(
    (sum, l) => sum + l.unitCostCents * Math.max(1, Math.ceil(l.qtyMilli / 1000)),
    0
  );

  let blockedReason: string | null = null;
  if (!placed) {
    if (!amazonOrderingEnabled(config)) {
      blockedReason = 'Amazon ordering is not set up yet.';
    } else if (!amazonShipTo()) {
      blockedReason = 'No shipping address is configured for Amazon orders.';
    } else if (input.lines.length === 0 || orderable.length !== input.lines.length) {
      // Partial ordering is refused rather than silently dropping lines: the
      // buyer approved the whole order, not a subset of it.
      blockedReason =
        'Every line needs an Amazon product number (ASIN) before this order can be placed.';
    }
  }

  return {
    purchaseOrderId: input.purchaseOrderId,
    placed,
    placedAt: latest?.placedAt ? latest.placedAt.toISOString() : null,
    attempt: latest?.attempt ?? 0,
    failureMessage:
      latest && latest.status === AmazonOrderStatus.FAILED
        ? orderFailureMessage(latest.failureCategory)
        : null,
    blockedReason,
    itemCount: input.lines.length,
    totalCents,
  };
}

/// Convenience used by the PO page, which has already loaded the PO.
export async function amazonPanelForPo(tenantId: string, purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId, deletedAt: null },
    select: {
      id: true,
      vendor: { select: { name: true } },
      lines: { select: { vendorSku: true, qtyMilli: true, unitCostCents: true } },
    },
  });
  if (!po) return null;
  return loadAmazonOrderPanel({
    tenantId,
    purchaseOrderId: po.id,
    vendorName: po.vendor?.name,
    lines: po.lines,
  });
}

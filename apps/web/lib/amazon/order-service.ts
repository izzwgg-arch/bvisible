// Placing a purchase order on Amazon Business.
//
// The one code path in B Visible that spends money, so the guarantees are
// spelled out rather than implied:
//
//  1. NEVER automatic. Only a signed-in person clicking "Place order with
//     Amazon" reaches this, and only for a PO they have looked at.
//  2. AT MOST ONE successful order per PO. A PLACED submission row is a hard
//     stop — retrying after a success would make Amazon ship twice. Retrying
//     after a FAILURE is expected and safe.
//  3. Nothing is invented. No ship-to, no orderable lines, or no configuration
//     means a refusal with a plain reason, never a guess.
//  4. Order placement is a state SEPARATE from the purchase order. A rejected
//     order leaves the PO, its lines, and its links exactly as they were.

import { randomUUID } from 'node:crypto';
import {
  AmazonOrderStatus,
  POEventKind,
  POStatus,
  prisma,
} from '@bvisible/db';
import { amazonCxmlConfig, amazonShipTo, redactCxml } from './config';
import { buildPayloadId } from './cxml';
import {
  buildOrderRequest,
  orderFailureMessage,
  parseOrderResponse,
  type OrderFailureCategory,
  type OrderRequestLine,
} from './order-request';

const REQUEST_TIMEOUT_MS = 30_000;

export interface PlaceOrderResult {
  ok: boolean;
  /// Safe, user-facing text. Never a provider message or credential.
  message: string;
  failureCategory: OrderFailureCategory | null;
}

/// Current Amazon-ordering state for a PO: the newest attempt.
export async function latestAmazonOrder(tenantId: string, purchaseOrderId: string) {
  return prisma.amazonOrderSubmission.findFirst({
    where: { tenantId, purchaseOrderId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      attempt: true,
      placedAt: true,
      failureCategory: true,
      responseText: true,
      totalCents: true,
    },
  });
}

export async function placeAmazonOrder(input: {
  tenantId: string;
  purchaseOrderId: string;
  actorId: string;
}): Promise<PlaceOrderResult> {
  const fail = async (
    category: OrderFailureCategory,
    detail?: { code?: number; text?: string; totalCents?: number; attempt?: number }
  ): Promise<PlaceOrderResult> => {
    // 'already_ordered' is a guard, not an attempt — recording it would
    // pollute the retry history with rows that never touched Amazon.
    if (category !== 'already_ordered') {
      await prisma.amazonOrderSubmission.create({
        data: {
          tenantId: input.tenantId,
          purchaseOrderId: input.purchaseOrderId,
          payloadId: `local-${randomUUID()}`,
          status: AmazonOrderStatus.FAILED,
          attempt: detail?.attempt ?? 1,
          responseCode: detail?.code ?? null,
          responseText: detail?.text ? detail.text.slice(0, 500) : null,
          failureCategory: category,
          totalCents: detail?.totalCents ?? 0,
          createdById: input.actorId,
        },
      });
    }
    return { ok: false, message: orderFailureMessage(category), failureCategory: category };
  };

  const config = amazonCxmlConfig();
  if (!config || !config.orderRequestUrl) return fail('not_configured');

  const shipTo = amazonShipTo();
  if (!shipTo) return fail('no_ship_to');

  // Hard stop on a PO that already went out.
  const existing = await prisma.amazonOrderSubmission.findFirst({
    where: {
      tenantId: input.tenantId,
      purchaseOrderId: input.purchaseOrderId,
      status: AmazonOrderStatus.PLACED,
    },
    select: { id: true },
  });
  if (existing) return fail('already_ordered');

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, tenantId: input.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      createdAt: true,
      status: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          description: true,
          vendorSku: true,
          qtyMilli: true,
          unit: true,
          unitCostCents: true,
        },
      },
    },
  });
  if (!po) return fail('send_failed');

  // Amazon orders by ASIN. A line without one cannot be bought, and silently
  // dropping it would ship a partial order the buyer never approved — so the
  // whole submission is refused instead.
  const unorderable = po.lines.filter((l) => !(l.vendorSku ?? '').trim());
  if (unorderable.length > 0 || po.lines.length === 0) return fail('no_orderable_lines');

  const lines: OrderRequestLine[] = po.lines.map((l) => ({
    supplierPartId: (l.vendorSku ?? '').trim(),
    description: l.description,
    // Amazon sells whole units; never round a needed amount down.
    quantity: Math.max(1, Math.ceil(l.qtyMilli / 1000)),
    unitCostCents: l.unitCostCents,
    unitOfMeasure: 'EA',
  }));
  const totalCents = lines.reduce((sum, l) => sum + l.unitCostCents * l.quantity, 0);

  const priorCount = await prisma.amazonOrderSubmission.count({
    where: { tenantId: input.tenantId, purchaseOrderId: po.id },
  });
  const attempt = priorCount + 1;

  const now = new Date();
  const nonce = randomUUID();
  const payloadId = buildPayloadId(now, nonce);
  const xml = buildOrderRequest({
    identity: config.identity,
    sharedSecret: config.sharedSecret,
    credentialDomain: config.credentialDomain,
    toIdentity: config.toIdentity,
    poNumber: po.number,
    orderDate: po.createdAt,
    lines,
    shipTo,
    now,
    nonce,
  });

  let responseXml: string;
  try {
    const res = await fetch(config.orderRequestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    responseXml = await res.text();
  } catch {
    // The raw error can echo the request body, which carries the shared
    // secret — so nothing from it is logged or returned.
    console.error(`[amazon-order] OrderRequest network failure for ${po.number}`);
    return fail('send_failed', { totalCents, attempt });
  }

  const parsed = parseOrderResponse(responseXml);
  if (!parsed.ok) {
    console.error(
      `[amazon-order] ${po.number} rejected: ${parsed.statusCode}`,
      redactCxml(responseXml).slice(0, 500)
    );
    return fail('rejected', {
      code: parsed.statusCode,
      text: parsed.statusText,
      totalCents,
      attempt,
    });
  }

  const placedAt = new Date();
  await prisma.amazonOrderSubmission.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: po.id,
      payloadId,
      status: AmazonOrderStatus.PLACED,
      attempt,
      responseCode: parsed.statusCode,
      responseText: parsed.statusText.slice(0, 500),
      totalCents,
      placedAt,
      createdById: input.actorId,
    },
  });

  // ORDERED, not SENT: this PO really was placed with the vendor, which is
  // exactly what the existing status means. Receiving picks up from here.
  await prisma.$transaction(async (tx) => {
    if (po.status === POStatus.DRAFT || po.status === POStatus.SENT) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: POStatus.ORDERED } });
    }
    await tx.pOEvent.create({
      data: {
        tenantId: input.tenantId,
        purchaseOrderId: po.id,
        kind: POEventKind.AMAZON_ORDER_PLACED,
        message: `Order placed with Amazon Business (${lines.length} item${
          lines.length === 1 ? '' : 's'
        })`,
        actorId: input.actorId,
      },
    });
  });

  return { ok: true, message: 'Order placed with Amazon.', failureCategory: null };
}

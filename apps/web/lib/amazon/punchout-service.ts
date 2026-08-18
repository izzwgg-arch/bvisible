// Server-side PunchOut orchestration: start a session, and turn the cart
// Amazon posts back into a real purchase order.
//
// SECURITY MODEL — the important part of this file.
//
// Amazon returns the finished cart as a *browser form POST* from Amazon's
// domain to ours. That is a cross-site POST, so our session cookie (SameSite)
// is not sent with it: the request arrives unauthenticated. The BuyerCookie is
// therefore the only thing establishing which tenant and user the cart belongs
// to, which makes it a bearer credential:
//
//   * 256 bits from a CSPRNG, so it cannot be guessed;
//   * single-use — accepting a cart flips the row to RETURNED, and a second
//     POST with the same cookie is refused, so a captured request cannot be
//     replayed to inject lines into another order;
//   * time-boxed — a session older than the window is treated as abandoned.
//
// Nothing is purchased here. The cart becomes a DRAFT purchase order and
// placing the real order is a separate, explicitly approved step.

import { randomBytes, randomUUID } from 'node:crypto';
import {
  AmazonPunchoutStatus,
  POEventKind,
  POLineKind,
  POStatus,
  prisma,
} from '@bvisible/db';
import { nextPoNumber } from '@/lib/po/number';
import { resolveAppOrigin } from '@/lib/po/admin-notify';
import { amazonCxmlConfig, redactCxml } from './config';
import {
  buildPunchOutSetupRequest,
  parsePunchOutOrderMessage,
  parsePunchOutSetupResponse,
  type PunchoutCart,
} from './punchout';

/// How long an unused shopping session stays valid. Long enough for a real
/// shopping trip, short enough that an abandoned cookie stops working.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/// Amazon is a third party on the network path; without a bound the request
/// can hang and hold a server action open indefinitely.
const REQUEST_TIMEOUT_MS = 20_000;

export type StartPunchoutResult =
  | { ok: true; startPageUrl: string; sessionId: string }
  | { ok: false; error: string };

export async function startPunchoutSession(input: {
  tenantId: string;
  userId: string;
  userEmail: string;
  userName: string;
}): Promise<StartPunchoutResult> {
  const config = amazonCxmlConfig();
  if (!config) {
    return { ok: false, error: 'Amazon Business shopping is not set up yet.' };
  }

  const origin = await resolveAppOrigin();
  const buyerCookie = randomBytes(32).toString('base64url');
  const returnUrl = `${origin}/api/amazon/punchout/return`;

  const xml = buildPunchOutSetupRequest({
    identity: config.identity,
    sharedSecret: config.sharedSecret,
    credentialDomain: config.credentialDomain,
    toIdentity: config.toIdentity,
    buyerCookie,
    returnUrl,
    supplierSetupUrl: config.punchoutUrl,
    userEmail: input.userEmail,
    userName: input.userName,
    now: new Date(),
    nonce: randomUUID(),
  });

  // The row is created BEFORE the request goes out. If Amazon replies while
  // we are still writing, the return POST must find a session to match.
  const session = await prisma.amazonPunchoutSession.create({
    data: {
      tenantId: input.tenantId,
      buyerCookie,
      status: AmazonPunchoutStatus.STARTED,
      createdById: input.userId,
    },
    select: { id: true },
  });

  let responseXml: string;
  try {
    const res = await fetch(config.punchoutUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    responseXml = await res.text();
  } catch {
    // Never surface the raw network error: it can contain the request body,
    // and the request body contains the shared secret.
    console.error('[amazon-punchout] setup request failed (network)');
    return { ok: false, error: 'Could not reach Amazon Business. Try again in a moment.' };
  }

  const parsed = parsePunchOutSetupResponse(responseXml);
  if (!parsed.ok) {
    console.error(
      `[amazon-punchout] setup rejected: ${parsed.statusCode} ${parsed.statusText}`,
      redactCxml(responseXml).slice(0, 500)
    );
    return {
      ok: false,
      // Amazon's own text is a protocol message, not a credential, and it is
      // what tells an admin the identity or secret is wrong.
      error: parsed.statusText
        ? `Amazon rejected the connection: ${parsed.statusText}`
        : 'Amazon rejected the connection.',
    };
  }

  await prisma.amazonPunchoutSession.update({
    where: { id: session.id },
    data: { startPageUrl: parsed.startPageUrl },
  });

  return { ok: true, startPageUrl: parsed.startPageUrl, sessionId: session.id };
}

export type ReturnCartResult =
  | { ok: true; purchaseOrderId: string; poNumber: string; itemCount: number }
  | { ok: false; reason: 'unknown_cookie' | 'already_used' | 'expired' | 'empty_cart' };

/// Accept a returned cart and turn it into a DRAFT purchase order.
///
/// Called from an UNAUTHENTICATED endpoint, so every check that would normally
/// be done by the session layer is done here instead.
export async function acceptReturnedCart(cxml: string): Promise<ReturnCartResult> {
  let cart: PunchoutCart;
  try {
    cart = parsePunchOutOrderMessage(cxml);
  } catch {
    return { ok: false, reason: 'unknown_cookie' };
  }
  if (!cart.buyerCookie) return { ok: false, reason: 'unknown_cookie' };

  const session = await prisma.amazonPunchoutSession.findUnique({
    where: { buyerCookie: cart.buyerCookie },
    select: { id: true, tenantId: true, createdById: true, status: true, createdAt: true },
  });
  if (!session) return { ok: false, reason: 'unknown_cookie' };
  // Single-use. A replayed POST lands here and stops.
  if (session.status !== AmazonPunchoutStatus.STARTED) {
    return { ok: false, reason: 'already_used' };
  }
  if (Date.now() - session.createdAt.getTime() > SESSION_TTL_MS) {
    await prisma.amazonPunchoutSession.update({
      where: { id: session.id },
      data: { status: AmazonPunchoutStatus.EXPIRED },
    });
    return { ok: false, reason: 'expired' };
  }
  if (cart.items.length === 0) {
    // An empty cart means the employee backed out. Close the session so the
    // cookie cannot be reused, but create nothing.
    await prisma.amazonPunchoutSession.update({
      where: { id: session.id },
      data: { status: AmazonPunchoutStatus.EXPIRED },
    });
    return { ok: false, reason: 'empty_cart' };
  }

  // Amazon is a real vendor row like any other, so the resulting PO flows
  // through the existing detail pages, receiving, and reporting unchanged.
  const vendor = await prisma.vendor.upsert({
    where: { tenantId_name: { tenantId: session.tenantId, name: 'Amazon' } },
    update: { deletedAt: null },
    create: { tenantId: session.tenantId, name: 'Amazon' },
    select: { id: true, name: true },
  });

  const subtotalCents = cart.subtotalCents;

  const po = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, session.tenantId);
    const row = await tx.purchaseOrder.create({
      data: {
        tenantId: session.tenantId,
        vendorId: vendor.id,
        number,
        // DRAFT on purpose: the cart has been priced by Amazon but not
        // ordered. A person still has to approve and place it.
        status: POStatus.DRAFT,
        subtotalCents,
        createdById: session.createdById,
      },
      select: { id: true, number: true },
    });
    await tx.pOLineItem.createMany({
      data: cart.items.map((item, i) => ({
        tenantId: session.tenantId,
        purchaseOrderId: row.id,
        sortOrder: i,
        kind: POLineKind.MATERIAL,
        description: item.description || item.supplierPartId,
        // PunchOut carts are whole units.
        qtyMilli: item.quantity * 1000,
        unitCostCents: item.unitCostCents,
        computedCostCents: item.unitCostCents * item.quantity,
        vendorId: vendor.id,
        // The ASIN, straight from Amazon rather than transcribed from a Sheet.
        vendorSku: item.supplierPartId || null,
        productUrl: item.productUrl || null,
      })),
    });
    await tx.pOEvent.create({
      data: {
        tenantId: session.tenantId,
        purchaseOrderId: row.id,
        kind: POEventKind.AMAZON_PUNCHOUT_RETURNED,
        message: `Cart returned from Amazon Business — ${cart.items.length} item${
          cart.items.length === 1 ? '' : 's'
        }. Nothing has been ordered yet.`,
        actorId: session.createdById,
      },
    });
    return row;
  });

  await prisma.amazonPunchoutSession.update({
    where: { id: session.id },
    data: {
      status: AmazonPunchoutStatus.RETURNED,
      purchaseOrderId: po.id,
      returnedAt: new Date(),
      itemCount: cart.items.length,
    },
  });

  return { ok: true, purchaseOrderId: po.id, poNumber: po.number, itemCount: cart.items.length };
}

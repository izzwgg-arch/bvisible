'use server';

// Shop-order flow: one search-driven materials request, auto-split into
// one PurchaseOrder per vendor (preferred vendor preselected when the
// catalog has one, otherwise the cheapest; changeable per line). Creates
// completely standard PO rows — detail pages, QBO numbers, receipt OCR,
// reconciliation, and lifecycle queues all apply unchanged.
//
// Two finishing modes:
//   'send'  — regular vendors are emailed their PO immediately (status →
//             SENT); retail vendors (Amazon / Home Depot / …) are never
//             emailed — the office reminder email goes out with cart
//             links and the PO is marked SENT so receiving can start.
//   'draft' — POs stay DRAFT, nothing is emailed, no cart is prepared.
//
// Every submission carries a client-generated requestId; replays
// (double-click, refresh, retry) return the stored result instead of
// creating duplicate POs, emails, or cart additions.

import { z } from 'zod';
import { POEventKind, POLineKind, POStatus, Prisma, VendorCostSourceMode, prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { nextPoNumber } from '@/lib/po/number';
import { sendMail } from '@/lib/mailer';
import { formatMoney } from '@bvisible/pricing';
import { revalidatePath } from 'next/cache';
import {
  buildRetailCartUrl,
  isRetailVendor,
  normalizeExternalUrl,
} from '@/lib/po/retail-cart';
import { vendorRecipientLine } from '@/lib/po/vendor-recipients';
import { notifyAdminsOfDraftPo } from '@/lib/po/admin-notify';
import { autoAddPoLinesToCatalog } from '@/lib/po/catalog-autoadd';

const shopOrderLineSchema = z.object({
  name: z.string().trim().min(1).max(400),
  detail: z.string().trim().max(400).default(''),
  vendor: z.string().trim().min(1).max(200),
  qty: z.number().min(0.001).max(100000),
  unitPriceCents: z.number().int().min(0).max(1_000_000_000),
  catalogId: z.string().trim().max(200).default(''),
  vendorSku: z.string().trim().max(200).default(''),
  productUrl: z.string().trim().max(1000).default(''),
  /// How this line's vendor was chosen — preserved on the PO line so
  /// drafts restore manual overrides and reporting can tell them apart.
  vendorMode: z.enum(['preferred', 'cheapest', 'manual']).default('cheapest'),
});

export interface RetailCartItem {
  name: string;
  qty: number;
  url: string;
  sku: string;
  unitPriceCents: number;
}

const shopOrderSchema = z.object({
  mode: z.enum(['send', 'draft']).default('draft'),
  requestId: z.string().trim().min(8).max(80),
  /// Per-vendor PO note, keyed by vendor name.
  vendorNotes: z.record(z.string(), z.string().trim().max(2000)).default({}),
  lines: z.array(shopOrderLineSchema).min(1, 'Add at least one material.').max(200),
});

const VENDOR_MODE_MAP: Record<string, VendorCostSourceMode> = {
  preferred: VendorCostSourceMode.PREFERRED,
  cheapest: VendorCostSourceMode.CHEAPEST,
  manual: VendorCostSourceMode.MANUAL,
};

export interface ShopOrderResult {
  error: string | null;
  /// 'send' or 'draft' — what the finished submission actually did.
  mode?: 'send' | 'draft';
  created?: Array<{
    id: string;
    number: string;
    vendor: string;
    totalCents: number;
    emailStatus: 'SENT' | 'NOT_SENT' | 'NO_VENDOR_EMAIL' | 'SEND_FAILED';
    /// Human-readable send outcome ("Sent to orders@…", "Email failed — …").
    emailDetail?: string;
    /// Present for Amazon / Home Depot / Walmart / Lowe's POs: cart data
    /// for office review. Nothing is ordered automatically.
    retail?: {
      vendor: string;
      /// Amazon add-to-cart URL when every SKU is an ASIN; otherwise null.
      cartUrl: string | null;
      items: RetailCartItem[];
      /// True when the office reminder email went out for this order.
      officeReminderSent?: boolean;
    };
  }>;
}

export async function createShopOrderAction(
  _prev: ShopOrderResult,
  formData: FormData
): Promise<ShopOrderResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return { error: 'Invalid request payload.' };
  }
  const parsed = shopOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;

  // Idempotency: claim the requestId first. A replay (double-click,
  // refresh, network retry) lands on the unique key and gets the stored
  // result back — no duplicate POs, emails, or cart additions.
  try {
    await prisma.shopOrderSubmission.create({
      data: {
        tenantId: me.tenantId,
        requestId: data.requestId,
        createdById: me.id,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.shopOrderSubmission.findUnique({
        where: { tenantId_requestId: { tenantId: me.tenantId, requestId: data.requestId } },
        select: { resultJson: true },
      });
      if (existing?.resultJson) {
        return existing.resultJson as unknown as ShopOrderResult;
      }
      return {
        error:
          'This order is already being created. Check Past orders before submitting again.',
      };
    }
    throw err;
  }

  // Group lines by vendor — one PO per vendor.
  const byVendor = new Map<string, typeof data.lines>();
  for (const line of data.lines) {
    const key = line.vendor;
    const bucket = byVendor.get(key) ?? [];
    bucket.push(line);
    byVendor.set(key, bucket);
  }

  const created: NonNullable<ShopOrderResult['created']> = [];

  for (const [vendorName, lines] of byVendor) {
    // Vendor rows are synced from the Sheet's Vendor Directory; create a
    // bare row for custom vendors typed in the flow.
    const vendor = await prisma.vendor.upsert({
      where: { tenantId_name: { tenantId: me.tenantId, name: vendorName } },
      update: { deletedAt: null },
      create: { tenantId: me.tenantId, name: vendorName },
      select: { id: true, name: true, email: true, emails: true },
    });

    const totalCents = lines.reduce(
      (sum, l) => sum + Math.round(l.qty * l.unitPriceCents),
      0
    );
    const vendorNote = (data.vendorNotes[vendorName] ?? '').trim();

    const po = await prisma.$transaction(async (tx) => {
      const number = await nextPoNumber(tx, me.tenantId);
      const row = await tx.purchaseOrder.create({
        data: {
          tenantId: me.tenantId,
          vendorId: vendor.id,
          number,
          notes: vendorNote || null,
          subtotalCents: totalCents,
          createdById: me.id,
        },
        select: { id: true, number: true },
      });
      await tx.pOLineItem.createMany({
        data: lines.map((l, i) => ({
          tenantId: me.tenantId,
          purchaseOrderId: row.id,
          sortOrder: i,
          kind: POLineKind.MATERIAL,
          description: l.detail ? `${l.name} — ${l.detail}` : l.name,
          qtyMilli: Math.round(l.qty * 1000),
          unitCostCents: l.unitPriceCents,
          computedCostCents: Math.round(l.qty * l.unitPriceCents),
          vendorId: vendor.id,
          selectedVendorMode: VENDOR_MODE_MAP[l.vendorMode] ?? VendorCostSourceMode.CHEAPEST,
          vendorSku: l.vendorSku || null,
          notes: l.catalogId ? `Sheet catalog: ${l.catalogId}` : null,
        })),
      });
      await tx.pOEvent.create({
        data: {
          tenantId: me.tenantId,
          purchaseOrderId: row.id,
          kind: POEventKind.CREATED,
          message: `PO ${row.number} created from shop order (${lines.length} line${lines.length === 1 ? '' : 's'}, ${vendor.name})`,
          actorId: me.id,
        },
      });
      return row;
    });

    await writeAuditLog({
      action: 'po_created',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'purchase_order',
      targetId: po.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        number: po.number,
        vendorId: vendor.id,
        via: 'shop_order',
        mode: data.mode,
        lineCount: lines.length,
        totalCents,
      },
    });

    // New items add themselves to the catalog + Sheet. Non-blocking for
    // the order itself; failures never abort the submission.
    await autoAddPoLinesToCatalog({
      tenantId: me.tenantId,
      purchaseOrderId: po.id,
      actorId: me.id,
    });

    const retailVendor = isRetailVendor(vendorName);
    let retail: NonNullable<ShopOrderResult['created']>[number]['retail'];
    if (retailVendor) {
      const items: RetailCartItem[] = lines.map((l) => ({
        name: l.detail ? `${l.name} — ${l.detail}` : l.name,
        // Online carts take whole units — never round a needed amount down.
        qty: Math.max(1, Math.ceil(l.qty)),
        // Normalized so scheme-less Sheet URLs never render as broken
        // app-relative links (the blank-404 bug).
        url: normalizeExternalUrl(l.productUrl),
        sku: l.vendorSku,
        unitPriceCents: l.unitPriceCents,
      }));
      // Amazon: true multi-item cart when every line resolves an ASIN
      // (from the SKU column or the product URL). Other stores: first
      // product page. Null only when no line has any usable link.
      const cartUrl = buildRetailCartUrl(vendor.name, items);
      retail = { vendor: vendor.name, cartUrl, items };
    }

    let emailStatus: NonNullable<ShopOrderResult['created']>[number]['emailStatus'] =
      vendor.email || vendor.emails[0] ? 'NOT_SENT' : 'NO_VENDOR_EMAIL';
    let emailDetail: string | undefined;

    if (data.mode === 'send') {
      if (retailVendor) {
        // Amazon workflow: the office reminder email (with cart links)
        // goes out now — this is the only path that sends it — then the
        // PO moves to SENT so the shop can start receiving against it.
        // Nothing is emailed to the retail vendor itself, ever.
        const notified = await notifyAdminsOfDraftPo({
          tenantId: me.tenantId,
          purchaseOrderId: po.id,
          reason: 'created',
          actorId: me.id,
        });
        if (retail) retail.officeReminderSent = notified.ok;
        await markShopOrderPoSent(
          me.tenantId,
          me.id,
          po.id,
          `Order placed via ${vendor.name} cart workflow — office reminder ${notified.ok ? 'emailed' : 'could not be emailed'}`
        );
        emailStatus = 'NOT_SENT';
        emailDetail = notified.ok
          ? 'Office reminder emailed — the office places the order on the store site.'
          : 'Office reminder email failed — the office can still order from the cart link.';
      } else {
        const sent = await emailPoToVendor(me.tenantId, me.id, po.id);
        emailStatus = sent.status;
        emailDetail = sent.message;
      }
    }

    created.push({
      id: po.id,
      number: po.number,
      vendor: vendor.name,
      totalCents,
      emailStatus,
      emailDetail,
      retail,
    });
  }

  const result: ShopOrderResult = { error: null, mode: data.mode, created };

  // Store the finished result on the idempotency row so replays return it.
  await prisma.shopOrderSubmission
    .update({
      where: { tenantId_requestId: { tenantId: me.tenantId, requestId: data.requestId } },
      data: { resultJson: result as unknown as Prisma.InputJsonValue },
    })
    .catch(() => undefined);

  revalidatePath('/purchase-orders');
  return result;
}

/// Marks a shop-order PO SENT with a timeline event. Used for retail
/// vendors (cart workflow) where no vendor email exists.
async function markShopOrderPoSent(
  tenantId: string,
  actorId: string,
  poId: string,
  message: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.purchaseOrder.findFirst({
      where: { id: poId, tenantId, deletedAt: null },
      select: { status: true },
    });
    if (!row || row.status !== POStatus.DRAFT) return;
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: POStatus.SENT } });
    await tx.pOEvent.create({
      data: {
        tenantId,
        purchaseOrderId: poId,
        kind: POEventKind.STATUS_CHANGED,
        message,
        actorId,
      },
    });
  });
}

/// Emails a shop-order PO to its vendor and moves it to SENT. The PO is
/// preserved on failure — the operator retries just the email.
async function emailPoToVendor(
  tenantId: string,
  actorId: string,
  poId: string
): Promise<{ status: 'SENT' | 'NO_VENDOR_EMAIL' | 'SEND_FAILED'; message: string }> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      notes: true,
      subtotalCents: true,
      status: true,
      vendor: { select: { id: true, name: true, email: true, emails: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: { description: true, qtyMilli: true, unitCostCents: true, computedCostCents: true },
      },
    },
  });
  if (!po) return { status: 'SEND_FAILED', message: 'Purchase order not found.' };

  // Send to EVERY email on file for the vendor, not just the first.
  const to = po.vendor ? vendorRecipientLine(po.vendor) || null : null;
  if (!to) {
    return {
      status: 'NO_VENDOR_EMAIL',
      message:
        'No vendor email on file — add one in the Sheet Vendor Directory or on the vendor record.',
    };
  }

  const rowsHtml = po.lines
    .map((l) => {
      const qty = l.qtyMilli / 1000;
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(l.description)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${qty}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatMoney(l.unitCostCents)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatMoney(l.computedCostCents)}</td></tr>`;
    })
    .join('');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px">
      <h2 style="margin:0 0 4px">Purchase order ${po.number}</h2>
      <p style="margin:0 0 16px;color:#555">B Visible Signs &amp; Printing</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr>
          <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #333">Item</th>
          <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #333">Qty</th>
          <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #333">Rate</th>
          <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #333">Amount</th>
        </tr>
        ${rowsHtml}
        <tr><td colspan="3" style="padding:8px 10px;text-align:right;font-weight:bold">Total</td><td style="padding:8px 10px;text-align:right;font-weight:bold">${formatMoney(po.subtotalCents)}</td></tr>
      </table>
      ${po.notes ? `<p style="margin-top:14px;font-size:13px;color:#555"><b>Notes:</b> ${escapeHtml(po.notes)}</p>` : ''}
      <p style="margin-top:18px;font-size:13px;color:#555">Please confirm receipt of this order. Reference PO ${po.number} on all paperwork.</p>
    </div>`;
  const text = [
    `Purchase order ${po.number} — B Visible Signs & Printing`,
    '',
    ...po.lines.map(
      (l) =>
        `${l.description}  x${l.qtyMilli / 1000}  @ ${formatMoney(l.unitCostCents)}  = ${formatMoney(l.computedCostCents)}`
    ),
    '',
    `Total: ${formatMoney(po.subtotalCents)}`,
    po.notes ? `Notes: ${po.notes}` : '',
    `Please confirm receipt. Reference PO ${po.number} on all paperwork.`,
  ]
    .filter(Boolean)
    .join('\n');

  const sent = await sendMail({
    to,
    subject: `Purchase order ${po.number} — B Visible Signs & Printing`,
    html,
    text,
  });

  await prisma.pOEvent.create({
    data: {
      tenantId,
      purchaseOrderId: po.id,
      kind: sent.ok ? POEventKind.VENDOR_PO_SENT : POEventKind.VENDOR_PO_SEND_FAILED,
      message: sent.ok
        ? `PO emailed to ${to}`
        : `PO email to ${to} failed — retry or send manually`,
      actorId,
    },
  });
  if (!sent.ok) {
    return {
      status: 'SEND_FAILED',
      message: `Email to ${to} failed — check SMTP settings and retry.`,
    };
  }

  // Per-vendor send state — the PO detail page and Ordered Materials
  // read sentAt from here for the "sent" date.
  if (po.vendor) {
    await prisma.purchaseOrderVendor.upsert({
      where: { purchaseOrderId_vendorId: { purchaseOrderId: po.id, vendorId: po.vendor.id } },
      create: {
        tenantId,
        purchaseOrderId: po.id,
        vendorId: po.vendor.id,
        status: 'SENT',
        sentAt: new Date(),
      },
      update: { status: 'SENT', sentAt: new Date(), lastError: null },
    });
  }

  if (po.status === POStatus.DRAFT) {
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: POStatus.SENT } });
    await prisma.pOEvent.create({
      data: {
        tenantId,
        purchaseOrderId: po.id,
        kind: POEventKind.STATUS_CHANGED,
        message: 'Status changed to SENT (vendor emailed)',
        actorId,
      },
    });
  }

  return { status: 'SENT', message: `Sent to ${to}` };
}

/// Explicit per-PO send / retry (also used by the results screen when the
/// initial send failed). Emails the vendor, records POEvents + audit, and
/// moves the PO to SENT.
export async function sendShopOrderPoAction(
  poId: string
): Promise<{ ok: boolean; message: string }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!po) return { ok: false, message: 'Purchase order not found.' };

  const sent = await emailPoToVendor(me.tenantId, me.id, poId);

  await writeAuditLog({
    action: sent.status === 'SENT' ? 'po_sent' : 'po_send_failed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: po.number, via: 'shop_order_send', detail: sent.message },
  });

  revalidatePath('/purchase-orders');
  return { ok: sent.status === 'SENT', message: sent.message };
}

/// Emails the office-review draft through the tenant's SMTP. Retail
/// orders stay manual — this only delivers the review email; nothing is
/// ordered automatically.
const officeDraftSchema = z.object({
  poId: z.string().trim().min(1).max(200),
  to: z.string().trim().email('Enter a valid office email address.'),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
});

export async function sendOfficeDraftEmailAction(payload: {
  poId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; message: string }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = officeDraftSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { poId, to, subject, body } = parsed.data;

  // Tenant gate — the draft must belong to one of this tenant's POs.
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!po) return { ok: false, message: 'Purchase order not found.' };

  const sent = await sendMail({
    to,
    subject,
    text: body,
    html: `<pre style="font-family:Arial,sans-serif;font-size:13px;white-space:pre-wrap">${escapeHtml(body)}</pre>`,
  });
  if (!sent.ok) {
    return { ok: false, message: `Email to ${to} failed — check SMTP settings and retry.` };
  }

  await prisma.pOEvent.create({
    data: {
      tenantId: me.tenantId,
      purchaseOrderId: po.id,
      kind: POEventKind.NOTE_ADDED,
      message: `Office review draft emailed to ${to} (retail order — manual placement required)`,
      actorId: me.id,
    },
  });
  await writeAuditLog({
    action: 'po_office_draft_emailed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: po.number, to },
  });

  return { ok: true, message: `Draft sent to ${to}` };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

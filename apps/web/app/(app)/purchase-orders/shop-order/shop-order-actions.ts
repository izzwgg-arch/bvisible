'use server';

// Shop-order flow: one search-driven materials request, auto-split into
// one PurchaseOrder per vendor (lowest-price vendor preselected in the
// UI, changeable per line). Creates completely standard PO rows —
// detail pages, QBO numbers, receipt OCR, reconciliation, and lifecycle
// queues all apply unchanged. Optional vendor email goes through the
// tenant's existing SMTP with a link-free plain document body.

import { z } from 'zod';
import { POEventKind, POLineKind, prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { nextPoNumber } from '@/lib/po/number';
import { sendMail } from '@/lib/mailer';
import { formatMoney } from '@bvisible/pricing';
import {
  buildRetailCartUrl,
  isRetailVendor,
  normalizeExternalUrl,
} from '@/lib/po/retail-cart';

const shopOrderLineSchema = z.object({
  name: z.string().trim().min(1).max(400),
  detail: z.string().trim().max(400).default(''),
  vendor: z.string().trim().min(1).max(200),
  qty: z.number().min(0.001).max(100000),
  unitPriceCents: z.number().int().min(0).max(1_000_000_000),
  catalogId: z.string().trim().max(200).default(''),
  vendorSku: z.string().trim().max(200).default(''),
  productUrl: z.string().trim().max(1000).default(''),
});

export interface RetailCartItem {
  name: string;
  qty: number;
  url: string;
  sku: string;
  unitPriceCents: number;
}

const shopOrderSchema = z.object({
  notes: z.string().trim().max(2000).default(''),
  sendEmails: z.boolean().default(false),
  lines: z.array(shopOrderLineSchema).min(1, 'Add at least one material.').max(200),
});

export interface ShopOrderResult {
  error: string | null;
  created?: Array<{
    id: string;
    number: string;
    vendor: string;
    totalCents: number;
    emailStatus: 'SENT' | 'NOT_SENT' | 'NO_VENDOR_EMAIL' | 'SEND_FAILED';
    /// Present for Amazon / Home Depot / Walmart / Lowe's POs: cart data
    /// for office review. Nothing is ordered automatically.
    retail?: {
      vendor: string;
      /// Amazon add-to-cart URL when every SKU is an ASIN; otherwise null.
      cartUrl: string | null;
      items: RetailCartItem[];
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

    const po = await prisma.$transaction(async (tx) => {
      const number = await nextPoNumber(tx, me.tenantId);
      const row = await tx.purchaseOrder.create({
        data: {
          tenantId: me.tenantId,
          vendorId: vendor.id,
          number,
          notes: data.notes || null,
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
        lineCount: lines.length,
        totalCents,
      },
    });

    // Nothing is emailed at creation time. Every PO is saved as a DRAFT
    // for review; the operator sends each one explicitly with Send PO —
    // and retail vendors (Amazon/Home Depot/…) get a cart + office draft
    // email instead of a vendor email.
    let retail: NonNullable<ShopOrderResult['created']>[number]['retail'];
    if (isRetailVendor(vendorName)) {
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

    created.push({
      id: po.id,
      number: po.number,
      vendor: vendor.name,
      totalCents,
      emailStatus: vendor.email || vendor.emails[0] ? 'NOT_SENT' : 'NO_VENDOR_EMAIL',
      retail,
    });
  }

  return { error: null, created };
}

/// Explicit per-PO send (the ONLY path that emails a vendor). Renders the
/// PO from the saved rows, emails the vendor's order address, records
/// POEvents + audit, and moves the PO to SENT.
export async function sendShopOrderPoAction(
  poId: string
): Promise<{ ok: boolean; message: string }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId: me.tenantId, deletedAt: null },
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
  if (!po) return { ok: false, message: 'Purchase order not found.' };
  const to = po.vendor?.email ?? po.vendor?.emails[0] ?? null;
  if (!to) {
    return { ok: false, message: 'No vendor email on file — add one in the Sheet Vendor Directory or on the vendor record.' };
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
      tenantId: me.tenantId,
      purchaseOrderId: po.id,
      kind: POEventKind.NOTE_ADDED,
      message: sent.ok
        ? `PO emailed to ${to} (Send PO)`
        : `PO email to ${to} failed — retry or send manually`,
      actorId: me.id,
    },
  });
  if (!sent.ok) {
    return { ok: false, message: `Email to ${to} failed — check SMTP settings and retry.` };
  }

  if (po.status === 'DRAFT') {
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'SENT' } });
    await prisma.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: po.id,
        kind: POEventKind.STATUS_CHANGED,
        message: 'Status changed to SENT (explicit Send PO)',
        actorId: me.id,
      },
    });
  }
  await writeAuditLog({
    action: 'po_sent',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: po.number, to, via: 'shop_order_send' },
  });

  return { ok: true, message: `Sent to ${to}` };
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

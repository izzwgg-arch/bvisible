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

const shopOrderLineSchema = z.object({
  name: z.string().trim().min(1).max(400),
  detail: z.string().trim().max(400).default(''),
  vendor: z.string().trim().min(1).max(200),
  qty: z.number().min(0.001).max(100000),
  unitPriceCents: z.number().int().min(0).max(1_000_000_000),
  catalogId: z.string().trim().max(200).default(''),
  vendorSku: z.string().trim().max(200).default(''),
});

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

    let emailStatus: 'SENT' | 'NOT_SENT' | 'NO_VENDOR_EMAIL' | 'SEND_FAILED' = 'NOT_SENT';
    if (data.sendEmails) {
      const to = vendor.email ?? vendor.emails[0] ?? null;
      if (!to) {
        emailStatus = 'NO_VENDOR_EMAIL';
      } else {
        const rowsHtml = lines
          .map(
            (l) =>
              `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(
                l.detail ? `${l.name} — ${l.detail}` : l.name
              )}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${l.qty}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatMoney(
                l.unitPriceCents
              )}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatMoney(
                Math.round(l.qty * l.unitPriceCents)
              )}</td></tr>`
          )
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
              <tr><td colspan="3" style="padding:8px 10px;text-align:right;font-weight:bold">Total</td><td style="padding:8px 10px;text-align:right;font-weight:bold">${formatMoney(totalCents)}</td></tr>
            </table>
            ${data.notes ? `<p style="margin-top:14px;font-size:13px;color:#555"><b>Notes:</b> ${escapeHtml(data.notes)}</p>` : ''}
            <p style="margin-top:18px;font-size:13px;color:#555">Please confirm receipt of this order. Reference PO ${po.number} on all paperwork.</p>
          </div>`;
        const text = [
          `Purchase order ${po.number} — B Visible Signs & Printing`,
          '',
          ...lines.map(
            (l) =>
              `${l.detail ? `${l.name} — ${l.detail}` : l.name}  x${l.qty}  @ ${formatMoney(l.unitPriceCents)}  = ${formatMoney(Math.round(l.qty * l.unitPriceCents))}`
          ),
          '',
          `Total: ${formatMoney(totalCents)}`,
          data.notes ? `Notes: ${data.notes}` : '',
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
        emailStatus = sent.ok ? 'SENT' : 'SEND_FAILED';
        await prisma.pOEvent.create({
          data: {
            tenantId: me.tenantId,
            purchaseOrderId: po.id,
            kind: POEventKind.NOTE_ADDED,
            message: sent.ok
              ? `PO emailed to ${to}`
              : `PO email to ${to} failed — send manually or retry`,
            actorId: me.id,
          },
        });
        if (sent.ok) {
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { status: 'SENT' },
          });
          await prisma.pOEvent.create({
            data: {
              tenantId: me.tenantId,
              purchaseOrderId: po.id,
              kind: POEventKind.STATUS_CHANGED,
              message: 'Status changed to SENT (shop-order email)',
              actorId: me.id,
            },
          });
        }
      }
    }

    created.push({
      id: po.id,
      number: po.number,
      vendor: vendor.name,
      totalCents,
      emailStatus,
    });
  }

  return { error: null, created };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Admin notification for draft purchase orders.
//
// Business rule: the ADMIN places every order. So the moment a PO comes
// into existence (every PO is born DRAFT), each admin account gets an
// email telling them a draft is waiting, with the full line list, a link
// to the PO, and — for retail vendors (Amazon / Home Depot / …) — a
// prefilled cart link (Amazon) or per-item product/search links so the
// order can be placed on the store site in one hop.
//
// The daily reminder tick (/api/internal/po-draft-reminder) sends ONE digest
// listing every PO still sitting in DRAFT — see sendDraftPoDigest below. It
// used to call notifyAdminsOfDraftPo once per draft, which meant each admin
// got one email per draft every morning: 25 drafts became 25 emails, and it
// grew every day as drafts accumulated. A reminder nobody can read is a
// reminder nobody acts on, which is what let the drafts pile up.
//
// All entry points are fire-and-forget safe: they never throw, and a
// mailer failure never breaks PO creation (the daily digest is the
// safety net for a missed creation email).

import { POEventKind, Role, prisma } from '@bvisible/db';
import { headers } from 'next/headers';
import { sendMail } from '@/lib/mailer';
import { wrapBranded } from '@/lib/emails/render';
import { formatMoney, formatQty } from '@/lib/estimate/format';
import { writeAuditLog } from '@/lib/auth/audit';
import { amazonAssociateTag } from '@/lib/po/amazon-associate-tag';
import {
  buildAmazonCartUrl,
  buildRetailItemLink,
  isRetailVendor,
  normalizeExternalUrl,
} from '@/lib/po/retail-cart';

/// Public origin for links in emails. APP_BASE_URL (documented in
/// ENVIRONMENT_VARIABLES.md) wins; inside a request we fall back to the
/// forwarded host the same way the password-reset mailer does; outside a
/// request (internal ticks) we fall back to loopback so links still form.
export async function resolveAppOrigin(): Promise<string> {
  const env = (process.env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (env) return env;
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (host) {
      const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request scope (internal tick) — fall through.
  }
  return 'http://127.0.0.1:3000';
}

/// Every enabled admin account that should hear about draft POs for this
/// tenant: the tenant's ADMINs plus SUPER_ADMINs (tenant-scoped or global).
export async function listAdminRecipients(tenantId: string): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: {
      disabledAt: null,
      OR: [
        { tenantId, role: Role.ADMIN },
        { tenantId, role: Role.SUPER_ADMIN },
        { tenantId: null, role: Role.SUPER_ADMIN },
      ],
    },
    select: { email: true },
  });
  return [...new Set(admins.map((a) => a.email.trim().toLowerCase()).filter(Boolean))];
}

export interface RetailOrderingBlock {
  vendorName: string;
  /// Amazon multi-item add-to-cart URL (only when every line resolves an ASIN).
  cartUrl: string | null;
  /// Per-line product or store-search links (label + href).
  itemLinks: Array<{ label: string; href: string }>;
}

/// Retail ordering helpers for a PO's lines, derived from persisted rows
/// only (vendorSku + description) so it works for POs created anywhere,
/// not just the shop-order flow.
export function buildRetailOrderingBlock(
  vendorName: string | null | undefined,
  lines: Array<{ description: string; vendorSku: string | null; qtyMilli: number }>
): RetailOrderingBlock | null {
  const name = (vendorName ?? '').trim();
  if (!name || !isRetailVendor(name) || lines.length === 0) return null;
  const cartUrl = /amazon/i.test(name)
    ? buildAmazonCartUrl(
        lines.map((l) => ({ sku: l.vendorSku, url: null, qty: Math.max(1, Math.ceil(l.qtyMilli / 1000)) })),
        amazonAssociateTag()
      )
    : null;
  const itemLinks = lines
    .map((l) => ({ label: l.description, href: buildRetailItemLink(name, l.vendorSku, l.description) }))
    .filter((l) => l.href !== '');
  if (!cartUrl && itemLinks.length === 0) return null;
  return { vendorName: name, cartUrl, itemLinks };
}

/// Clickable store link for one PO line: the exact product page captured at
/// order time when there is one, otherwise a link derived from the SKU. Kept
/// as a link cell so `wrapBranded` emits a real anchor — a bare URL in a table
/// cell is not clickable in most mail clients.
function retailLinkCell(
  vendorName: string,
  line: { description: string; vendorSku: string | null; productUrl: string | null }
): { text: string; href: string } | string {
  const direct = normalizeExternalUrl(line.productUrl);
  if (direct) return { text: `View on ${vendorName}`, href: direct };
  const derived = buildRetailItemLink(vendorName, line.vendorSku, line.description, line.productUrl);
  return derived ? { text: `Find on ${vendorName}`, href: derived } : '';
}

/// Email one or more admins that a PO is in DRAFT and must be placed.
/// Never throws. Returns what happened so callers/ticks can report it.
export async function notifyAdminsOfDraftPo(input: {
  tenantId: string;
  purchaseOrderId: string;
  actorId?: string;
}): Promise<
  | { ok: true; to: string[]; messageId: string }
  | { ok: false; skipped: string }
> {
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, tenantId: input.tenantId, deletedAt: null },
      select: {
        id: true,
        number: true,
        status: true,
        subtotalCents: true,
        notes: true,
        createdAt: true,
        vendor: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
        estimate: { select: { number: true } },
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            description: true,
            vendorSku: true,
            // The exact product page captured at order time. Without it the
            // links below fall back to a SKU guess even when the precise URL
            // is sitting on the row.
            productUrl: true,
            qtyMilli: true,
            unit: true,
            unitCostCents: true,
            computedCostCents: true,
          },
        },
      },
    });
    if (!po) return { ok: false, skipped: 'po_not_found' };
    if (po.status !== 'DRAFT') return { ok: false, skipped: `status_${po.status}` };

    const to = await listAdminRecipients(input.tenantId);
    if (to.length === 0) return { ok: false, skipped: 'no_admin_recipients' };

    const origin = await resolveAppOrigin();
    const poUrl = `${origin}/purchase-orders/${po.id}`;
    const vendorName = po.vendor?.name ?? 'No vendor set';
    const retail = buildRetailOrderingBlock(po.vendor?.name, po.lines);
    const createdBy = po.createdBy?.name || po.createdBy?.email || 'unknown';

    const paragraphs: string[] = [];
    if (retail?.cartUrl) {
      paragraphs.push(
        `${retail.vendorName} order: a prefilled cart with every item is one click away — ` +
          `open ${retail.cartUrl} , review quantities, and check out. Nothing has been ordered automatically.`
      );
    } else if (retail && retail.itemLinks.length > 0) {
      // The links themselves now live in the table's "Link" column as real
      // anchors. Listing them here as bare text produced a wall of URLs that
      // most mail clients rendered unclickable.
      paragraphs.push(
        `${retail.vendorName} order — open each item from the Link column below and add it to the cart.`
      );
    }

    const heading = `Draft PO ${po.number} needs to be placed`;
    const intro =
      `${createdBy} created purchase order ${po.number} (${vendorName}). It is saved as a DRAFT — ` +
      'please review it and place the order.';

    const { html, text } = wrapBranded({
      preheader: `${po.number} · ${vendorName} · ${formatMoney(po.subtotalCents)} — draft awaiting placement`,
      heading,
      intro,
      button: { label: `Open ${po.number}`, href: retail?.cartUrl ?? poUrl },
      details: [
        { label: 'Purchase order', value: po.number },
        { label: 'Vendor', value: vendorName },
        ...(po.estimate?.number ? [{ label: 'Estimate', value: po.estimate.number }] : []),
        { label: 'Created by', value: createdBy },
        { label: 'Subtotal', value: formatMoney(po.subtotalCents) },
        { label: 'PO page', value: poUrl },
      ],
      ...(po.lines.length > 0
        ? {
            table: {
              title: 'Items on this PO',
              columns: [
                { label: 'Item' },
                { label: 'SKU' },
                { label: 'Qty', align: 'right' as const },
                { label: 'Unit cost', align: 'right' as const },
                { label: 'Total', align: 'right' as const },
                // Retail orders only: a regular vendor PO is emailed to the
                // vendor, so there is no store page to open.
                ...(retail ? [{ label: 'Link' }] : []),
              ],
              rows: po.lines.map((l) => [
                l.description,
                l.vendorSku ?? '',
                formatQty(l.qtyMilli),
                formatMoney(l.unitCostCents),
                formatMoney(l.computedCostCents),
                ...(retail ? [retailLinkCell(vendorName, l)] : []),
              ]),
              summary: { label: 'Subtotal', value: formatMoney(po.subtotalCents) },
            },
          }
        : {}),
      ...(paragraphs.length > 0 ? { paragraphs } : {}),
      note:
        retail != null
          ? 'This is a retail-store order: an admin places it on the vendor website. The cart/product links above are prefilled from the PO lines; nothing is ordered until you check out.'
          : 'An admin must review this draft and send the order to the vendor.',
      reason:
        'You received this email because your B Visible account has the admin role and a purchase order is waiting in DRAFT.',
    });

    const sent = await sendMail({
      to: to.join(', '),
      subject: `Action needed: draft PO ${po.number} — ${vendorName} (${formatMoney(po.subtotalCents)})`,
      html,
      text,
    });
    if (!sent.ok) return { ok: false, skipped: `mailer_${sent.error.kind}` };

    await prisma.pOEvent.create({
      data: {
        tenantId: input.tenantId,
        purchaseOrderId: po.id,
        kind: POEventKind.NOTE_ADDED,
        message: `Admins notified by email (${to.join(', ')}) — draft awaiting placement`,
        ...(input.actorId ? { actorId: input.actorId } : {}),
      },
    });
    await writeAuditLog({
      action: 'po_draft_admin_notified',
      tenantId: input.tenantId,
      userId: input.actorId ?? null,
      targetType: 'purchase_order',
      targetId: po.id,
      metadata: {
        number: po.number,
        reason: 'created',
        recipientCount: to.length,
        messageId: sent.result.messageId,
      },
    });

    return { ok: true, to, messageId: sent.result.messageId };
  } catch (err) {
    console.error('[po-admin-notify] failed:', err instanceof Error ? err.message : err);
    return { ok: false, skipped: 'error' };
  }
}

/// How long a draft has been waiting, for the digest's "Waiting" column.
function ageLabel(createdAt: Date, now: number): string {
  const days = Math.floor((now - createdAt.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/// The morning reminder: ONE email listing every PO still in DRAFT for this
/// tenant, oldest first. One email a day however many drafts there are —
/// the previous per-PO loop is what turned a reminder into a mailstorm.
///
/// Never throws. Returns what happened so the tick can report it.
export async function sendDraftPoDigest(input: { tenantId: string }): Promise<
  | { ok: true; to: string[]; messageId: string; numbers: string[] }
  | { ok: false; skipped: string }
> {
  try {
    const drafts = await prisma.purchaseOrder.findMany({
      where: { tenantId: input.tenantId, status: 'DRAFT', deletedAt: null },
      // Oldest first: the drafts that have been ignored longest are the ones
      // that need an admin's attention, so they lead the table.
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        number: true,
        subtotalCents: true,
        createdAt: true,
        vendor: { select: { name: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (drafts.length === 0) return { ok: false, skipped: 'no_drafts' };

    const to = await listAdminRecipients(input.tenantId);
    if (to.length === 0) return { ok: false, skipped: 'no_admin_recipients' };

    const origin = await resolveAppOrigin();
    const now = Date.now();
    const totalCents = drafts.reduce((sum, d) => sum + d.subtotalCents, 0);
    const count = drafts.length;

    const { html, text } = wrapBranded({
      preheader: `${count} draft purchase order${count === 1 ? '' : 's'} · ${formatMoney(totalCents)} waiting to be placed`,
      heading:
        count === 1
          ? 'One purchase order is still a draft'
          : `${count} purchase orders are still drafts`,
      intro:
        'These have not been sent to a vendor yet. Open each one to place the order, or delete it ' +
        'if it is no longer needed. This list is emailed once each morning.',
      button: { label: 'Open purchase orders', href: `${origin}/purchase-orders` },
      table: {
        title: 'Drafts waiting',
        columns: [
          { label: 'PO' },
          { label: 'Vendor' },
          { label: 'Created by' },
          { label: 'Waiting', align: 'right' as const },
          { label: 'Value', align: 'right' as const },
          { label: 'Link' },
        ],
        rows: drafts.map((d) => [
          d.number,
          d.vendor?.name ?? 'No vendor set',
          d.createdBy?.name || d.createdBy?.email || 'unknown',
          ageLabel(d.createdAt, now),
          formatMoney(d.subtotalCents),
          { text: 'Open', href: `${origin}/purchase-orders/${d.id}` },
        ]),
        summary: { label: 'Total value', value: formatMoney(totalCents) },
      },
      note:
        'One email a day covers every draft, however many there are. Nothing on this list has ' +
        'been ordered.',
      reason:
        'You received this email because your B Visible account has the admin role and purchase orders are waiting in DRAFT.',
    });

    const sent = await sendMail({
      to: to.join(', '),
      subject: `Reminder: ${count} draft PO${count === 1 ? '' : 's'} waiting — ${formatMoney(totalCents)}`,
      html,
      text,
    });
    if (!sent.ok) return { ok: false, skipped: `mailer_${sent.error.kind}` };

    const numbers = drafts.map((d) => d.number);

    // One timeline entry per PO — these are database rows, not emails, and
    // the per-PO history of "this was chased on the Nth" is worth keeping.
    await prisma.pOEvent.createMany({
      data: drafts.map((d) => ({
        tenantId: input.tenantId,
        purchaseOrderId: d.id,
        kind: POEventKind.NOTE_ADDED,
        message: `Included in the morning draft digest emailed to admins (${to.join(', ')})`,
      })),
    });
    await writeAuditLog({
      action: 'po_draft_admin_notified',
      tenantId: input.tenantId,
      userId: null,
      targetType: 'purchase_order',
      // A digest covers many POs, so there is no single target row; the
      // numbers live in the metadata instead.
      targetId: null,
      metadata: {
        reason: 'digest',
        poNumbers: numbers,
        draftCount: count,
        recipientCount: to.length,
        messageId: sent.result.messageId,
      },
    });

    return { ok: true, to, messageId: sent.result.messageId, numbers };
  } catch (err) {
    console.error('[po-draft-digest] failed:', err instanceof Error ? err.message : err);
    return { ok: false, skipped: 'error' };
  }
}

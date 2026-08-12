// Office reminder for retail (Amazon / Home Depot / …) purchase orders.
//
// A retail vendor has no order desk to email, so the PO itself is never sent
// to them. Instead the OFFICE is emailed a reminder with everything needed to
// complete checkout on the store's own site. That email now goes out
// automatically when the order is created — the employee never opens a mail
// app, copies text, or clicks an initial "Email office" button.
//
// HARD RULES:
//  1. Order creation and reminder delivery are SEPARATE states. A failed
//     email never rolls back, duplicates, or blocks a PO that was created
//     successfully — the PO, its lines, and its product links stand on their
//     own and only the email step is retried.
//  2. The reminder is sent AFTER the order row exists, never before.
//  3. Every attempt is recorded as its own PoOfficeReminder row, so the
//     resend history is the table itself.
//  4. Changing the recipient is per-order. The tenant-wide default lives in
//     AMAZON_OFFICE_REMINDER_EMAIL and is never mutated from the UI.
//  5. Nothing surfaced to the client may contain a provider message, stack
//     trace, or credential — failures are reduced to a short safe category.

import { POReminderStatus, prisma } from '@bvisible/db';
import { formatMoney, formatQty } from '@/lib/estimate/format';
import { wrapBranded } from '@/lib/emails/render';
import { MailerConfigError, sendMail } from '@/lib/mailer';
import { resolveAppOrigin } from '@/lib/po/admin-notify';
import { normalizeExternalUrl } from '@/lib/po/retail-cart';

/// Last-resort recipient. The deployment sets AMAZON_OFFICE_REMINDER_EMAIL;
/// this constant exists so a missing env var degrades to the correct office
/// address instead of silently sending nowhere.
export const DEFAULT_OFFICE_REMINDER_EMAIL = 'sales@bvisible.us';

/// Server-side only — never read from client code, so the address cannot be
/// tampered with in the browser and no configuration leaks into the bundle.
export function defaultOfficeReminderEmail(): string {
  const configured = (process.env.AMAZON_OFFICE_REMINDER_EMAIL ?? '').trim();
  return isValidEmail(configured) ? configured : DEFAULT_OFFICE_REMINDER_EMAIL;
}

/// Deliberately simple and shared by the client field and the server action so
/// the two cannot disagree about what is acceptable. Real deliverability is
/// proven by the send, not by a clever regex.
export function isValidEmail(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v || v.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/// Safe failure labels. These are rendered to the user, so they must never
/// carry provider text.
export type ReminderFailureCategory =
  | 'smtp_not_configured'
  | 'invalid_recipient'
  | 'send_failed';

const FAILURE_MESSAGES: Record<ReminderFailureCategory, string> = {
  smtp_not_configured: 'Email is not configured yet, so the reminder could not go out.',
  invalid_recipient: 'That email address was not accepted.',
  send_failed: 'The email could not be delivered. You can try again.',
};

export function reminderFailureMessage(category: string | null | undefined): string {
  const key = (category ?? '') as ReminderFailureCategory;
  return FAILURE_MESSAGES[key] ?? FAILURE_MESSAGES.send_failed;
}

export interface OfficeReminderView {
  id: string;
  recipient: string;
  status: POReminderStatus;
  attempt: number;
  sentAt: string | null;
  failureMessage: string | null;
}

/// Current reminder state for a PO = its newest attempt. Older rows stay as
/// history and are intentionally not merged in.
export async function latestOfficeReminder(
  tenantId: string,
  purchaseOrderId: string
): Promise<OfficeReminderView | null> {
  const row = await prisma.poOfficeReminder.findFirst({
    where: { tenantId, purchaseOrderId },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    recipient: row.recipient,
    status: row.status,
    attempt: row.attempt,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    failureMessage: row.status === POReminderStatus.FAILED ? reminderFailureMessage(row.failureCategory) : null,
  };
}

interface ReminderLine {
  description: string;
  vendorSku: string | null;
  productUrl: string | null;
  qtyMilli: number;
  unit: string;
  unitCostCents: number;
  computedCostCents: number;
  notes: string | null;
}

/// The reminder email. No product images anywhere — every row is text plus a
/// product URL, which mail clients linkify on their own. `wrapBranded` escapes
/// all cell content, so a hostile URL cannot inject markup.
export function buildOfficeReminderEmail(input: {
  poNumber: string;
  vendorName: string;
  createdByLabel: string;
  createdAt: Date;
  lines: ReminderLine[];
  subtotalCents: number;
  poUrl: string | null;
}): { subject: string; html: string; text: string } {
  const created = input.createdAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const { html, text } = wrapBranded({
    preheader: `${input.vendorName} order ${input.poNumber} is ready for checkout.`,
    heading: `${input.vendorName} order ready: ${input.poNumber}`,
    intro:
      `${input.createdByLabel} created this order in B Visible on ${created}. ` +
      `Nothing has been purchased — the office still completes checkout on ${input.vendorName}.`,
    details: [
      { label: 'Purchase order', value: input.poNumber },
      { label: 'Store', value: input.vendorName },
      { label: 'Created by', value: input.createdByLabel },
      { label: 'Created', value: created },
    ],
    table: {
      title: 'Items to order',
      columns: [
        { label: 'Item' },
        { label: 'Specs' },
        { label: 'Qty', align: 'right' },
        { label: 'Unit price', align: 'right' },
        { label: 'Line total', align: 'right' },
        { label: 'Product link' },
      ],
      rows: input.lines.map((line) => [
        line.description,
        line.notes ?? '',
        `${formatQty(line.qtyMilli)} ${line.unit.toLowerCase().replace(/_/g, ' ')}`,
        formatMoney(line.unitCostCents),
        formatMoney(line.computedCostCents),
        normalizeExternalUrl(line.productUrl) || 'No link on file',
      ]),
      summary: { label: 'Order total', value: formatMoney(input.subtotalCents) },
    },
    ...(input.poUrl ? { button: { label: 'Open the purchase order', href: input.poUrl } } : {}),
    note: `Please complete the ${input.vendorName} checkout. B Visible does not place the order, take payment, or purchase anything automatically.`,
    reason: 'You received this because a retail purchase order was created in B Visible.',
  });

  return { subject: `${input.vendorName} order ready: ${input.poNumber}`, html, text };
}

export interface SendReminderResult {
  ok: boolean;
  recipient: string;
  sentAt: string | null;
  failureCategory: ReminderFailureCategory | null;
  failureMessage: string | null;
}

/// Send (or resend) the office reminder for one PO and record the attempt.
///
/// Never throws: the caller is usually mid-order-creation, and a mail problem
/// must not take the order down with it. Failures come back as a category the
/// UI can render and retry.
export async function sendOfficeReminder(input: {
  tenantId: string;
  purchaseOrderId: string;
  recipient: string;
  actorId?: string | null;
}): Promise<SendReminderResult> {
  const recipient = input.recipient.trim();

  const fail = async (
    category: ReminderFailureCategory,
    attempt: number
  ): Promise<SendReminderResult> => {
    await prisma.poOfficeReminder.create({
      data: {
        tenantId: input.tenantId,
        purchaseOrderId: input.purchaseOrderId,
        recipient: recipient.slice(0, 320),
        status: POReminderStatus.FAILED,
        attempt,
        failureCategory: category,
        createdById: input.actorId ?? null,
      },
    });
    return {
      ok: false,
      recipient,
      sentAt: null,
      failureCategory: category,
      failureMessage: reminderFailureMessage(category),
    };
  };

  // Attempt number is derived from history, so a resend is always recorded as
  // a distinct attempt rather than overwriting the automatic one.
  const priorCount = await prisma.poOfficeReminder.count({
    where: { tenantId: input.tenantId, purchaseOrderId: input.purchaseOrderId },
  });
  const attempt = priorCount + 1;

  if (!isValidEmail(recipient)) return fail('invalid_recipient', attempt);

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, tenantId: input.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      subtotalCents: true,
      createdAt: true,
      vendor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          description: true,
          vendorSku: true,
          productUrl: true,
          qtyMilli: true,
          unit: true,
          unitCostCents: true,
          computedCostCents: true,
          notes: true,
          vendor: { select: { name: true } },
        },
      },
    },
  });
  // Treated as a send failure rather than an exception: the caller only ever
  // reaches here with a PO it just created, so this is a defensive branch.
  if (!po) return fail('send_failed', attempt);

  const vendorName = po.vendor?.name ?? po.lines.find((l) => l.vendor?.name)?.vendor?.name ?? 'Store';
  const origin = await resolveAppOrigin();
  const email = buildOfficeReminderEmail({
    poNumber: po.number,
    vendorName,
    createdByLabel: po.createdBy?.name || po.createdBy?.email || 'A B Visible user',
    createdAt: po.createdAt,
    lines: po.lines,
    // Recomputed from the persisted lines rather than trusting a cached
    // column, so the emailed total always matches the rows beneath it.
    subtotalCents: po.lines.reduce((sum, l) => sum + l.computedCostCents, 0),
    poUrl: origin ? `${origin}/purchase-orders/${po.id}` : null,
  });

  const sent = await sendMail({
    to: recipient,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (!sent.ok) {
    // sendMail already logs the provider detail safely; only the category
    // crosses back to the UI.
    const category: ReminderFailureCategory =
      sent.error instanceof MailerConfigError ? 'smtp_not_configured' : 'send_failed';
    return fail(category, attempt);
  }

  const row = await prisma.poOfficeReminder.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: input.purchaseOrderId,
      recipient: recipient.slice(0, 320),
      status: POReminderStatus.SENT,
      attempt,
      messageId: sent.result.messageId ?? null,
      sentAt: new Date(),
      createdById: input.actorId ?? null,
    },
  });

  return {
    ok: true,
    recipient,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    failureCategory: null,
    failureMessage: null,
  };
}

'use server';

// Resend the office reminder for a retail PO.
//
// This retries the EMAIL STEP ONLY. It never re-creates the purchase order,
// re-inserts lines, re-runs catalog auto-add, or repeats any other side
// effect of order creation — those already succeeded and are not part of the
// failure being retried.

import { z } from 'zod';
import { prisma } from '@bvisible/db';
import { revalidatePath } from 'next/cache';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import {
  defaultOfficeReminderEmail,
  isValidEmail,
  sendOfficeReminder,
} from '@/lib/po/office-reminder';

export interface ResendReminderState {
  ok: boolean;
  error: string | null;
  recipient?: string;
  sentAt?: string | null;
}

const schema = z.object({
  purchaseOrderId: z.string().trim().min(1).max(64),
  /// Empty = keep using the server-side default for this send.
  recipient: z.string().trim().max(320).default(''),
});

/// Guards against the double-click / duplicate-send case: a reminder created
/// for this PO within the last few seconds means one is already in flight.
/// Cheap and good enough — the real protection is that this action is
/// idempotent in effect (an extra email, never an extra order).
const DUPLICATE_WINDOW_MS = 8_000;

export async function resendOfficeReminderAction(
  _prev: ResendReminderState,
  formData: FormData
): Promise<ResendReminderState> {
  // Any authenticated user of the tenant may resend — the office reminder is
  // an operational action, not one restricted to the order's creator.
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = schema.safeParse({
    purchaseOrderId: String(formData.get('purchaseOrderId') ?? ''),
    recipient: String(formData.get('recipient') ?? ''),
  });
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };

  const raw = parsed.data.recipient.trim();
  // Server-side validation, independent of the client field: a rejected
  // address must not silently fall back to the default, or the user would
  // believe their correction was accepted.
  if (raw && !isValidEmail(raw)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const recipient = raw || defaultOfficeReminderEmail();

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: parsed.data.purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!po) return { ok: false, error: 'Order not found.' };

  const recent = await prisma.poOfficeReminder.findFirst({
    where: {
      tenantId: me.tenantId,
      purchaseOrderId: po.id,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { recipient: true, sentAt: true, status: true },
  });
  if (recent && recent.recipient === recipient) {
    return {
      ok: true,
      error: null,
      recipient: recent.recipient,
      sentAt: recent.sentAt ? recent.sentAt.toISOString() : null,
    };
  }

  const result = await sendOfficeReminder({
    tenantId: me.tenantId,
    purchaseOrderId: po.id,
    recipient,
    actorId: me.id,
  });

  await writeAuditLog({
    action: 'po_office_reminder_resent',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    // Recipient is operational data, not a secret. No message body, provider
    // response, or credential is recorded.
    metadata: { number: po.number, recipient: result.recipient, ok: result.ok },
  });

  revalidatePath(`/purchase-orders/${po.id}/order-ready`);

  return result.ok
    ? { ok: true, error: null, recipient: result.recipient, sentAt: result.sentAt }
    : { ok: false, error: result.failureMessage ?? 'The reminder could not be sent.' };
}

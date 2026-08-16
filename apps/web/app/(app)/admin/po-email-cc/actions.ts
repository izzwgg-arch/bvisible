'use server';

// Admin management of the default CC list for purchase-order emails.
//
// This list used to be a hard-coded constant, so changing who was copied on a
// PO needed a deploy. It is now a per-company row that an admin edits here.
//
// SCOPE: purchase orders only. Nothing in this file can change what is copied
// on estimates or any other document — those are looked up under a different
// document type (and estimates still use the constant in
// lib/emails/outbound-cc.ts).

import { revalidatePath } from 'next/cache';
import { OutboundDocumentType, Role, prisma } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { normalizeCcList, PO_CC_MAX_RECIPIENTS } from '@/lib/emails/po-cc-list';
import { loadPoCcRecipients } from '@/lib/emails/po-cc';
import { savePoCcRecipientsSchema } from '@/lib/validators';

export interface SavePoCcResult {
  ok: boolean;
  error: string | null;
  /// The stored list on success, so the form shows exactly what was saved
  /// (normalized and de-duplicated) rather than what was typed.
  emails: string[];
}

export async function savePoCcRecipientsAction(payload: unknown): Promise<SavePoCcResult> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();

  const parsed = savePoCcRecipientsSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.', emails: [] };
  }

  const normalized = normalizeCcList(parsed.data.emails);
  if (normalized.invalid.length > 0) {
    // Name the offending entries — "invalid email" alone makes the operator
    // hunt through the list.
    const shown = normalized.invalid.slice(0, 3).join(', ');
    const more = normalized.invalid.length > 3 ? ` (+${normalized.invalid.length - 3} more)` : '';
    return {
      ok: false,
      error: `Not a valid email address: ${shown}${more}`,
      emails: [],
    };
  }
  if (normalized.tooMany) {
    return {
      ok: false,
      error: `That is more than ${PO_CC_MAX_RECIPIENTS} recipients. Remove some and save again.`,
      emails: [],
    };
  }

  const previous = await loadPoCcRecipients(me.tenantId);

  // An empty list is a normal, savable state — the row still exists, it just
  // says "copy nobody". Upsert rather than delete-when-empty so "saved as
  // blank" and "never configured" are not conflated.
  await prisma.outboundCcSetting.upsert({
    where: {
      tenantId_documentType: {
        tenantId: me.tenantId,
        documentType: OutboundDocumentType.PURCHASE_ORDER,
      },
    },
    create: {
      tenantId: me.tenantId,
      documentType: OutboundDocumentType.PURCHASE_ORDER,
      emails: normalized.emails,
    },
    update: { emails: normalized.emails },
  });

  await writeAuditLog({
    action: 'po_cc_recipients_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'outbound_cc_setting',
    targetId: OutboundDocumentType.PURCHASE_ORDER,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      documentType: OutboundDocumentType.PURCHASE_ORDER,
      previousEmails: previous,
      emails: normalized.emails,
      clearedAll: normalized.emails.length === 0,
    },
  });

  revalidatePath('/admin/po-email-cc');
  // The Send PO panel shows this list before sending, so it must not serve a
  // stale copy from the route cache.
  revalidatePath('/purchase-orders', 'layout');

  return { ok: true, error: null, emails: normalized.emails };
}

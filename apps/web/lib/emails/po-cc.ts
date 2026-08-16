// Purchase-order CC recipients — the single source of truth for who is
// copied on a PO email.
//
// Server-only (it touches Prisma). Client code that needs to parse or display
// a list imports lib/emails/po-cc-list.ts instead.
//
// SCOPE: purchase orders only. Estimate emails keep their own list in
// lib/emails/outbound-cc.ts and are not affected by anything here — the
// document type is part of the lookup key precisely so the two can never be
// changed by accident together.

import { OutboundDocumentType, prisma } from '@bvisible/db';
import { normalizeCcList } from '@/lib/emails/po-cc-list';

/// The company's saved default CC list for purchase orders.
///
/// Returns [] when no row exists. That is intentional and safe: no
/// configuration means no CC, so a company can never inherit another
/// company's office addresses. Existing companies were seeded with the
/// previously hard-coded list by the 20260814120000_outbound_cc_settings
/// migration, so this is not a behaviour change for them.
export async function loadPoCcRecipients(tenantId: string): Promise<string[]> {
  const row = await prisma.outboundCcSetting.findUnique({
    where: {
      tenantId_documentType: {
        tenantId,
        documentType: OutboundDocumentType.PURCHASE_ORDER,
      },
    },
    select: { emails: true },
  });
  // Normalize on read as well as on write: a row edited directly in the
  // database should not be able to put junk in a CC header.
  return normalizeCcList(row?.emails ?? []).emails;
}

export interface ResolvedPoCc {
  emails: string[];
  /// True when this send used a one-off list instead of the saved default,
  /// so the audit row can show that the operator changed it for this email.
  overridden: boolean;
}

/// Decide the CC list for one send.
///
/// `override` is the list the operator confirmed in the Send PO panel. It is
/// used verbatim when supplied — INCLUDING an empty array, which means "drop
/// the CCs for this one email". Only `undefined`/`null` falls back to the
/// saved default, which is why the caller must pass `undefined` (not `[]`)
/// when it has no opinion.
export async function resolvePoCcRecipients(
  tenantId: string,
  override?: ReadonlyArray<string> | null
): Promise<ResolvedPoCc> {
  if (override != null) {
    return { emails: normalizeCcList(override).emails, overridden: true };
  }
  return { emails: await loadPoCcRecipients(tenantId), overridden: false };
}

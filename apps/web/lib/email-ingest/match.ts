import { POStatus, prisma } from '@bvisible/db';
import type { ParsedEmail } from './parse';

// Deterministic matcher. See docs/ai-context/PO_SYSTEM.md "Future:
// vendor reply routing" for the priority ladder. We never use AI,
// fuzzy embeddings, or scoring — every decision must be explainable
// from the inputs and a code lookup.
//
// Returned shape mirrors what gets persisted on IngestedEmail.
//   reason     = QBO_NUMBER | PO_NUMBER | VENDOR_AND_RECENT | NONE
//   purchaseOrderId = the matched PO (null when reason = NONE)
//   vendorId   = the resolved vendor when known (null otherwise)
//   hint       = the literal token that triggered the match (for audit)

export type MatchReason =
  | 'QBO_NUMBER'
  | 'PO_NUMBER'
  | 'VENDOR_AND_RECENT'
  | 'NONE';

export interface MatchResult {
  reason: MatchReason;
  purchaseOrderId: string | null;
  vendorId: string | null;
  hint: string | null;
}

const RECENT_PO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Tokens we consider for QBO and internal PO matches. Pattern is
// loose because QBO numbers vary widely (P/PO prefixes, no prefix,
// digits-only, dashes). Internal numbers are tighter (PO-NNNNNN).
const QBO_LIKE_TOKEN = /\b[A-Za-z]{0,4}-?\d{2,10}\b/g;
const INTERNAL_PO_TOKEN = /\bPO-\d{4,8}\b/g;

function dedupe(tokens: string[]): string[] {
  return Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean)));
}

function searchTextBundle(email: ParsedEmail, attachmentNames: string[]): string {
  return [
    email.subject ?? '',
    email.bodyTextSnippet ?? '',
    attachmentNames.join(' '),
  ].join('\n');
}

export interface MatchInput {
  tenantId: string;
  email: ParsedEmail;
  attachmentNames: string[];
}

export async function matchEmail(input: MatchInput): Promise<MatchResult> {
  const haystack = searchTextBundle(input.email, input.attachmentNames);
  const tenantId = input.tenantId;

  // ---- 1: exact match on QuickBooks PO number --------------------
  const qboTokens = dedupe(haystack.match(QBO_LIKE_TOKEN) ?? []);
  if (qboTokens.length > 0) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        qboPoNumber: { in: qboTokens },
      },
      select: { id: true, vendorId: true, qboPoNumber: true },
      orderBy: [{ updatedAt: 'desc' }],
    });
    if (po) {
      return {
        reason: 'QBO_NUMBER',
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        hint: po.qboPoNumber ?? null,
      };
    }
  }

  // ---- 2: exact match on internal PO-NNNNNN ----------------------
  const internalTokens = dedupe(haystack.match(INTERNAL_PO_TOKEN) ?? []);
  if (internalTokens.length > 0) {
    const po = await prisma.purchaseOrder.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        number: { in: internalTokens },
      },
      select: { id: true, vendorId: true, number: true },
      orderBy: [{ updatedAt: 'desc' }],
    });
    if (po) {
      return {
        reason: 'PO_NUMBER',
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        hint: po.number,
      };
    }
  }

  // ---- 3: vendor-by-sender + unique recent open PO ----------------
  const vendor = await prisma.vendor.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      email: input.email.fromAddress,
    },
    select: { id: true },
  });
  if (vendor) {
    const since = new Date(Date.now() - RECENT_PO_WINDOW_MS);
    const candidates = await prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        vendorId: vendor.id,
        status: {
          in: [POStatus.SENT, POStatus.ORDERED, POStatus.PARTIALLY_RECEIVED],
        },
        updatedAt: { gte: since },
      },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 2,
    });
    if (candidates.length === 1) {
      return {
        reason: 'VENDOR_AND_RECENT',
        purchaseOrderId: candidates[0]!.id,
        vendorId: vendor.id,
        hint: input.email.fromAddress,
      };
    }
    // We still surface the vendor even if PO matching was ambiguous —
    // the review screen can use it to constrain the manual picker.
    return {
      reason: 'NONE',
      purchaseOrderId: null,
      vendorId: vendor.id,
      hint: input.email.fromAddress,
    };
  }

  return { reason: 'NONE', purchaseOrderId: null, vendorId: null, hint: null };
}

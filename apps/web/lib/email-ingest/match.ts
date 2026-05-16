import { POStatus, prisma } from '@bvisible/db';
import type { ParsedEmail } from './parse';

// Deterministic matcher. See docs/ai-context/EMAIL_INGESTION.md.
// No AI, fuzzy embeddings, or scoring — every decision must be explainable
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

/** Internal PO-NNNNNN (tight). */
const INTERNAL_PO_TOKEN = /\bPO-\d{4,8}\b/g;
/**
 * QBO-style references (loose). Capped after extraction — haystack can contain
 * many digit tokens from unrelated content.
 */
const QBO_LIKE_TOKEN = /\b[A-Za-z]{0,4}-?\d{2,10}\b/g;
const MAX_QBO_TOKENS = 24;

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

async function vendorFromSender(
  tenantId: string,
  email: ParsedEmail,
): Promise<{ id: string } | null> {
  return prisma.vendor.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      email: email.fromAddress,
    },
    select: { id: true },
  });
}

export async function matchEmail(input: MatchInput): Promise<MatchResult> {
  const haystack = searchTextBundle(input.email, input.attachmentNames);
  const tenantId = input.tenantId;

  // ---- 1: exact internal PO-NNNNNN (before loose QBO tokens) ------------
  const internalTokens = dedupe(haystack.match(INTERNAL_PO_TOKEN) ?? []);
  if (internalTokens.length > 0) {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        number: { in: internalTokens },
      },
      select: { id: true, vendorId: true, number: true },
      orderBy: [{ updatedAt: 'desc' }],
    });
    if (pos.length === 1) {
      const po = pos[0]!;
      return {
        reason: 'PO_NUMBER',
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        hint: po.number,
      };
    }
    if (pos.length > 1) {
      const vendor = await vendorFromSender(tenantId, input.email);
      return {
        reason: 'NONE',
        purchaseOrderId: null,
        vendorId: vendor?.id ?? pos[0]!.vendorId,
        hint: internalTokens.join(', '),
      };
    }
  }

  // ---- 2: exact QuickBooks PO number -------------------------------------
  const qboTokens = dedupe(haystack.match(QBO_LIKE_TOKEN) ?? []).slice(0, MAX_QBO_TOKENS);
  if (qboTokens.length > 0) {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        qboPoNumber: { in: qboTokens },
      },
      select: { id: true, vendorId: true, qboPoNumber: true },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const withQbo = pos.filter((p) => p.qboPoNumber != null && p.qboPoNumber.length > 0);
    if (withQbo.length === 1) {
      const po = withQbo[0]!;
      return {
        reason: 'QBO_NUMBER',
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        hint: po.qboPoNumber ?? null,
      };
    }
    if (withQbo.length > 1) {
      const vendor = await vendorFromSender(tenantId, input.email);
      return {
        reason: 'NONE',
        purchaseOrderId: null,
        vendorId: vendor?.id ?? null,
        hint: qboTokens.slice(0, 6).join(', '),
      };
    }
  }

  // ---- 3: vendor-by-sender + unique recent open PO -----------------------
  const vendor = await vendorFromSender(tenantId, input.email);
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
    return {
      reason: 'NONE',
      purchaseOrderId: null,
      vendorId: vendor.id,
      hint: input.email.fromAddress,
    };
  }

  return { reason: 'NONE', purchaseOrderId: null, vendorId: null, hint: null };
}

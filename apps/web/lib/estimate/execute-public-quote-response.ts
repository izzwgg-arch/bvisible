import type { Prisma } from '@bvisible/db';
import {
  EstimateStatus,
  EstimateTimelineKind,
  type PrismaClient,
} from '@bvisible/db';

import { writeAuditLog } from '@/lib/auth/audit';
import { hashQuoteToken, isPlausibleQuoteToken } from '@/lib/estimate/quote-link-crypto';

export type PublicQuoteResponseIntent = 'accept' | 'decline';

export type PublicQuoteResponseErrorCode =
  | 'invalid_token'
  | 'link_unavailable'
  | 'finalized_blocked'
  | 'opposite_response'
  | 'server_error';

export type PublicQuoteResponseExecution =
  | { ok: true; outcome: 'recorded'; intent: PublicQuoteResponseIntent }
  | { ok: true; outcome: 'idempotent'; intent: PublicQuoteResponseIntent }
  | { ok: false; code: PublicQuoteResponseErrorCode; message: string };

/** Trim stored attribution fields (operator-visible only). */
export function truncateResponseIp(ip: string | null): string | null {
  if (!ip?.trim()) return null;
  return ip.trim().slice(0, 48);
}

export function truncateResponseUserAgent(ua: string | null): string | null {
  if (!ua?.trim()) return null;
  return ua.trim().slice(0, 160);
}

export function estimateStatusAfterPublicAccept(): EstimateStatus {
  return EstimateStatus.APPROVED;
}

export function estimateStatusAfterPublicDecline(): EstimateStatus {
  return EstimateStatus.REJECTED;
}

/** Classify races after updateMany returned 0 rows. */
export function classifyQuoteResponseRace(
  intent: PublicQuoteResponseIntent,
  fresh: { acceptedAt: Date | null; declinedAt: Date | null }
): 'idempotent' | 'opposite' | 'unknown' {
  if (intent === 'accept') {
    if (fresh.acceptedAt) return 'idempotent';
    if (fresh.declinedAt) return 'opposite';
    return 'unknown';
  }
  if (fresh.declinedAt) return 'idempotent';
  if (fresh.acceptedAt) return 'opposite';
  return 'unknown';
}

function buildTimelineMetadata(input: {
  quoteLinkId: string;
  estimateNumber: string;
  customerName: string | null;
  customerNote: string | null;
  ip: string | null;
  ua: string | null;
}): Prisma.InputJsonObject {
  const note = input.customerNote?.trim();
  return {
    viaPublicQuote: true,
    quoteLinkId: input.quoteLinkId,
    estimateNumber: input.estimateNumber,
    customerName: input.customerName,
    customerNoteTruncated: note ? note.slice(0, 500) : null,
    ipPrefix: truncateResponseIp(input.ip),
    userAgentSnippet: truncateResponseUserAgent(input.ua),
  };
}

/**
 * Customer accept/decline via raw quote URL token. Transactional; emits timeline + audit
 * only on first successful record (not idempotent replays).
 */
export async function executePublicQuoteCustomerResponse(params: {
  prisma: PrismaClient;
  rawToken: string;
  intent: PublicQuoteResponseIntent;
  customerName: string | null;
  customerNote: string | null;
  ctx: { ipAddress: string | null; userAgent: string | null };
}): Promise<PublicQuoteResponseExecution> {
  if (!isPlausibleQuoteToken(params.rawToken)) {
    return {
      ok: false,
      code: 'invalid_token',
      message: 'This quote link is not valid.',
    };
  }

  const tokenHash = hashQuoteToken(params.rawToken);
  const now = new Date();

  try {
    const result = await params.prisma.$transaction(async (tx) => {
      const row = await tx.estimateQuoteLink.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          tenantId: true,
          estimateId: true,
          revokedAt: true,
          expiresAt: true,
          respondedAt: true,
          acceptedAt: true,
          declinedAt: true,
          estimate: {
            select: {
              id: true,
              tenantId: true,
              deletedAt: true,
              status: true,
              number: true,
            },
          },
        },
      });

      if (!row?.estimate || row.estimate.deletedAt !== null) {
        return { phase: 'unavailable' as const };
      }
      if (row.tenantId !== row.estimate.tenantId) {
        return { phase: 'unavailable' as const };
      }
      if (row.revokedAt !== null) {
        return { phase: 'unavailable' as const };
      }
      if (row.expiresAt !== null && row.expiresAt <= now) {
        return { phase: 'unavailable' as const };
      }

      if (row.estimate.status === EstimateStatus.FINALIZED) {
        return { phase: 'finalized_blocked' as const };
      }

      if (row.respondedAt !== null) {
        if (params.intent === 'accept') {
          if (row.acceptedAt !== null) {
            return { phase: 'idempotent' as const, intent: 'accept' as const };
          }
          if (row.declinedAt !== null) {
            return { phase: 'opposite' as const };
          }
        } else {
          if (row.declinedAt !== null) {
            return { phase: 'idempotent' as const, intent: 'decline' as const };
          }
          if (row.acceptedAt !== null) {
            return { phase: 'opposite' as const };
          }
        }
      }

      const ipSt = truncateResponseIp(params.ctx.ipAddress);
      const uaSt = truncateResponseUserAgent(params.ctx.userAgent);

      const patchAccept = {
        acceptedAt: now,
        acceptedByName: params.customerName,
        acceptedNote: params.customerNote,
        respondedAt: now,
        responseIp: ipSt,
        responseUserAgent: uaSt,
      };

      const patchDecline = {
        declinedAt: now,
        declinedByName: params.customerName,
        declinedNote: params.customerNote,
        respondedAt: now,
        responseIp: ipSt,
        responseUserAgent: uaSt,
      };

      const upd = await tx.estimateQuoteLink.updateMany({
        where: {
          id: row.id,
          tenantId: row.tenantId,
          estimateId: row.estimateId,
          respondedAt: null,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: params.intent === 'accept' ? patchAccept : patchDecline,
      });

      if (upd.count === 0) {
        const fresh = await tx.estimateQuoteLink.findUnique({
          where: { id: row.id },
          select: { acceptedAt: true, declinedAt: true },
        });
        if (!fresh) return { phase: 'unavailable' as const };
        const kind = classifyQuoteResponseRace(params.intent, fresh);
        if (kind === 'idempotent') {
          return {
            phase: 'idempotent' as const,
            intent: params.intent,
          };
        }
        if (kind === 'opposite') return { phase: 'opposite' as const };
        return { phase: 'unavailable' as const };
      }

      const nextStatus =
        params.intent === 'accept'
          ? estimateStatusAfterPublicAccept()
          : estimateStatusAfterPublicDecline();

      await tx.estimate.updateMany({
        where: {
          id: row.estimateId,
          tenantId: row.tenantId,
          deletedAt: null,
        },
        data: { status: nextStatus },
      });

      await tx.estimateTimelineEvent.create({
        data: {
          tenantId: row.tenantId,
          estimateId: row.estimateId,
          kind:
            params.intent === 'accept'
              ? EstimateTimelineKind.QUOTE_ACCEPTED
              : EstimateTimelineKind.QUOTE_DECLINED,
          metadata: buildTimelineMetadata({
            quoteLinkId: row.id,
            estimateNumber: row.estimate.number,
            customerName: params.customerName,
            customerNote: params.customerNote,
            ip: params.ctx.ipAddress,
            ua: params.ctx.userAgent,
          }),
        },
      });

      return {
        phase: 'recorded' as const,
        intent: params.intent,
        tenantId: row.tenantId,
        estimateId: row.estimateId,
        quoteLinkId: row.id,
        estimateNumber: row.estimate.number,
      };
    });

    if (result.phase === 'unavailable') {
      return {
        ok: false,
        code: 'link_unavailable',
        message: 'This quote link is no longer available.',
      };
    }
    if (result.phase === 'finalized_blocked') {
      return {
        ok: false,
        code: 'finalized_blocked',
        message: 'This estimate is finalized — responses are closed.',
      };
    }
    if (result.phase === 'opposite') {
      return {
        ok: false,
        code: 'opposite_response',
        message:
          'A decision has already been recorded for this quote. Contact us if you need changes.',
      };
    }
    if (result.phase === 'idempotent') {
      return { ok: true, outcome: 'idempotent', intent: result.intent };
    }

    const recorded = result;
    await writeAuditLog({
      action:
        recorded.intent === 'accept' ? 'estimate_quote_accepted' : 'estimate_quote_declined',
      tenantId: recorded.tenantId,
      userId: null,
      targetType: 'estimate',
      targetId: recorded.estimateId,
      ipAddress: params.ctx.ipAddress,
      userAgent: params.ctx.userAgent,
      metadata: {
        quoteLinkId: recorded.quoteLinkId,
        estimateNumber: recorded.estimateNumber,
        customerName: params.customerName,
        customerNoteTruncated: params.customerNote?.trim().slice(0, 500) ?? null,
        ipPrefix: truncateResponseIp(params.ctx.ipAddress),
        userAgentSnippet: truncateResponseUserAgent(params.ctx.userAgent),
      },
    });

    return { ok: true, outcome: 'recorded', intent: recorded.intent };
  } catch {
    return {
      ok: false,
      code: 'server_error',
      message: 'Something went wrong. Please try again or contact us.',
    };
  }
}

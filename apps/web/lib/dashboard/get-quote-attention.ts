import type { PrismaClient } from '@bvisible/db';
import {
  EstimateStatus,
  EstimateTimelineKind,
  prisma,
} from '@bvisible/db';

export type QuoteAttentionDb = Pick<PrismaClient, 'estimateTimelineEvent' | 'estimate'>;

export interface QuoteAttentionEstimateRow {
  estimateId: string;
  number: string;
  title: string;
  clientCompanyName: string;
  /** Primary sort timestamp */
  sortAt: Date;
}

export function dedupeEstimateRowsByFirstOccurrence<T extends { estimateId: string }>(
  rows: T[],
  limit: number
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.estimateId)) continue;
    seen.add(r.estimateId);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

export interface DashboardQuoteAttention {
  recentlyAccepted: QuoteAttentionEstimateRow[];
  recentlyDeclined: QuoteAttentionEstimateRow[];
  awaitingCustomerResponse: QuoteAttentionEstimateRow[];
}

export async function getDashboardQuoteAttention(
  tenantId: string,
  db: QuoteAttentionDb = prisma
): Promise<DashboardQuoteAttention> {
  const now = new Date();

  const [acceptedRaw, declinedRaw, awaitingEstimates] = await Promise.all([
    db.estimateTimelineEvent.findMany({
      where: { tenantId, kind: EstimateTimelineKind.QUOTE_ACCEPTED },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        createdAt: true,
        estimate: {
          select: {
            id: true,
            number: true,
            title: true,
            client: { select: { companyName: true } },
          },
        },
      },
    }),
    db.estimateTimelineEvent.findMany({
      where: { tenantId, kind: EstimateTimelineKind.QUOTE_DECLINED },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        createdAt: true,
        estimate: {
          select: {
            id: true,
            number: true,
            title: true,
            client: { select: { companyName: true } },
          },
        },
      },
    }),
    db.estimate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: EstimateStatus.SENT,
        quoteLinks: {
          some: {
            tenantId,
            revokedAt: null,
            respondedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        number: true,
        title: true,
        updatedAt: true,
        client: { select: { companyName: true } },
        quoteLinks: {
          where: {
            tenantId,
            revokedAt: null,
            respondedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
  ]);

  const acceptedMapped = acceptedRaw.map((r) => ({
    estimateId: r.estimate.id,
    number: r.estimate.number,
    title: r.estimate.title,
    clientCompanyName: r.estimate.client.companyName,
    sortAt: r.createdAt,
  }));

  const declinedMapped = declinedRaw.map((r) => ({
    estimateId: r.estimate.id,
    number: r.estimate.number,
    title: r.estimate.title,
    clientCompanyName: r.estimate.client.companyName,
    sortAt: r.createdAt,
  }));

  const awaitingMapped = awaitingEstimates.map((e) => ({
    estimateId: e.id,
    number: e.number,
    title: e.title,
    clientCompanyName: e.client.companyName,
    sortAt: e.quoteLinks[0]?.createdAt ?? e.updatedAt,
  }));

  return {
    recentlyAccepted: dedupeEstimateRowsByFirstOccurrence(acceptedMapped, 6),
    recentlyDeclined: dedupeEstimateRowsByFirstOccurrence(declinedMapped, 6),
    awaitingCustomerResponse: awaitingMapped,
  };
}

import {
  prisma,
  POReconciliationLineMatch,
  POReconciliationStatus,
} from '@bvisible/db';
import { deriveAggregateStatus } from './match';

function isPairedMatch(m: POReconciliationLineMatch): boolean {
  return (
    m === POReconciliationLineMatch.MATCHED ||
    m === POReconciliationLineMatch.PRICE_VARIANCE ||
    m === POReconciliationLineMatch.QTY_VARIANCE ||
    m === POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE
  );
}

export async function refreshPoReconciliationAggregate(args: {
  tenantId: string;
  poReconciliationId: string;
}): Promise<void> {
  const lines = await prisma.pOReconciliationLine.findMany({
    where: {
      tenantId: args.tenantId,
      poReconciliationId: args.poReconciliationId,
    },
    select: {
      match: true,
      observedQtyMilli: true,
    },
    orderBy: { sortOrder: 'asc' },
  });

  const summaries = lines.map((l) => ({
    match: l.match,
    missingReceiptQty:
      isPairedMatch(l.match) && l.observedQtyMilli === null,
  }));

  const agg = deriveAggregateStatus(summaries);

  const reconStatus =
    agg === 'MATCHED'
      ? POReconciliationStatus.MATCHED
      : agg === 'PARTIAL'
        ? POReconciliationStatus.PARTIAL
        : agg === 'VARIANCE'
          ? POReconciliationStatus.VARIANCE
          : agg === 'REVIEW_REQUIRED'
            ? POReconciliationStatus.REVIEW_REQUIRED
            : POReconciliationStatus.PENDING;

  const recon = await prisma.pOReconciliation.findFirst({
    where: { id: args.poReconciliationId, tenantId: args.tenantId },
    select: { summary: true },
  });

  const prevSummary =
    recon?.summary &&
    typeof recon.summary === 'object' &&
    recon.summary !== null &&
    !Array.isArray(recon.summary)
      ? (recon.summary as Record<string, unknown>)
      : {};

  await prisma.pOReconciliation.updateMany({
    where: {
      id: args.poReconciliationId,
      tenantId: args.tenantId,
    },
    data: {
      status: reconStatus,
      summary: {
        ...prevSummary,
        aggregate: agg,
        recomputedAt: new Date().toISOString(),
      },
    },
  });
}

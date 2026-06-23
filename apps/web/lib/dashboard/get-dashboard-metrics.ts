import {
  EmailIngestStatus,
  EstimateStatus,
  OcrJobStatus,
  POReconciliationLineMatch,
  POReconciliationStatus,
  POStatus,
  prisma,
} from '@bvisible/db';

export interface DashboardSeriesPoint {
  label: string;
  value: number;
}

export interface DashboardNamedValue {
  label: string;
  value: number;
}

export interface DashboardMetrics {
  clientCount: number;
  openEstimates: number;
  openPurchaseOrders: number;
  vendorPriceAlertsOpen: number;
  pendingOcrReviews: number;
  unreconciledPurchaseOrders: number;
  emailIngestion: {
    emailsToday: number;
    processed: number;
    failed: number;
    successRate: number;
    avgProcessingMs: number | null;
    series: DashboardSeriesPoint[];
  };
  receiptOcr: {
    processed: number;
    waitingReview: number;
    rejected: number;
    failed: number;
    successRate: number;
    series: DashboardSeriesPoint[];
  };
  poReconciliation: {
    matched: number;
    waitingReview: number;
    priceMismatches: number;
    quantityMismatches: number;
    matchRate: number;
    series: DashboardSeriesPoint[];
  };
  workflowPipeline: DashboardNamedValue[];
  vendorPriceChanges: {
    increases: number;
    decreases: number;
    largestIncreasePct: number | null;
    largestIncreaseLabel: string | null;
    largestDecreasePct: number | null;
    largestDecreaseLabel: string | null;
    series: Array<{ label: string; increases: number; decreases: number }>;
  };
  estimatePerformance: {
    createdLast30: number;
    createdPrevious30: number;
    approvalRate: number;
    revenuePipelineCents: number;
    series: DashboardSeriesPoint[];
    statusBreakdown: DashboardNamedValue[];
    revenueByStatus: DashboardNamedValue[];
  };
  recentActivity: DashboardAuditRow[];
}

export interface DashboardAuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  userId: string | null;
  createdAt: Date;
  actorLabel: string | null;
}

export async function getDashboardMetrics(
  tenantId: string,
  opts: { includeOperatorMetrics: boolean },
): Promise<DashboardMetrics> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const last14Start = daysAgo(13, todayStart);
  const last28Start = daysAgo(27, todayStart);
  const last30Start = daysAgo(29, todayStart);
  const previous30Start = daysAgo(59, todayStart);
  const priceWindowStart = daysAgo(60, todayStart);

  const [
    clientCount,
    openEstimates,
    openPurchaseOrders,
    vendorPriceAlertsOpen,
    unreconciledPurchaseOrders,
    pendingOcrReviews,
    emailRows,
    emailRuns,
    ocrRows,
    reconciliationRows,
    reconciliationLineRows,
    priceHistoryRows,
    estimateRows,
    purchaseOrderMatchedCount,
    auditRows,
  ] = await Promise.all([
    prisma.client.count({ where: { tenantId, deletedAt: null } }),
    prisma.estimate.count({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: [EstimateStatus.DRAFT, EstimateStatus.SENT, EstimateStatus.APPROVED] },
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        deletedAt: null,
        status: {
          in: [
            POStatus.DRAFT,
            POStatus.SENT,
            POStatus.ORDERED,
            POStatus.PARTIALLY_RECEIVED,
          ],
        },
      },
    }),
    prisma.vendorPriceNotification.count({
      where: { tenantId, dismissedAt: null },
    }),
    opts.includeOperatorMetrics
      ? prisma.purchaseOrder.count({
          where: {
            tenantId,
            deletedAt: null,
            operatorMarkedReconciledAt: null,
            reconciliations: {
              some: {
                status: {
                  notIn: [POReconciliationStatus.MATCHED, POReconciliationStatus.RESOLVED],
                },
              },
            },
          },
        })
      : Promise.resolve(0),
    opts.includeOperatorMetrics
      ? prisma.ocrDocument.count({
          where: {
            tenantId,
            status: {
              in: [
                OcrJobStatus.REVIEW_REQUIRED,
                OcrJobStatus.PENDING,
                OcrJobStatus.PROCESSING,
              ],
            },
          },
        })
      : Promise.resolve(0),
    prisma.ingestedEmail.findMany({
      where: { tenantId, createdAt: { gte: last14Start } },
      select: { status: true, createdAt: true, processedAt: true },
    }),
    prisma.emailIngestRun.findMany({
      where: { tenantId, startedAt: { gte: last14Start } },
      select: { startedAt: true, ingestedCount: true, matchedCount: true, errorCount: true, durationMs: true },
    }),
    prisma.ocrDocument.findMany({
      where: { tenantId, createdAt: { gte: last14Start } },
      select: { status: true, createdAt: true },
    }),
    prisma.pOReconciliation.findMany({
      where: { tenantId, createdAt: { gte: last28Start } },
      select: { status: true, createdAt: true },
    }),
    prisma.pOReconciliationLine.findMany({
      where: { tenantId, poReconciliation: { createdAt: { gte: last28Start } } },
      select: { match: true },
    }),
    prisma.vendorPriceHistory.findMany({
      where: { tenantId, createdAt: { gte: priceWindowStart } },
      orderBy: [{ vendorCatalogItemId: 'asc' }, { createdAt: 'asc' }],
      select: {
        vendorCatalogItemId: true,
        priceCents: true,
        createdAt: true,
        catalogItem: { select: { nameNormalized: true } },
      },
    }),
    prisma.estimate.findMany({
      where: { tenantId, deletedAt: null, createdAt: { gte: previous30Start } },
      select: { status: true, finalPriceCents: true, createdAt: true },
    }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        deletedAt: null,
        operatorMarkedReconciledAt: { not: null },
        updatedAt: { gte: last30Start },
      },
    }),
    prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        userId: true,
        createdAt: true,
      },
    }),
  ]);

  const userIds = [...new Set(auditRows.map((r) => r.userId).filter(Boolean))] as string[];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const recentActivity: DashboardAuditRow[] = auditRows.map((r) => {
    const u = r.userId ? userById.get(r.userId) : undefined;
    const actorLabel = u ? (u.name || u.email.split('@')[0] || u.email) : null;
    return { ...r, actorLabel };
  });

  const emailProcessedStatuses = new Set<EmailIngestStatus>([
    EmailIngestStatus.MATCHED,
    EmailIngestStatus.UNMATCHED,
    EmailIngestStatus.DISMISSED,
  ]);
  const emailProcessed = emailRows.filter((row) => emailProcessedStatuses.has(row.status)).length;
  const emailFailed = emailRows.filter((row) => row.status === EmailIngestStatus.FAILED).length;
  const emailTotal = emailRows.length;
  const avgProcessingSamples = emailRuns
    .map((row) => row.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const ocrProcessed = ocrRows.filter((row) => row.status === OcrJobStatus.CONFIRMED).length;
  const ocrWaitingStatuses = new Set<OcrJobStatus>([
    OcrJobStatus.PENDING,
    OcrJobStatus.PROCESSING,
    OcrJobStatus.REVIEW_REQUIRED,
  ]);
  const ocrWaiting = ocrRows.filter((row) => ocrWaitingStatuses.has(row.status)).length;
  const ocrRejected = ocrRows.filter((row) => row.status === OcrJobStatus.REJECTED).length;
  const ocrFailed = ocrRows.filter((row) => row.status === OcrJobStatus.FAILED).length;

  const reconciliationMatchedStatuses = new Set<POReconciliationStatus>([
    POReconciliationStatus.MATCHED,
    POReconciliationStatus.RESOLVED,
  ]);
  const reconciliationWaitingStatuses = new Set<POReconciliationStatus>([
    POReconciliationStatus.PENDING,
    POReconciliationStatus.PARTIAL,
    POReconciliationStatus.REVIEW_REQUIRED,
  ]);
  const priceMismatchKinds = new Set<POReconciliationLineMatch>([
    POReconciliationLineMatch.PRICE_VARIANCE,
    POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE,
  ]);
  const quantityMismatchKinds = new Set<POReconciliationLineMatch>([
    POReconciliationLineMatch.QTY_VARIANCE,
    POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE,
  ]);
  const reconciliationMatched = reconciliationRows.filter((row) => reconciliationMatchedStatuses.has(row.status)).length;
  const reconciliationWaiting = reconciliationRows.filter((row) => reconciliationWaitingStatuses.has(row.status)).length;
  const priceMismatches = reconciliationLineRows.filter((row) => priceMismatchKinds.has(row.match)).length;
  const quantityMismatches = reconciliationLineRows.filter((row) => quantityMismatchKinds.has(row.match)).length;

  const priceChanges = buildVendorPriceChanges(priceHistoryRows, last30Start);
  const estimatesLast30 = estimateRows.filter((row) => row.createdAt >= last30Start);
  const estimatesPrevious30 = estimateRows.filter((row) => row.createdAt < last30Start);
  const approvedEstimateStatuses = new Set<EstimateStatus>([EstimateStatus.APPROVED, EstimateStatus.FINALIZED]);
  const approvedLast30 = estimatesLast30.filter((row) => approvedEstimateStatuses.has(row.status)).length;
  const revenueStatuses = [
    EstimateStatus.DRAFT,
    EstimateStatus.SENT,
    EstimateStatus.APPROVED,
    EstimateStatus.FINALIZED,
  ];

  return {
    clientCount,
    openEstimates,
    openPurchaseOrders,
    vendorPriceAlertsOpen,
    pendingOcrReviews,
    unreconciledPurchaseOrders,
    emailIngestion: {
      emailsToday: emailRows.filter((row) => row.createdAt >= todayStart).length,
      processed: emailProcessed,
      failed: emailFailed,
      successRate: percent(emailProcessed, Math.max(emailTotal, 1)),
      avgProcessingMs: avgProcessingSamples.length
        ? Math.round(avgProcessingSamples.reduce((sum, value) => sum + value, 0) / avgProcessingSamples.length)
        : null,
      series: dailySeries(14, todayStart, emailRows, (row) => row.createdAt),
    },
    receiptOcr: {
      processed: ocrProcessed,
      waitingReview: ocrWaiting,
      rejected: ocrRejected,
      failed: ocrFailed,
      successRate: percent(ocrProcessed, Math.max(ocrRows.length, 1)),
      series: dailySeries(14, todayStart, ocrRows, (row) => row.createdAt),
    },
    poReconciliation: {
      matched: reconciliationMatched,
      waitingReview: reconciliationWaiting,
      priceMismatches,
      quantityMismatches,
      matchRate: percent(reconciliationMatched, Math.max(reconciliationRows.length, 1)),
      series: weeklySeries(4, todayStart, reconciliationRows, (row) => row.createdAt),
    },
    workflowPipeline: [
      { label: 'Email ingestion', value: emailProcessed },
      { label: 'OCR queue', value: ocrProcessed + ocrWaiting },
      { label: 'Review', value: ocrWaiting + reconciliationWaiting },
      { label: 'PO matched', value: reconciliationMatched + purchaseOrderMatchedCount },
      { label: 'Vendor updated', value: priceHistoryRows.filter((row) => row.createdAt >= last30Start).length },
    ],
    vendorPriceChanges: priceChanges,
    estimatePerformance: {
      createdLast30: estimatesLast30.length,
      createdPrevious30: estimatesPrevious30.length,
      approvalRate: percent(approvedLast30, Math.max(estimatesLast30.length, 1)),
      revenuePipelineCents: estimatesLast30.reduce((sum, row) => sum + row.finalPriceCents, 0),
      series: dailySeries(30, todayStart, estimatesLast30, (row) => row.createdAt),
      statusBreakdown: [
        { label: 'Approved', value: approvedLast30 },
        { label: 'Sent', value: estimatesLast30.filter((row) => row.status === EstimateStatus.SENT).length },
        { label: 'Draft', value: estimatesLast30.filter((row) => row.status === EstimateStatus.DRAFT).length },
      ],
      revenueByStatus: revenueStatuses.map((status) => ({
        label: statusLabel(status),
        value: estimatesLast30
          .filter((row) => row.status === status)
          .reduce((sum, row) => sum + row.finalPriceCents, 0),
      })),
    },
    recentActivity,
  };
}

function buildVendorPriceChanges(
  rows: Array<{
    vendorCatalogItemId: string;
    priceCents: number;
    createdAt: Date;
    catalogItem: { nameNormalized: string };
  }>,
  windowStart: Date,
): DashboardMetrics['vendorPriceChanges'] {
  const changes: Array<{ createdAt: Date; pct: number; label: string }> = [];
  const byItem = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byItem.get(row.vendorCatalogItemId) ?? [];
    bucket.push(row);
    byItem.set(row.vendorCatalogItemId, bucket);
  }

  for (const itemRows of byItem.values()) {
    for (let index = 1; index < itemRows.length; index += 1) {
      const previous = itemRows[index - 1]!;
      const current = itemRows[index]!;
      if (current.createdAt < windowStart || previous.priceCents <= 0) continue;
      const pct = ((current.priceCents - previous.priceCents) / previous.priceCents) * 100;
      if (pct !== 0) changes.push({ createdAt: current.createdAt, pct, label: titleCase(current.catalogItem.nameNormalized) });
    }
  }

  const increases = changes.filter((change) => change.pct > 0);
  const decreases = changes.filter((change) => change.pct < 0);
  const largestIncrease = increases.sort((a, b) => b.pct - a.pct)[0] ?? null;
  const largestDecrease = decreases.sort((a, b) => a.pct - b.pct)[0] ?? null;

  return {
    increases: increases.length,
    decreases: decreases.length,
    largestIncreasePct: largestIncrease?.pct ?? null,
    largestIncreaseLabel: largestIncrease?.label ?? null,
    largestDecreasePct: largestDecrease ? Math.abs(largestDecrease.pct) : null,
    largestDecreaseLabel: largestDecrease?.label ?? null,
    series: vendorChangeSeries(30, new Date(), changes),
  };
}

function dailySeries<T>(
  days: number,
  todayStart: Date,
  rows: T[],
  getDate: (row: T) => Date,
): DashboardSeriesPoint[] {
  return Array.from({ length: days }, (_, offset) => {
    const start = daysAgo(days - 1 - offset, todayStart);
    const end = daysAgo(days - 2 - offset, todayStart);
    return {
      label: shortDay(start),
      value: rows.filter((row) => {
        const d = getDate(row);
        return d >= start && d < end;
      }).length,
    };
  });
}

function weeklySeries<T>(
  weeks: number,
  todayStart: Date,
  rows: T[],
  getDate: (row: T) => Date,
): DashboardSeriesPoint[] {
  return Array.from({ length: weeks }, (_, offset) => {
    const start = daysAgo((weeks - 1 - offset) * 7, todayStart);
    const end = daysAgo((weeks - 2 - offset) * 7, todayStart);
    return {
      label: `${shortDay(start)} - ${shortDay(daysAgo(-6, start))}`,
      value: rows.filter((row) => {
        const d = getDate(row);
        return d >= start && d < end;
      }).length,
    };
  });
}

function vendorChangeSeries(
  days: number,
  now: Date,
  changes: Array<{ createdAt: Date; pct: number }>,
): Array<{ label: string; increases: number; decreases: number }> {
  const todayStart = startOfDay(now);
  return Array.from({ length: 6 }, (_, index) => {
    const bucketStart = daysAgo(days - index * 5 - 1, todayStart);
    const bucketEnd = daysAgo(days - (index + 1) * 5 - 1, todayStart);
    const bucket = changes.filter((change) => change.createdAt >= bucketStart && change.createdAt < bucketEnd);
    return {
      label: shortDay(bucketStart),
      increases: bucket.filter((change) => change.pct > 0).length,
      decreases: bucket.filter((change) => change.pct < 0).length,
    };
  });
}

function percent(part: number, total: number): number {
  return total <= 0 ? 0 : Math.round((part / total) * 100);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysAgo(days: number, from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d;
}

function shortDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusLabel(status: EstimateStatus): string {
  switch (status) {
    case EstimateStatus.DRAFT:
      return 'Draft';
    case EstimateStatus.SENT:
      return 'Sent';
    case EstimateStatus.APPROVED:
      return 'Approved';
    case EstimateStatus.FINALIZED:
      return 'In Production';
    case EstimateStatus.REJECTED:
      return 'Rejected';
  }
}

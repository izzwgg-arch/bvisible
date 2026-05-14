import {
  EstimateStatus,
  OcrJobStatus,
  POReconciliationStatus,
  POStatus,
  prisma,
} from '@bvisible/db';

export interface DashboardMetrics {
  clientCount: number;
  openEstimates: number;
  openPurchaseOrders: number;
  vendorPriceAlertsOpen: number;
  pendingOcrReviews: number;
  unreconciledPurchaseOrders: number;
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
  const [
    clientCount,
    openEstimates,
    openPurchaseOrders,
    vendorPriceAlertsOpen,
    unreconciledPurchaseOrders,
    pendingOcrReviews,
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
    prisma.purchaseOrder.count({
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
    }),
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

  return {
    clientCount,
    openEstimates,
    openPurchaseOrders,
    vendorPriceAlertsOpen,
    pendingOcrReviews,
    unreconciledPurchaseOrders,
    recentActivity,
  };
}

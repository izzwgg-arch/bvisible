import type { PrismaClient } from '@bvisible/db';
import {
  EstimateStatus,
  EstimateTimelineKind,
  POReconciliationStatus,
  prisma,
} from '@bvisible/db';

import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';

export type EstimatePoFlowDb = Pick<PrismaClient, 'estimate' | 'purchaseOrder'>;

export interface EstimatePoFlowRow {
  estimateId: string;
  number: string;
  title: string;
  clientCompanyName: string;
  sortAt: Date;
}

export interface RecentPoFromEstimateRow {
  poId: string;
  poNumber: string;
  createdAt: Date;
  estimateId: string;
  estimateNumber: string;
  title: string;
  clientCompanyName: string;
}

export interface EstimatePoReconAttentionRow {
  poId: string;
  poNumber: string;
  estimateId: string;
  estimateNumber: string;
  reconStatus: POReconciliationStatus;
  sortAt: Date;
}

export interface DashboardEstimatePoFlow {
  acceptedAwaitingPo: EstimatePoFlowRow[];
  recentPosFromEstimates: RecentPoFromEstimateRow[];
  approvedWithLinkedPo: EstimatePoFlowRow[];
  estimateLinkedPoReconciliationAttention: EstimatePoReconAttentionRow[];
}

export async function getDashboardEstimatePoFlow(
  tenantId: string,
  db: EstimatePoFlowDb = prisma
): Promise<DashboardEstimatePoFlow> {
  const [
    acceptedAwaitingRaw,
    recentPosRaw,
    approvedWithPoRaw,
    reconAttentionCandidates,
  ] = await Promise.all([
    db.estimate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: EstimateStatus.APPROVED,
        purchaseOrders: { none: { tenantId, deletedAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        number: true,
        title: true,
        updatedAt: true,
        client: { select: { companyName: true } },
        timelineEvents: {
          where: { tenantId, kind: EstimateTimelineKind.QUOTE_ACCEPTED },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    db.purchaseOrder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        estimateId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        number: true,
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
        status: EstimateStatus.APPROVED,
        purchaseOrders: { some: { tenantId, deletedAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        number: true,
        title: true,
        updatedAt: true,
        client: { select: { companyName: true } },
        timelineEvents: {
          where: { tenantId, kind: EstimateTimelineKind.QUOTE_ACCEPTED },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    db.purchaseOrder.findMany({
      where: {
        tenantId,
        deletedAt: null,
        estimateId: { not: null },
      },
      select: {
        id: true,
        number: true,
        estimateId: true,
        reconciliations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, updatedAt: true },
        },
        estimate: { select: { number: true } },
      },
      take: 80,
    }),
  ]);

  const acceptedAwaitingPo: EstimatePoFlowRow[] = acceptedAwaitingRaw.map((e) => ({
    estimateId: e.id,
    number: e.number,
    title: e.title,
    clientCompanyName: e.client.companyName,
    sortAt: e.timelineEvents[0]?.createdAt ?? e.updatedAt,
  }));

  const recentPosFromEstimates: RecentPoFromEstimateRow[] = recentPosRaw
    .filter((p): p is typeof p & { estimate: NonNullable<(typeof p)['estimate']> } => p.estimate != null)
    .map((p) => ({
      poId: p.id,
      poNumber: p.number,
      createdAt: p.createdAt,
      estimateId: p.estimate.id,
      estimateNumber: p.estimate.number,
      title: p.estimate.title,
      clientCompanyName: p.estimate.client.companyName,
    }));

  const approvedWithLinkedPo: EstimatePoFlowRow[] = approvedWithPoRaw.map((e) => ({
    estimateId: e.id,
    number: e.number,
    title: e.title,
    clientCompanyName: e.client.companyName,
    sortAt: e.timelineEvents[0]?.createdAt ?? e.updatedAt,
  }));

  const estimateLinkedPoReconciliationAttention: EstimatePoReconAttentionRow[] = [];
  for (const p of reconAttentionCandidates) {
    if (!p.estimateId || !p.estimate) continue;
    const latest = p.reconciliations[0];
    if (!latest || !reconciliationNeedsAttention(latest.status)) continue;
    estimateLinkedPoReconciliationAttention.push({
      poId: p.id,
      poNumber: p.number,
      estimateId: p.estimateId,
      estimateNumber: p.estimate.number,
      reconStatus: latest.status,
      sortAt: latest.updatedAt,
    });
  }
  estimateLinkedPoReconciliationAttention.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
  const cappedAttention = estimateLinkedPoReconciliationAttention.slice(0, 8);

  return {
    acceptedAwaitingPo: acceptedAwaitingPo.slice(0, 8),
    recentPosFromEstimates: recentPosFromEstimates.slice(0, 8),
    approvedWithLinkedPo: approvedWithLinkedPo.slice(0, 8),
    estimateLinkedPoReconciliationAttention: cappedAttention,
  };
}

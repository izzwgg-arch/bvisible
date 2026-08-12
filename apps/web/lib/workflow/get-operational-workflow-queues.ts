import type { PrismaClient } from '@bvisible/db';
import {
  EmailIngestStatus,
  EstimateStatus,
  EstimateTimelineKind,
  OcrJobStatus,
  POEventKind,
  POReconciliationStatus,
  POStatus,
  prisma,
} from '@bvisible/db';
import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';
import {
  evaluateEstimateFinalizeGates,
  POTENTIALLY_READY_LABEL,
} from '@/lib/estimate/estimate-finalization';
import {
  bucketForWorkflowState,
  OPERATIONAL_QUEUE_BUCKET_ORDER,
  type OperationalQueueBucket,
  type OperationalWorkflowState,
} from './operational-matrix';
import { staleAgeLabel } from './operational-stale';
import {
  getOperationalAttentionReason,
  getOperationalNextAction,
  getOperationalWorkflowState,
  isOperationalBlocked,
  isOperationalStale,
  isOperationalUnresolved,
  WORKFLOW_STATE_LABELS,
} from './operational-state';

export type OperationalQueueEntityType =
  | 'estimate'
  | 'purchase_order'
  | 'ocr_document'
  | 'ingested_email';

export interface OperationalQueueItem {
  id: string;
  bucket: OperationalQueueBucket;
  workflowState: OperationalWorkflowState;
  entityType: OperationalQueueEntityType;
  entityId: string;
  title: string;
  subtitle: string;
  customerLabel: string | null;
  blockerReason: string;
  nextActionLabel: string;
  href: string;
  sortAt: Date;
  referenceAt: Date;
  isStale: boolean;
  staleLabel: string | null;
  isBlocked: boolean;
  isUnresolved: boolean;
  ownerUserId: string | null;
  /** When set, overrides WORKFLOW_STATE_LABELS for display (e.g. heuristic queue rows). */
  workflowStateLabel?: string;
}

export type OperationalQueueFilter = 'all' | 'stale' | 'blocked' | 'unresolved' | 'mine';

export interface OperationalWorkflowQueues {
  sections: Record<OperationalQueueBucket, OperationalQueueItem[]>;
  totalActionable: number;
}

export type OperationalQueuesDb = Pick<
  PrismaClient,
  | 'estimate'
  | 'purchaseOrder'
  | 'ocrDocument'
  | 'ingestedEmail'
  | 'spendAlert'
>;

const OPEN_PO_STATUSES: POStatus[] = [
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
];

export async function getOperationalWorkflowQueues(
  tenantId: string,
  opts: {
    now?: Date;
    filter?: OperationalQueueFilter;
    currentUserId?: string | null;
    includeOperatorQueues?: boolean;
  },
  db: OperationalQueuesDb = prisma,
): Promise<OperationalWorkflowQueues> {
  const now = opts.now ?? new Date();
  const filter = opts.filter ?? 'all';
  const includeOperator = opts.includeOperatorQueues !== false;
  const items: OperationalQueueItem[] = [];

  const [
    awaitingEstimates,
    approvedNoPo,
    readyToFinalizeCandidates,
    waitingVendorPos,
    ocrReviewDocs,
    reconAttentionPos,
    reconSnapshotPos,
    unmatchedEmails,
    recentlyFinalized,
    recentlyReconciledPos,
  ] = await Promise.all([
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
      take: 12,
      select: {
        id: true,
        number: true,
        title: true,
        createdById: true,
        updatedAt: true,
        client: { select: { companyName: true } },
        quoteLinks: {
          where: {
            tenantId,
            revokedAt: null,
            respondedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    db.estimate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: EstimateStatus.APPROVED,
        purchaseOrders: { none: { tenantId, deletedAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        number: true,
        title: true,
        createdById: true,
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
    db.estimate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: EstimateStatus.APPROVED,
        purchaseOrders: { some: { tenantId, deletedAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        number: true,
        title: true,
        createdById: true,
        updatedAt: true,
        client: { select: { companyName: true } },
        purchaseOrders: {
          where: { tenantId, deletedAt: null },
          select: {
            id: true,
            number: true,
            qboPoNumber: true,
            reconciliations: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    }),
    includeOperator
      ? db.purchaseOrder.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: { in: OPEN_PO_STATUSES },
            events: { none: { tenantId, kind: POEventKind.VENDOR_REPLY } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 12,
          select: {
            id: true,
            number: true,
            notes: true,
            createdById: true,
            updatedAt: true,
            vendor: { select: { name: true } },
            estimate: { select: { client: { select: { companyName: true } } } },
          },
        })
      : Promise.resolve([]),
    includeOperator
      ? db.ocrDocument.findMany({
          where: { tenantId, status: OcrJobStatus.REVIEW_REQUIRED },
          orderBy: { updatedAt: 'desc' },
          take: 12,
          select: {
            id: true,
            updatedAt: true,
            poAttachment: {
              select: {
                purchaseOrder: {
                  select: {
                    id: true,
                    number: true,
                    createdById: true,
                    vendor: { select: { name: true } },
                    estimate: { select: { client: { select: { companyName: true } } } },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    includeOperator
      ? db.purchaseOrder.findMany({
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
          orderBy: { updatedAt: 'desc' },
          take: 12,
          select: {
            id: true,
            number: true,
            createdById: true,
            updatedAt: true,
            vendor: { select: { name: true } },
            estimate: {
              select: {
                id: true,
                number: true,
                client: { select: { companyName: true } },
              },
            },
            reconciliations: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, updatedAt: true },
            },
          },
        })
      : Promise.resolve([]),
    includeOperator
      ? db.purchaseOrder.findMany({
          where: {
            tenantId,
            deletedAt: null,
            operatorMarkedReconciledAt: null,
            attachments: {
              some: { ocrDocument: { status: OcrJobStatus.CONFIRMED } },
            },
            reconciliations: { none: {} },
          },
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: {
            id: true,
            number: true,
            createdById: true,
            updatedAt: true,
            vendor: { select: { name: true } },
            estimate: { select: { client: { select: { companyName: true } } } },
          },
        })
      : Promise.resolve([]),
    includeOperator
      ? db.ingestedEmail.findMany({
          where: {
            tenantId,
            status: { in: [EmailIngestStatus.UNMATCHED, EmailIngestStatus.PENDING] },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    db.estimate.findMany({
      where: { tenantId, deletedAt: null, status: EstimateStatus.FINALIZED },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        number: true,
        title: true,
        updatedAt: true,
        client: { select: { companyName: true } },
      },
    }),
    includeOperator
      ? db.purchaseOrder.findMany({
          where: {
            tenantId,
            deletedAt: null,
            operatorMarkedReconciledAt: { not: null },
          },
          orderBy: { operatorMarkedReconciledAt: 'desc' },
          take: 5,
          select: {
            id: true,
            number: true,
            operatorMarkedReconciledAt: true,
            vendor: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const seenKeys = new Set<string>();

  const push = (item: OperationalQueueItem) => {
    if (seenKeys.has(item.id)) return;
    if (filter === 'mine' && opts.currentUserId && item.ownerUserId !== opts.currentUserId) {
      return;
    }
    if (filter === 'stale' && !item.isStale) return;
    if (filter === 'blocked' && !item.isBlocked) return;
    if (filter === 'unresolved' && !item.isUnresolved) return;
    seenKeys.add(item.id);
    items.push(item);
  };

  const buildItem = (params: {
    id: string;
    state: OperationalWorkflowState;
    entityType: OperationalQueueEntityType;
    entityId: string;
    title: string;
    subtitle: string;
    customerLabel: string | null;
    referenceAt: Date;
    sortAt: Date;
    ownerUserId: string | null;
    estimateId?: string | null;
    poId?: string | null;
    ocrDocumentId?: string | null;
    blockerReason?: string;
    workflowStateLabel?: string;
  }): OperationalQueueItem => {
    const next = getOperationalNextAction({
      state: params.state,
      estimateId: params.estimateId,
      poId: params.poId,
      ocrDocumentId: params.ocrDocumentId,
    });
    const stale = isOperationalStale({
      state: params.state,
      referenceAt: params.referenceAt,
      now,
    });
    return {
      id: params.id,
      bucket: bucketForWorkflowState(params.state),
      workflowState: params.state,
      entityType: params.entityType,
      entityId: params.entityId,
      title: params.title,
      subtitle: params.subtitle,
      customerLabel: params.customerLabel,
      blockerReason: params.blockerReason ?? getOperationalAttentionReason(params.state),
      nextActionLabel: next.label,
      href: next.href,
      sortAt: params.sortAt,
      referenceAt: params.referenceAt,
      isStale: stale,
      staleLabel: stale ? staleAgeLabel(params.referenceAt, now) : null,
      isBlocked: isOperationalBlocked(params.state),
      isUnresolved: isOperationalUnresolved(params.state),
      ownerUserId: params.ownerUserId,
      workflowStateLabel: params.workflowStateLabel,
    };
  };

  for (const e of awaitingEstimates) {
    const ref = e.quoteLinks[0]?.createdAt ?? e.updatedAt;
    push(
      buildItem({
        id: `est-awaiting-${e.id}`,
        state: 'awaiting_customer',
        entityType: 'estimate',
        entityId: e.id,
        title: e.number,
        subtitle: e.title,
        customerLabel: e.client.companyName,
        referenceAt: ref,
        sortAt: ref,
        ownerUserId: e.createdById,
        estimateId: e.id,
      }),
    );
  }

  for (const e of approvedNoPo) {
    const ref = e.timelineEvents[0]?.createdAt ?? e.updatedAt;
    push(
      buildItem({
        id: `est-no-po-${e.id}`,
        state: 'approved_waiting_po',
        entityType: 'estimate',
        entityId: e.id,
        title: e.number,
        subtitle: e.title,
        customerLabel: e.client.companyName,
        referenceAt: ref,
        sortAt: ref,
        ownerUserId: e.createdById,
        estimateId: e.id,
      }),
    );
  }

  for (const e of readyToFinalizeCandidates) {
    const pos = e.purchaseOrders;
    if (pos.length === 0) continue;
    const linkedPos = pos.map((p) => ({
      id: p.id,
      number: p.number,
      qboPoNumber: p.qboPoNumber,
      latestReconciliationStatus: p.reconciliations[0]?.status ?? null,
    }));
    const allQbo = linkedPos.every((p) => p.qboPoNumber?.trim());
    if (!allQbo) continue;

    const gates = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPos,
    });
    if (
      !gates.canFinalize &&
      gates.kind !== 'reconciliation_unresolved'
    ) {
      continue;
    }

    const state = getOperationalWorkflowState({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: pos.length,
      allLinkedPosHaveQbo: true,
      finalized: false,
    });
    if (state !== 'ready_to_finalize') continue;

    const potentiallyReady = !gates.canFinalize;
    push(
      buildItem({
        id: `est-finalize-${e.id}`,
        state: 'ready_to_finalize',
        entityType: 'estimate',
        entityId: e.id,
        title: e.number,
        subtitle: potentiallyReady ? POTENTIALLY_READY_LABEL : e.title,
        customerLabel: e.client.companyName,
        referenceAt: e.updatedAt,
        sortAt: e.updatedAt,
        ownerUserId: e.createdById,
        estimateId: e.id,
        blockerReason: potentiallyReady
          ? (gates.blockedReason ?? POTENTIALLY_READY_LABEL)
          : undefined,
        workflowStateLabel: potentiallyReady ? 'Potentially ready' : undefined,
      }),
    );
  }

  for (const po of waitingVendorPos) {
    push(
      buildItem({
        id: `po-vendor-${po.id}`,
        state: 'waiting_vendor_reply',
        entityType: 'purchase_order',
        entityId: po.id,
        title: po.number,
        subtitle: po.vendor?.name ?? 'No vendor',
        customerLabel: po.estimate?.client.companyName ?? null,
        referenceAt: po.updatedAt,
        sortAt: po.updatedAt,
        ownerUserId: po.createdById,
        poId: po.id,
        estimateId: null,
      }),
    );
  }

  for (const doc of ocrReviewDocs) {
    const po = doc.poAttachment?.purchaseOrder;
    if (!po) continue;
    push(
      buildItem({
        id: `ocr-${doc.id}`,
        state: 'ocr_review_needed',
        entityType: 'ocr_document',
        entityId: doc.id,
        title: po.number,
        subtitle: WORKFLOW_STATE_LABELS.ocr_review_needed,
        customerLabel: po.estimate?.client.companyName ?? null,
        referenceAt: doc.updatedAt,
        sortAt: doc.updatedAt,
        ownerUserId: po.createdById,
        poId: po.id,
        ocrDocumentId: doc.id,
      }),
    );
  }

  for (const po of reconSnapshotPos) {
    push(
      buildItem({
        id: `po-recon-snap-${po.id}`,
        state: 'recon_snapshot_needed',
        entityType: 'purchase_order',
        entityId: po.id,
        title: po.number,
        subtitle: po.vendor?.name ?? 'Receipt approved',
        customerLabel: po.estimate?.client.companyName ?? null,
        referenceAt: po.updatedAt,
        sortAt: po.updatedAt,
        ownerUserId: po.createdById,
        poId: po.id,
      }),
    );
  }

  for (const po of reconAttentionPos) {
    const latest = po.reconciliations[0];
    if (!latest || !reconciliationNeedsAttention(latest.status)) continue;
    if (seenKeys.has(`po-recon-snap-${po.id}`)) continue;
    push(
      buildItem({
        id: `po-variance-${po.id}`,
        state: 'variance_detected',
        entityType: 'purchase_order',
        entityId: po.id,
        title: po.number,
        subtitle: po.estimate
          ? `Estimate ${po.estimate.number}`
          : (po.vendor?.name ?? 'Reconciliation'),
        customerLabel: po.estimate?.client.companyName ?? null,
        referenceAt: latest.updatedAt,
        sortAt: latest.updatedAt,
        ownerUserId: po.createdById,
        poId: po.id,
        estimateId: po.estimate?.id,
      }),
    );
  }

  for (const mail of unmatchedEmails) {
    push(
      buildItem({
        id: `email-${mail.id}`,
        state: 'unmatched_email',
        entityType: 'ingested_email',
        entityId: mail.id,
        title: mail.subject?.slice(0, 80) || 'Inbound message',
        subtitle: mail.fromAddress,
        customerLabel: null,
        referenceAt: mail.createdAt,
        sortAt: mail.createdAt,
        ownerUserId: null,
      }),
    );
  }

  for (const e of recentlyFinalized) {
    push(
      buildItem({
        id: `est-done-${e.id}`,
        state: 'completed',
        entityType: 'estimate',
        entityId: e.id,
        title: e.number,
        subtitle: 'Finalized',
        customerLabel: e.client.companyName,
        referenceAt: e.updatedAt,
        sortAt: e.updatedAt,
        ownerUserId: null,
        estimateId: e.id,
      }),
    );
  }

  for (const po of recentlyReconciledPos) {
    if (!po.operatorMarkedReconciledAt) continue;
    push(
      buildItem({
        id: `po-done-${po.id}`,
        state: 'completed',
        entityType: 'purchase_order',
        entityId: po.id,
        title: po.number,
        subtitle: 'Marked reconciled',
        customerLabel: null,
        referenceAt: po.operatorMarkedReconciledAt,
        sortAt: po.operatorMarkedReconciledAt,
        ownerUserId: null,
        poId: po.id,
      }),
    );
  }

  items.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());

  const sections = Object.fromEntries(
    OPERATIONAL_QUEUE_BUCKET_ORDER.map((b) => [b, [] as OperationalQueueItem[]]),
  ) as Record<OperationalQueueBucket, OperationalQueueItem[]>;

  for (const item of items) {
    sections[item.bucket].push(item);
  }

  for (const b of OPERATIONAL_QUEUE_BUCKET_ORDER) {
    sections[b] = sections[b].slice(0, 8);
  }

  const totalActionable = items.filter((i) => i.bucket !== 'recently_completed').length;

  return { sections, totalActionable };
}

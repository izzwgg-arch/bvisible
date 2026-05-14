'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  POReconciliationLineMatch,
  POReconciliationLineResolution,
  POReconciliationStatus,
  prisma,
  Role,
  SpendAlertStatus,
} from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { refreshPoReconciliationAggregate } from '@/lib/reconciliation/aggregate';
import { classifyPairedLine } from '@/lib/reconciliation/match';
import {
  buildManualRefreshTriggerDedupeKey,
  runPoReconciliationSnapshot,
} from '@/lib/reconciliation/run';
import { readReconciliationThresholds } from '@/lib/reconciliation/thresholds';
import { z } from 'zod';

export async function dismissSpendAlertAction(
  alertId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) return { ok: false, error: 'No tenant context.' };

  const row = await prisma.spendAlert.findFirst({
    where: {
      id: alertId,
      tenantId: me.tenantId,
      status: SpendAlertStatus.OPEN,
    },
    select: { id: true },
  });
  if (!row) return { ok: false, error: 'Alert not found or already handled.' };

  await prisma.spendAlert.update({
    where: { id: alertId },
    data: {
      status: SpendAlertStatus.DISMISSED,
      dismissedAt: new Date(),
      dismissedById: me.id,
    },
  });

  await writeAuditLog({
    action: 'spend_alert_dismissed',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'spend_alert',
    targetId: alertId,
  });

  revalidatePath('/dashboard');
  revalidatePath('/admin/reconciliation');
  return { ok: true };
}

export async function dismissSpendAlertFormAction(
  formData: FormData,
): Promise<void> {
  await dismissSpendAlertAction(String(formData.get('alertId') ?? ''));
}

export async function resolvePoReconciliationLineAction(input: unknown): Promise<{
  ok: boolean;
  error?: string;
}> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) return { ok: false, error: 'No tenant context.' };

  const schema = z.object({
    lineId: z.string(),
    resolution: z.nativeEnum(POReconciliationLineResolution),
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid payload.' };

  if (
    parsed.data.resolution === POReconciliationLineResolution.NONE ||
    parsed.data.resolution === POReconciliationLineResolution.REJECTED_PAIR
  ) {
    return { ok: false, error: 'Use reject or pick confirm / variance accepted.' };
  }

  const fullLine = await prisma.pOReconciliationLine.findFirst({
    where: { id: parsed.data.lineId, tenantId: me.tenantId },
    include: {
      poReconciliation: {
        select: { purchaseOrderId: true },
      },
    },
  });

  if (!fullLine) return { ok: false, error: 'Line not found.' };

  await prisma.pOReconciliationLine.update({
    where: { id: fullLine.id },
    data: {
      resolution: parsed.data.resolution,
      resolvedAt: new Date(),
      resolvedById: me.id,
    },
  });

  await writeAuditLog({
    action: 'po_reconciliation_line_resolution',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'po_reconciliation_line',
    targetId: fullLine.id,
    metadata: {
      resolution: parsed.data.resolution,
      purchaseOrderId: fullLine.poReconciliation.purchaseOrderId,
    },
  });

  const poId = fullLine.poReconciliation.purchaseOrderId;
  revalidatePath(`/purchase-orders/${poId}/reconciliation`);
  revalidatePath('/admin/reconciliation');
  return { ok: true };
}

export async function rejectPoReconciliationLinePairAction(
  lineId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) return { ok: false, error: 'No tenant context.' };

  const fullLine = await prisma.pOReconciliationLine.findFirst({
    where: { id: lineId, tenantId: me.tenantId },
    include: {
      poReconciliation: { select: { purchaseOrderId: true } },
    },
  });
  if (!fullLine) return { ok: false, error: 'Line not found.' };

  await prisma.pOReconciliationLine.update({
    where: { id: fullLine.id },
    data: {
      resolution: POReconciliationLineResolution.REJECTED_PAIR,
      resolvedAt: new Date(),
      resolvedById: me.id,
    },
  });

  await writeAuditLog({
    action: 'po_reconciliation_line_resolution',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'po_reconciliation_line',
    targetId: fullLine.id,
    metadata: {
      resolution: POReconciliationLineResolution.REJECTED_PAIR,
      purchaseOrderId: fullLine.poReconciliation.purchaseOrderId,
    },
  });

  const poId = fullLine.poReconciliation.purchaseOrderId;
  revalidatePath(`/purchase-orders/${poId}/reconciliation`);
  revalidatePath('/admin/reconciliation');
  return { ok: true };
}

export async function mergeUnmatchedReconciliationLinesAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  const tenantId = me.tenantId;
  if (!tenantId) return { ok: false, error: 'No tenant context.' };

  const schema = z.object({
    poSideLineId: z.string(),
    receiptSideLineId: z.string(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid payload.' };

  const thresholds = readReconciliationThresholds();

  const allowPo = new Set<POReconciliationLineMatch>([
    POReconciliationLineMatch.UNMATCHED_PO_LINE,
    POReconciliationLineMatch.AMBIGUOUS_PO_LINE,
  ]);
  const allowRc = new Set<POReconciliationLineMatch>([
    POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE,
    POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE,
  ]);

  try {
    await prisma.$transaction(async (tx) => {
      const poSide = await tx.pOReconciliationLine.findFirst({
        where: { id: parsed.data.poSideLineId, tenantId },
        include: {
          poLineItem: {
            select: {
              id: true,
              qtyMilli: true,
              unitCostCents: true,
            },
          },
        },
      });
      const rcSide = await tx.pOReconciliationLine.findFirst({
        where: { id: parsed.data.receiptSideLineId, tenantId },
        include: {
          vendorPriceHistory: {
            select: {
              id: true,
              priceCents: true,
              quantityMilli: true,
            },
          },
        },
      });

      if (!poSide?.poLineItem || !rcSide?.vendorPriceHistory) {
        throw new Error('MERGE_INVALID_ROWS');
      }
      if (poSide.poReconciliationId !== rcSide.poReconciliationId) {
        throw new Error('MERGE_DIFFERENT_RUN');
      }
      if (!allowPo.has(poSide.match) || !allowRc.has(rcSide.match)) {
        throw new Error('MERGE_KIND_NOT_ALLOWED');
      }

      const pl = poSide.poLineItem;
      const hist = rcSide.vendorPriceHistory;

      const classified = classifyPairedLine({
        expectedQtyMilli: pl.qtyMilli,
        expectedUnitCostCents: pl.unitCostCents,
        observedQtyMilli: hist.quantityMilli,
        observedUnitPriceCents: hist.priceCents,
        priceTolBps: thresholds.priceTolBps,
        absolutePriceTolCents: thresholds.absolutePriceTolCents,
        qtyTolBps: thresholds.qtyTolBps,
      });

      const enumMatch =
        classified.match === 'MATCHED'
          ? POReconciliationLineMatch.MATCHED
          : classified.match === 'PRICE_VARIANCE'
            ? POReconciliationLineMatch.PRICE_VARIANCE
            : classified.match === 'QTY_VARIANCE'
              ? POReconciliationLineMatch.QTY_VARIANCE
              : POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE;

      await tx.pOReconciliationLine.update({
        where: { id: poSide.id },
        data: {
          vendorPriceHistoryId: hist.id,
          match: enumMatch,
          expectedQtyMilli: pl.qtyMilli,
          expectedUnitCostCents: pl.unitCostCents,
          observedQtyMilli: hist.quantityMilli,
          observedUnitPriceCents: hist.priceCents,
          priceVarianceCents: classified.priceVarianceCents,
          qtyVarianceMilli: classified.qtyVarianceMilli,
          resolution: POReconciliationLineResolution.CONFIRMED_PAIR,
          resolvedAt: new Date(),
          resolvedById: me.id,
        },
      });

      await tx.pOReconciliationLine.delete({ where: { id: rcSide.id } });
    });
  } catch {
    return { ok: false, error: 'Merge rejected — check rows belong to the same run.' };
  }

  const reconLine = await prisma.pOReconciliationLine.findFirst({
    where: { id: parsed.data.poSideLineId, tenantId },
    select: { poReconciliationId: true },
  });
  if (reconLine) {
    await refreshPoReconciliationAggregate({
      tenantId,
      poReconciliationId: reconLine.poReconciliationId,
    });
  }

  const poLineForAudit = await prisma.pOReconciliationLine.findFirst({
    where: { id: parsed.data.poSideLineId, tenantId },
    include: {
      poReconciliation: { select: { purchaseOrderId: true } },
    },
  });

  await writeAuditLog({
    action: 'po_reconciliation_manual_merge',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'po_reconciliation_line',
    targetId: parsed.data.poSideLineId,
    metadata: {
      receiptSideLineId: parsed.data.receiptSideLineId,
      purchaseOrderId: poLineForAudit?.poReconciliation.purchaseOrderId,
    },
  });

  const poId = poLineForAudit?.poReconciliation.purchaseOrderId;
  if (poId) {
    revalidatePath(`/purchase-orders/${poId}/reconciliation`);
  }
  revalidatePath('/admin/reconciliation');
  return { ok: true };
}

export async function markPurchaseOrderReconciledByOperatorAction(
  purchaseOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) return { ok: false, error: 'No tenant context.' };

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!po) return { ok: false, error: 'PO not found.' };

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        operatorMarkedReconciledAt: new Date(),
        operatorMarkedReconciledById: me.id,
      },
    });

    const latest = await tx.pOReconciliation.findFirst({
      where: { tenantId: me.tenantId!, purchaseOrderId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (latest) {
      await tx.pOReconciliation.update({
        where: { id: latest.id },
        data: {
          status: POReconciliationStatus.RESOLVED,
          resolvedAt: new Date(),
          resolvedById: me.id,
        },
      });
    }
  });

  await writeAuditLog({
    action: 'po_operator_marked_reconciled',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath(`/purchase-orders/${purchaseOrderId}/reconciliation`);
  revalidatePath('/admin/reconciliation');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function refreshPoReconciliationManualAction(
  purchaseOrderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) return { ok: false, error: 'No tenant context.' };

  const nonce = randomUUID();
  const triggerDedupeKey = buildManualRefreshTriggerDedupeKey({
    tenantId: me.tenantId,
    purchaseOrderId,
    nonce,
  });

  await runPoReconciliationSnapshot({
    tenantId: me.tenantId,
    purchaseOrderId,
    actorId: me.id,
    triggerDedupeKey,
  });

  await writeAuditLog({
    action: 'po_reconciliation_manual_refresh',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    metadata: { triggerDedupeKey },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}/reconciliation`);
  revalidatePath('/admin/reconciliation');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function mergeReconciliationLinesFormAction(
  formData: FormData,
): Promise<void> {
  await mergeUnmatchedReconciliationLinesAction({
    poSideLineId: String(formData.get('poSideLineId') ?? ''),
    receiptSideLineId: String(formData.get('receiptSideLineId') ?? ''),
  });
}

export async function reconciliationLineResolutionFormAction(
  formData: FormData,
): Promise<void> {
  const parsed = z
    .object({
      lineId: z.string(),
      resolution: z.nativeEnum(POReconciliationLineResolution),
    })
    .safeParse({
      lineId: formData.get('lineId'),
      resolution: formData.get('resolution'),
    });
  if (!parsed.success) return;
  await resolvePoReconciliationLineAction(parsed.data);
}

export async function rejectReconciliationLineFormAction(
  formData: FormData,
): Promise<void> {
  const lineId = String(formData.get('lineId') ?? '');
  await rejectPoReconciliationLinePairAction(lineId);
}

export async function refreshReconciliationFormAction(
  formData: FormData,
): Promise<void> {
  const purchaseOrderId = String(formData.get('purchaseOrderId') ?? '');
  await refreshPoReconciliationManualAction(purchaseOrderId);
}

export async function markPoReconciledFormAction(
  formData: FormData,
): Promise<void> {
  const purchaseOrderId = String(formData.get('purchaseOrderId') ?? '');
  await markPurchaseOrderReconciledByOperatorAction(purchaseOrderId);
}

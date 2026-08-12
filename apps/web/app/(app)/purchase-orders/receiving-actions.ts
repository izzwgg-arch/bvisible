'use server';

// Receiving actions for the Ordered Materials checklist. Open to every
// authenticated user of the internal system (tenant-scoped only — no
// ownership or role restrictions, matching the rest of the PO workflow).
//
// Concurrency: single-line updates carry the quantity the client was
// looking at; the update only applies when the database still holds that
// value, so two employees can never silently overwrite each other. Every
// change appends a RECEIVING POEvent (who / when / what / how much) —
// corrections add new events, never rewrite old ones.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { POEventKind, POStatus, Prisma, prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import {
  RECEIVABLE_PO_STATUSES,
  classifyReceivingChange,
  clampReceivedQty,
  derivePoStatusFromLines,
} from '@/lib/po/receiving';

export interface ReceivingLineSnapshot {
  lineId: string;
  receivedQtyMilli: number;
}

export interface ReceivingActionResult {
  error: string | null;
  /// True when someone else changed the item first — the UI reloads the
  /// fresh values below instead of applying the stale click.
  conflict?: boolean;
  poStatus?: POStatus;
  lines?: ReceivingLineSnapshot[];
  /// Exact quantities to restore for Undo (state before this action).
  undo?: ReceivingLineSnapshot[];
}

const setLineSchema = z.object({
  poId: z.string().trim().min(1).max(200),
  lineId: z.string().trim().min(1).max(200),
  receivedQtyMilli: z.number().int().min(0).max(1_000_000_000),
  /// The value the client saw — optimistic-concurrency token.
  expectedReceivedQtyMilli: z.number().int().min(0).max(1_000_000_000),
  source: z.enum(['checkbox', 'detail', 'undo']).default('checkbox'),
});

const markAllSchema = z.object({
  poId: z.string().trim().min(1).max(200),
});

const undoSchema = z.object({
  poId: z.string().trim().min(1).max(200),
  restore: z
    .array(
      z.object({
        lineId: z.string().trim().min(1).max(200),
        receivedQtyMilli: z.number().int().min(0).max(1_000_000_000),
      })
    )
    .min(1)
    .max(200),
});

interface PoForReceiving {
  id: string;
  number: string;
  status: POStatus;
  lines: Array<{
    id: string;
    description: string;
    qtyMilli: number;
    receivedQtyMilli: number;
    unit: string;
    catalogItemId: string | null;
  }>;
}

async function loadReceivablePo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  poId: string
): Promise<{ po: PoForReceiving | null; error: string | null }> {
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          description: true,
          qtyMilli: true,
          receivedQtyMilli: true,
          unit: true,
          catalogItemId: true,
        },
      },
    },
  });
  if (!po) return { po: null, error: 'Purchase order not found.' };
  if (po.status === POStatus.DRAFT) {
    return { po: null, error: 'This PO is still a draft — send it before receiving materials.' };
  }
  if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
    return { po: null, error: 'This PO is cancelled and cannot receive materials.' };
  }
  return { po, error: null };
}

function snapshotLines(po: PoForReceiving): ReceivingLineSnapshot[] {
  return po.lines.map((l) => ({ lineId: l.id, receivedQtyMilli: l.receivedQtyMilli }));
}

interface ReceivingEventInput {
  tenantId: string;
  poId: string;
  poNumber: string;
  actorId: string;
  actorName: string;
  line: PoForReceiving['lines'][number];
  prevMilli: number;
  nextMilli: number;
  action: string;
}

async function writeReceivingEvent(
  tx: Prisma.TransactionClient,
  input: ReceivingEventInput
): Promise<void> {
  const delta = input.nextMilli - input.prevMilli;
  const qty = (n: number) => String(Number((n / 1000).toFixed(3)));
  const verb =
    input.action === 'received' || input.action === 'mark_all'
      ? 'received in full'
      : input.action === 'partial'
        ? `received ${qty(input.nextMilli)} of ${qty(input.line.qtyMilli)}`
        : input.action === 'corrected'
          ? `corrected to ${qty(input.nextMilli)} of ${qty(input.line.qtyMilli)}`
          : input.action === 'undo'
            ? `restored to ${qty(input.nextMilli)} of ${qty(input.line.qtyMilli)}`
            : 'receiving reversed';
  await tx.pOEvent.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: input.poId,
      kind: POEventKind.RECEIVING,
      message: `${input.line.description} — ${verb} (${input.actorName})`,
      metadata: {
        lineId: input.line.id,
        materialId: input.line.catalogItemId,
        description: input.line.description,
        action: input.action,
        deltaMilli: delta,
        prevReceivedMilli: input.prevMilli,
        totalReceivedMilli: input.nextMilli,
        orderedQtyMilli: input.line.qtyMilli,
        unit: input.line.unit,
        poNumber: input.poNumber,
        userName: input.actorName,
      },
      actorId: input.actorId,
    },
  });
}

function revalidateReceiving(poId: string) {
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${poId}`);
}

/// Sets one line's total received quantity (full check-off, partial
/// entry, correction, uncheck, or undo of a single line).
export async function setLineReceivedAction(
  payload: z.input<typeof setLineSchema>
): Promise<ReceivingActionResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = setLineSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;
  const actorName = me.name || me.email;

  const result = await prisma.$transaction(async (tx) => {
    const { po, error } = await loadReceivablePo(tx, me.tenantId, data.poId);
    if (!po) return { error } satisfies ReceivingActionResult;

    const line = po.lines.find((l) => l.id === data.lineId);
    if (!line) {
      // The line list changed underneath (PO edited) — surface fresh state.
      return {
        error: 'This PO changed since the page loaded — refreshing.',
        conflict: true,
        poStatus: po.status,
        lines: snapshotLines(po),
      } satisfies ReceivingActionResult;
    }

    const next = clampReceivedQty(data.receivedQtyMilli, line.qtyMilli);
    const updated = await tx.pOLineItem.updateMany({
      where: {
        id: line.id,
        tenantId: me.tenantId,
        receivedQtyMilli: data.expectedReceivedQtyMilli,
      },
      data: { receivedQtyMilli: next },
    });
    if (updated.count === 0) {
      return {
        error: 'Someone else just updated this item — showing the latest quantities.',
        conflict: true,
        poStatus: po.status,
        lines: snapshotLines(po),
      } satisfies ReceivingActionResult;
    }

    const prev = line.receivedQtyMilli;
    const freshLines = po.lines.map((l) =>
      l.id === line.id ? { ...l, receivedQtyMilli: next } : l
    );
    const nextStatus = derivePoStatusFromLines(freshLines, po.status);
    if (nextStatus !== po.status) {
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: nextStatus },
      });
    }

    await writeReceivingEvent(tx, {
      tenantId: me.tenantId,
      poId: po.id,
      poNumber: po.number,
      actorId: me.id,
      actorName,
      line,
      prevMilli: prev,
      nextMilli: next,
      action: classifyReceivingChange(
        prev,
        next,
        line.qtyMilli,
        data.source === 'undo' ? 'undo' : undefined
      ),
    });

    return {
      error: null,
      poStatus: nextStatus,
      lines: freshLines.map((l) => ({ lineId: l.id, receivedQtyMilli: l.receivedQtyMilli })),
      undo: [{ lineId: line.id, receivedQtyMilli: prev }],
    } satisfies ReceivingActionResult;
  });

  if (!result.error) {
    await writeAuditLog({
      action: 'po_receiving_updated',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'purchase_order',
      targetId: data.poId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        lineId: data.lineId,
        receivedQtyMilli: data.receivedQtyMilli,
        source: data.source,
      },
    });
    revalidateReceiving(data.poId);
  }
  return result;
}

/// Marks every incomplete line fully received. Idempotent — a double
/// click finds nothing left to update and changes nothing.
export async function markAllArrivedAction(
  payload: z.input<typeof markAllSchema>
): Promise<ReceivingActionResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = markAllSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { poId } = parsed.data;
  const actorName = me.name || me.email;

  const result = await prisma.$transaction(async (tx) => {
    const { po, error } = await loadReceivablePo(tx, me.tenantId, poId);
    if (!po) return { error } satisfies ReceivingActionResult;

    const incomplete = po.lines.filter((l) => l.receivedQtyMilli < l.qtyMilli);
    if (incomplete.length === 0) {
      return {
        error: null,
        poStatus: po.status,
        lines: snapshotLines(po),
      } satisfies ReceivingActionResult;
    }

    const undo: ReceivingLineSnapshot[] = [];
    for (const line of incomplete) {
      undo.push({ lineId: line.id, receivedQtyMilli: line.receivedQtyMilli });
      await tx.pOLineItem.update({
        where: { id: line.id },
        data: { receivedQtyMilli: line.qtyMilli },
      });
      await writeReceivingEvent(tx, {
        tenantId: me.tenantId,
        poId: po.id,
        poNumber: po.number,
        actorId: me.id,
        actorName,
        line,
        prevMilli: line.receivedQtyMilli,
        nextMilli: line.qtyMilli,
        action: 'mark_all',
      });
    }

    const freshLines = po.lines.map((l) => ({ ...l, receivedQtyMilli: l.qtyMilli }));
    const nextStatus = derivePoStatusFromLines(freshLines, po.status);
    if (nextStatus !== po.status) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: nextStatus } });
    }

    return {
      error: null,
      poStatus: nextStatus,
      lines: freshLines.map((l) => ({ lineId: l.id, receivedQtyMilli: l.receivedQtyMilli })),
      undo,
    } satisfies ReceivingActionResult;
  });

  if (!result.error) {
    await writeAuditLog({
      action: 'po_receiving_mark_all',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'purchase_order',
      targetId: poId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { affected: result.undo?.length ?? 0 },
    });
    revalidateReceiving(poId);
  }
  return result;
}

/// Restores the exact quantities captured before a previous action
/// (single check-off or Mark all arrived).
export async function undoReceivingAction(
  payload: z.input<typeof undoSchema>
): Promise<ReceivingActionResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = undoSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { poId, restore } = parsed.data;
  const actorName = me.name || me.email;

  const result = await prisma.$transaction(async (tx) => {
    const { po, error } = await loadReceivablePo(tx, me.tenantId, poId);
    if (!po) return { error } satisfies ReceivingActionResult;

    const byId = new Map(po.lines.map((l) => [l.id, l]));
    const freshLines = po.lines.map((l) => ({ ...l }));
    for (const entry of restore) {
      const line = byId.get(entry.lineId);
      if (!line) continue; // line replaced by an edit — nothing to restore
      const next = clampReceivedQty(entry.receivedQtyMilli, line.qtyMilli);
      if (next === line.receivedQtyMilli) continue;
      await tx.pOLineItem.update({
        where: { id: line.id },
        data: { receivedQtyMilli: next },
      });
      await writeReceivingEvent(tx, {
        tenantId: me.tenantId,
        poId: po.id,
        poNumber: po.number,
        actorId: me.id,
        actorName,
        line,
        prevMilli: line.receivedQtyMilli,
        nextMilli: next,
        action: 'undo',
      });
      const fresh = freshLines.find((l) => l.id === line.id);
      if (fresh) fresh.receivedQtyMilli = next;
    }

    const nextStatus = derivePoStatusFromLines(freshLines, po.status);
    if (nextStatus !== po.status) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: nextStatus } });
    }

    return {
      error: null,
      poStatus: nextStatus,
      lines: freshLines.map((l) => ({ lineId: l.id, receivedQtyMilli: l.receivedQtyMilli })),
    } satisfies ReceivingActionResult;
  });

  if (!result.error) {
    await writeAuditLog({
      action: 'po_receiving_undo',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'purchase_order',
      targetId: poId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { restored: restore.length },
    });
    revalidateReceiving(poId);
  }
  return result;
}

export interface ReceivingHistoryEntry {
  id: string;
  createdAt: string;
  message: string;
  actorName: string;
  lineId: string | null;
  description: string | null;
  action: string | null;
  deltaMilli: number | null;
  totalReceivedMilli: number | null;
  orderedQtyMilli: number | null;
  unit: string | null;
}

/// Receiving history for one PO (the client filters per line). Loaded
/// on demand when a material row is expanded — not with the main list.
export async function getReceivingHistoryAction(
  poId: string
): Promise<{ error: string | null; events?: ReceivingHistoryEntry[] }> {
  const me = await requireTenantId();
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!po) return { error: 'Purchase order not found.' };

  const events = await prisma.pOEvent.findMany({
    where: { tenantId: me.tenantId, purchaseOrderId: poId, kind: POEventKind.RECEIVING },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      id: true,
      createdAt: true,
      message: true,
      metadata: true,
      actor: { select: { name: true, email: true } },
    },
  });

  return {
    error: null,
    events: events.map((e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
      const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
      return {
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        message: e.message,
        actorName: e.actor?.name || e.actor?.email || str(meta.userName) || 'Unknown',
        lineId: str(meta.lineId),
        description: str(meta.description),
        action: str(meta.action),
        deltaMilli: num(meta.deltaMilli),
        totalReceivedMilli: num(meta.totalReceivedMilli),
        orderedQtyMilli: num(meta.orderedQtyMilli),
        unit: str(meta.unit),
      };
    }),
  };
}

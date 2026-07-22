// Operator actions for the AI assistant.
//
// The assistant can perform ANY normal user action in the app — create,
// edit, delete — but never touches code/backend/server, payments, or
// pension (those simply aren't reachable from here). Two safety rails:
//
//  1. Irreversible actions (delete, send, approve/finalize) never run
//     from the agent loop. The tool returns a PendingAction; the operator
//     approves it with one tap; only then does executeConfirmedAction run.
//  2. Every delete is a SOFT delete (deletedAt / isActive=false) — the row
//     moves to the 30-day Recycle Bin and can be restored. A nightly purge
//     hard-deletes anything deleted more than 30 days ago.

import { Prisma, prisma, EstimateLineKind, ShopCatalogUnit, EstimateStatus, POLineKind, POEventKind, POStatus } from '@bvisible/db';
import { computeEstimate } from '@bvisible/pricing';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { writeAuditLog } from '@/lib/auth/audit';
import { nextPoNumber } from '@/lib/po/number';
import { sheetItemKey } from '@/lib/sheet-sync/types';

export const RECYCLE_RETENTION_DAYS = 30;

/// Entities the assistant can soft-delete / restore. Each maps to a table
/// with a recoverable "deleted" state (deletedAt, or isActive=false).
export type RecyclableEntity =
  | 'estimate'
  | 'customer'
  | 'vendor'
  | 'purchase_order'
  | 'catalog_item';

/// A side-effectful action awaiting the operator's one-tap approval.
export interface PendingAction {
  /// Stable opaque id so the client can echo the exact action back.
  token: string;
  kind: 'delete' | 'set_estimate_status' | 'set_po_status';
  /// For deletes.
  entity?: RecyclableEntity;
  recordId: string;
  /// For status changes. Estimate: DRAFT/SENT/APPROVED/REJECTED. PO: DRAFT/
  /// ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELED — never SENT (that only
  /// happens for real via the operator's own "Send PO" button, which
  /// emails the vendor).
  targetStatus?: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELED';
  /// Human label shown on the approval card, e.g. "Estimate EST-000021 — test 3".
  label: string;
  /// One-line description of the consequence, shown under the label.
  detail: string;
  /// Card heading, e.g. "Approve delete?" / "Approve this estimate?".
  question: string;
  /// Confirm button text, e.g. "Approve delete".
  confirmLabel: string;
}

const ENTITY_LABEL: Record<RecyclableEntity, string> = {
  estimate: 'Estimate',
  customer: 'Customer',
  vendor: 'Vendor',
  purchase_order: 'Purchase order',
  catalog_item: 'Catalog item',
};

function newToken(): string {
  return `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ----------------------- immediate write actions ----------------------- */

/// Create a catalog (shop material) item. Reversible via delete, so it
/// runs immediately — no approval needed.
export async function createCatalogItem(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const name = String(args.name ?? '').trim().slice(0, 400);
  if (!name) return { error: 'A name is required to create a catalog item.' };

  const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(args.kind))
    ? String(args.kind)
    : 'MATERIAL') as EstimateLineKind;
  const unit = (['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'].includes(String(args.unit))
    ? String(args.unit)
    : 'EACH') as ShopCatalogUnit;
  const internalCostCents = Math.max(0, Math.round(Number(args.internalCostCents ?? args.unitCostCents ?? 0) || 0));
  const markupPercent = Math.max(0, Number(args.markupPercent ?? 200) || 200);
  const category = String(args.category ?? '').trim().slice(0, 120) || 'Uncategorized';

  // Catalog names are unique per tenant (@@unique([tenantId, nameNormalized]),
  // and the Google Sheet already seeds hundreds of items). Check first and
  // return a clear message instead of letting the unique constraint throw a
  // raw error that the operator sees as "it didn't work".
  const nameNormalized = normalizeVendorItemName(name);
  const existing = await prisma.shopMaterialItem.findFirst({
    where: { tenantId: me.tenantId, nameNormalized },
    select: { id: true, name: true },
  });
  if (existing) {
    return {
      error: `"${existing.name}" is already in the catalog. Use update_catalog_item to change its cost, markup, unit, or category — no need to add a duplicate.`,
    };
  }

  let created: { id: string; name: string };
  try {
    created = await prisma.shopMaterialItem.create({
      data: {
        tenantId: me.tenantId,
        name,
        nameNormalized,
        kind,
        catalogUnit: unit,
        categories: [category],
        internalCostCents,
        markupPercentMilli: Math.round(markupPercent * 1000),
        isActive: true,
      },
      select: { id: true, name: true },
    });
  } catch (e) {
    // Backstop for a race between the check above and the insert.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: `"${name}" is already in the catalog. Use update_catalog_item to change it instead.` };
    }
    throw e;
  }

  await writeAuditLog({
    action: 'shop_material_item_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: created.id,
    metadata: { via: 'ai_assistant', name: created.name },
  });

  return { ok: true, id: created.id, name: created.name };
}

/// Append a line to an existing estimate (by number or id). Reversible by
/// editing the estimate, so it runs immediately.
export async function addEstimateLine(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; estimateId: string; number: string } | { error: string }> {
  const ref = String(args.estimate ?? args.estimateId ?? args.number ?? '').trim();
  const estimate = await resolveEstimateRef(me.tenantId, ref);
  if ('error' in estimate) return estimate;
  if (estimate.status === EstimateStatus.FINALIZED) {
    return { error: `${estimate.number} is finalized — its lines are locked.` };
  }
  const lineCount = await prisma.estimateLineItem.count({ where: { estimateId: estimate.id, tenantId: me.tenantId } });

  const description = String(args.description ?? '').trim().slice(0, 400);
  if (!description) return { error: 'The line needs a description.' };
  const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(args.kind))
    ? String(args.kind)
    : 'MATERIAL') as EstimateLineKind;
  const qtyMilli = Math.max(1, Math.round((Number(args.qty) || 1) * 1000));
  const unitCostCents = Math.max(0, Math.round(Number(args.unitCostCents) || 0));
  const markupExempt = Boolean(args.markupExempt);

  await prisma.estimateLineItem.create({
    data: {
      tenantId: me.tenantId,
      estimateId: estimate.id,
      sortOrder: lineCount,
      kind,
      description,
      qtyMilli,
      unitCostCents,
      computedCostCents: markupExempt ? Math.round((unitCostCents * qtyMilli) / 1000) : Math.round((unitCostCents * qtyMilli) / 1000),
      markupExempt,
      sourceKind: 'CUSTOM',
    },
  });

  // Refresh the estimate's cached subtotal + final sell price so the total
  // reflects the new line immediately (not just after the editor is opened
  // and saved). Uses the same engine as saveEstimateAction.
  await recomputeEstimateTotals(prisma, me.tenantId, estimate.id);

  await writeAuditLog({
    action: 'estimate_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    metadata: { via: 'ai_assistant', number: estimate.number, addedLine: description },
  });

  return { ok: true, estimateId: estimate.id, number: estimate.number };
}

/// Recompute an estimate's cached subtotal + final sell price from its
/// current line rows, using the SAME pricing engine the grid editor and
/// saveEstimateAction use (computeEstimate) — so the total the assistant
/// leaves on the estimate is byte-for-byte what the editor would show.
/// R-EST-05 markup-exempt lines are honored (their face price is never
/// marked up again). Runs on the passed client so it can join a surrounding
/// transaction.
async function recomputeEstimateTotals(
  client: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  estimateId: string,
): Promise<{ subtotalCostCents: number; finalPriceCents: number }> {
  const est = await client.estimate.findFirst({
    where: { id: estimateId, tenantId },
    select: { multiplierMilli: true, designFlatCents: true },
  });
  if (!est) return { subtotalCostCents: 0, finalPriceCents: 0 };
  const lines = await client.estimateLineItem.findMany({
    where: { estimateId, tenantId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, kind: true, qtyMilli: true, unitCostCents: true, markupExempt: true },
  });
  const computed = computeEstimate({
    multiplierMilli: est.multiplierMilli,
    designFlatCents: est.designFlatCents,
    lines: lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      markupExempt: l.markupExempt,
    })),
  });
  await client.estimate.update({
    where: { id: estimateId, tenantId },
    data: { subtotalCostCents: computed.subtotalCostCents, finalPriceCents: computed.finalPriceCents },
  });
  return { subtotalCostCents: computed.subtotalCostCents, finalPriceCents: computed.finalPriceCents };
}

/// Resolve which estimate line the operator means: by 1-based number (as
/// shown on the estimate, first line = 1) or by matching text in the
/// description. Generic so callers keep full access to the line's fields.
function locateLine<T extends { id: string; description: string }>(
  lines: T[],
  args: Record<string, unknown>,
): { line: T; index: number } | { error: string } {
  const rawNum = args.lineNumber ?? args.line ?? args.position;
  if (rawNum != null && String(rawNum).trim() !== '') {
    const n = Math.round(Number(rawNum));
    if (!Number.isFinite(n) || n < 1 || n > lines.length) {
      return { error: `Line ${rawNum} doesn't exist — this estimate has ${lines.length} line${lines.length === 1 ? '' : 's'} (1–${lines.length}).` };
    }
    const line = lines[n - 1];
    if (!line) return { error: `Line ${n} doesn't exist on this estimate.` };
    return { line, index: n - 1 };
  }
  const match = String(args.match ?? args.description ?? '').trim().toLowerCase();
  if (match) {
    const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.description.toLowerCase().includes(match));
    if (hits.length === 0) return { error: `No line matching "${match}" on this estimate.` };
    if (hits.length > 1) return { error: `More than one line matches "${match}" (${hits.map((h) => `#${h.i + 1}`).join(', ')}) — tell me the line number instead.` };
    const only = hits[0];
    if (!only) return { error: `No line matching "${match}" on this estimate.` };
    return { line: only.l, index: only.i };
  }
  return { error: 'Which line? Give the line number (e.g. 7) or some text from the line to match.' };
}

/// Edit ONE existing estimate line in place — its quantity, rate,
/// description, kind, or markup-exempt flag — then refresh the estimate's
/// cached total. Reversible (edit it again), so it runs immediately, like
/// add_estimate_line. Target by 1-based line number (as shown) or by matching
/// description text. Markup-exempt lines carry a FINAL price that is never
/// marked up again (R-EST-05).
export async function updateEstimateLine(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<
  | { ok: true; estimateId: string; number: string; lineNumber: number; description: string; markupExempt: boolean; finalPriceCents: number; total: string }
  | { error: string }
> {
  const ref = String(args.estimate ?? args.estimateId ?? args.number ?? '').trim();
  const estimate = await resolveEstimateRef(me.tenantId, ref);
  if ('error' in estimate) return estimate;
  if (estimate.status === EstimateStatus.FINALIZED) return { error: `${estimate.number} is finalized — its lines are locked.` };

  const lines = await prisma.estimateLineItem.findMany({
    where: { estimateId: estimate.id, tenantId: me.tenantId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, description: true, qtyMilli: true, unitCostCents: true, markupExempt: true },
  });
  if (lines.length === 0) return { error: `${estimate.number} has no lines to edit.` };

  const located = locateLine(lines, args);
  if ('error' in located) return located;
  const target = located.line;
  const lineNumber = located.index + 1;

  const data: Record<string, unknown> = {};
  if (args.description != null && String(args.description).trim()) data.description = String(args.description).trim().slice(0, 400);
  if (args.kind != null && ['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(args.kind))) data.kind = String(args.kind) as EstimateLineKind;
  if (args.qty != null) data.qtyMilli = Math.max(1, Math.round((Number(args.qty) || 1) * 1000));
  if (args.unitCostCents != null) data.unitCostCents = Math.max(0, Math.round(Number(args.unitCostCents) || 0));
  if (args.markupExempt != null) data.markupExempt = Boolean(args.markupExempt);
  if (Object.keys(data).length === 0) {
    return { error: 'Nothing to change on that line — tell me what to update (quantity, rate/unitCostCents, description, kind, or markupExempt).' };
  }

  // Refresh the line's own cached cost from the resulting qty × unit cost.
  const newQtyMilli = (data.qtyMilli as number | undefined) ?? target.qtyMilli;
  const newUnitCostCents = (data.unitCostCents as number | undefined) ?? target.unitCostCents;
  data.computedCostCents = Math.round((newUnitCostCents * newQtyMilli) / 1000);

  const totals = await prisma.$transaction(async (tx) => {
    await tx.estimateLineItem.update({ where: { id: target.id }, data });
    return recomputeEstimateTotals(tx, me.tenantId, estimate.id);
  });

  const finalMarkupExempt = (data.markupExempt as boolean | undefined) ?? target.markupExempt;
  await writeAuditLog({
    action: 'estimate_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    metadata: { via: 'ai_assistant', number: estimate.number, editedLine: lineNumber, fields: Object.keys(data).filter((k) => k !== 'computedCostCents') },
  });

  return {
    ok: true,
    estimateId: estimate.id,
    number: estimate.number,
    lineNumber,
    description: (data.description as string | undefined) ?? target.description,
    markupExempt: finalMarkupExempt,
    finalPriceCents: totals.finalPriceCents,
    total: `$${(totals.finalPriceCents / 100).toFixed(2)}`,
  };
}

/// Remove ONE line from an estimate (by 1-based number as shown, or by
/// matching description text), renumber the remaining lines so positions stay
/// contiguous, and refresh the estimate total. Reversible (re-add the line),
/// so it runs immediately — a routine line edit, NOT a record deletion.
export async function removeEstimateLine(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<
  | { ok: true; estimateId: string; number: string; removedLine: number; removed: string; finalPriceCents: number; total: string }
  | { error: string }
> {
  const ref = String(args.estimate ?? args.estimateId ?? args.number ?? '').trim();
  const estimate = await resolveEstimateRef(me.tenantId, ref);
  if ('error' in estimate) return estimate;
  if (estimate.status === EstimateStatus.FINALIZED) return { error: `${estimate.number} is finalized — its lines are locked.` };

  const lines = await prisma.estimateLineItem.findMany({
    where: { estimateId: estimate.id, tenantId: me.tenantId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, description: true },
  });
  if (lines.length === 0) return { error: `${estimate.number} has no lines to remove.` };

  const located = locateLine(lines, args);
  if ('error' in located) return located;
  const target = located.line;
  const removedLine = located.index + 1;

  const totals = await prisma.$transaction(async (tx) => {
    await tx.estimateLineItem.delete({ where: { id: target.id } });
    // Compact sortOrder so positions stay 0..n-1 (add_estimate_line uses the
    // line count as the next sortOrder, so gaps would collide).
    const remaining = lines.filter((l) => l.id !== target.id);
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      if (r) await tx.estimateLineItem.update({ where: { id: r.id }, data: { sortOrder: i } });
    }
    return recomputeEstimateTotals(tx, me.tenantId, estimate.id);
  });

  await writeAuditLog({
    action: 'estimate_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    metadata: { via: 'ai_assistant', number: estimate.number, removedLine, removedDescription: target.description },
  });

  return {
    ok: true,
    estimateId: estimate.id,
    number: estimate.number,
    removedLine,
    removed: target.description,
    finalPriceCents: totals.finalPriceCents,
    total: `$${(totals.finalPriceCents / 100).toFixed(2)}`,
  };
}

/// Create a DRAFT purchase order to order materials from a vendor. This is
/// reversible (soft-delete → Recycle Bin), so it runs immediately — exactly
/// like a draft estimate. It never emails anyone: the operator sends the PO
/// to vendors later with the deliberate "Send PO" action on the PO page.
///
/// Each line is linked to the shop catalog (by Sheet key, then exact name)
/// so vendor + pricing context show up on the PO, and the vendor is resolved
/// from (in order) an explicit per-line vendor, the PO-level vendor, or the
/// catalog item's preferred/selected vendor. Named vendors that don't exist
/// yet are created.
export async function createPurchaseOrder(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<
  | { ok: true; purchaseOrderId: string; number: string; url: string; lineCount: number; vendorCount: number; subtotalCents: number; subtotal: string }
  | { error: string }
> {
  const rawLines = Array.isArray(args.lines) ? (args.lines as Array<Record<string, unknown>>) : [];
  if (rawLines.length === 0 || rawLines.length > 100) {
    return { error: '1–100 lines are required to create a purchase order.' };
  }
  const poVendorName = String(args.vendorName ?? '').trim().slice(0, 200);
  const notes = String(args.notes ?? '').trim().slice(0, 2000) || null;

  const lines = rawLines
    .map((l) => {
      const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(l.kind))
        ? String(l.kind)
        : 'MATERIAL') as POLineKind;
      const unit = (['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'].includes(String(l.unit))
        ? String(l.unit)
        : 'EACH') as ShopCatalogUnit;
      const qtyMilli = Math.max(1, Math.round((Number(l.qty) || 1) * 1000));
      const unitCostCents = Math.max(0, Math.round(Number(l.unitCostCents) || 0));
      return {
        kind,
        unit,
        qtyMilli,
        unitCostCents,
        computedCostCents: Math.round((unitCostCents * qtyMilli) / 1000),
        description: String(l.description ?? '').trim().slice(0, 400),
        materialName: String(l.materialName ?? '').trim().slice(0, 400),
        vendorName: String(l.vendorName ?? '').trim().slice(0, 200),
      };
    })
    .filter((l) => l.description.length > 0);

  if (lines.length === 0) return { error: 'Each purchase-order line needs a description.' };

  // Find-or-create a vendor by name, cached so we never create duplicates
  // within one PO. Sequential (not Promise.all) to avoid a create race.
  const vendorIdByName = new Map<string, string>();
  const resolveVendorByName = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const cacheKey = trimmed.toLowerCase();
    const cached = vendorIdByName.get(cacheKey);
    if (cached) return cached;
    let vendor = await prisma.vendor.findFirst({
      where: { tenantId: me.tenantId, name: { equals: trimmed, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) {
      vendor = await prisma.vendor.create({
        data: { tenantId: me.tenantId, name: trimmed.slice(0, 200) },
        select: { id: true },
      });
    }
    vendorIdByName.set(cacheKey, vendor.id);
    return vendor.id;
  };

  const resolved: Array<{
    kind: POLineKind;
    unit: ShopCatalogUnit;
    qtyMilli: number;
    unitCostCents: number;
    computedCostCents: number;
    description: string;
    catalogItemId: string | null;
    vendorId: string | null;
  }> = [];

  for (const line of lines) {
    // Link to the shop catalog by Sheet key first, then exact name.
    const orClauses: Array<Record<string, unknown>> = [];
    if (line.materialName) {
      orClauses.push({ sheetKey: sheetItemKey(line.materialName) });
      orClauses.push({ name: { equals: line.materialName, mode: 'insensitive' } });
    }
    const catalog =
      line.kind === POLineKind.MATERIAL && orClauses.length > 0
        ? await prisma.shopMaterialItem.findFirst({
            where: { tenantId: me.tenantId, isActive: true, OR: orClauses },
            select: { id: true, catalogUnit: true, preferredVendorId: true, selectedVendorId: true },
          })
        : null;

    let vendorId: string | null = null;
    const explicitVendor = line.vendorName || poVendorName;
    if (explicitVendor) vendorId = await resolveVendorByName(explicitVendor);
    else vendorId = catalog?.preferredVendorId ?? catalog?.selectedVendorId ?? null;

    resolved.push({
      kind: line.kind,
      unit: catalog?.catalogUnit ?? line.unit,
      qtyMilli: line.qtyMilli,
      unitCostCents: line.unitCostCents,
      computedCostCents: line.computedCostCents,
      description: line.description,
      catalogItemId: catalog?.id ?? null,
      vendorId,
    });
  }

  const subtotalCents = resolved.reduce((sum, l) => sum + l.computedCostCents, 0);
  const vendorIds = [...new Set(resolved.map((l) => l.vendorId).filter((v): v is string => Boolean(v)))];
  const primaryVendorId = vendorIds.length === 1 ? vendorIds[0] : null;

  const po = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, me.tenantId);
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: me.tenantId,
        vendorId: primaryVendorId,
        number,
        subtotalCents,
        notes,
        createdById: me.id,
      },
      select: { id: true, number: true },
    });
    await tx.pOLineItem.createMany({
      data: resolved.map((l, index) => ({
        tenantId: me.tenantId,
        purchaseOrderId: created.id,
        sortOrder: index,
        kind: l.kind,
        description: l.description,
        qtyMilli: l.qtyMilli,
        unitCostCents: l.unitCostCents,
        computedCostCents: l.computedCostCents,
        catalogItemId: l.catalogItemId,
        vendorId: l.vendorId,
        unit: l.unit,
      })),
    });
    if (vendorIds.length > 0) {
      await tx.purchaseOrderVendor.createMany({
        data: vendorIds.map((vendorId) => ({ tenantId: me.tenantId, purchaseOrderId: created.id, vendorId })),
      });
    }
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: created.id,
        kind: POEventKind.CREATED,
        message: `Created by the assistant with ${resolved.length} line${resolved.length === 1 ? '' : 's'} across ${vendorIds.length} vendor${vendorIds.length === 1 ? '' : 's'}`,
        metadata: { via: 'ai_assistant', lineCount: resolved.length, vendorCount: vendorIds.length, subtotalCents },
        actorId: me.id,
      },
    });
    return created;
  });

  await writeAuditLog({
    action: 'po_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    metadata: { via: 'ai_assistant', number: po.number, lineCount: resolved.length, vendorCount: vendorIds.length },
  });

  return {
    ok: true,
    purchaseOrderId: po.id,
    number: po.number,
    url: `/purchase-orders/${po.id}`,
    lineCount: resolved.length,
    vendorCount: vendorIds.length,
    subtotalCents,
    subtotal: `$${(subtotalCents / 100).toFixed(2)}`,
  };
}

/* ------------------------- lookup (read-only) ------------------------- */

/// Resolve a PO/estimate reference to the row(s) it could mean: exact
/// number/id match first, then (since numbers are "PO-000022" / "EST-
/// 000021" — a fixed prefix + 6-digit zero-padded sequence) a zero-padded
/// exact match so short forms like "22" or "po 22" resolve precisely, and
/// only then a lenient fuzzy fallback that can return multiple candidates.
function padNumberDigits(ref: string): string | null {
  const digits = ref.replace(/\D/g, '');
  return digits.length >= 1 && digits.length <= 6 ? digits.padStart(6, '0') : null;
}

/// Resolve a purchase-order reference the same lenient way lookups do, so
/// EVERY write tool accepts "PO-000022", "22", "po 22", or "#22" — not just
/// an exact match. Number-based only (never fuzzy vendor/title) so a write
/// never lands on the wrong record. Returns the PO's key fields, or a
/// friendly error (with a short list when a partial number matches several).
async function resolvePurchaseOrderRef(
  tenantId: string,
  ref: string,
): Promise<
  | { id: string; number: string; status: string; vendorId: string | null; subtotalCents: number; lineCount: number }
  | { error: string }
> {
  const trimmed = String(ref ?? '').trim();
  if (!trimmed) return { error: 'Which purchase order? Give a PO number like PO-000022.' };
  const select = {
    id: true,
    number: true,
    status: true,
    vendorId: true,
    subtotalCents: true,
    _count: { select: { lines: true } },
  } as const;
  type Row = { id: string; number: string; status: string; vendorId: string | null; subtotalCents: number; _count: { lines: number } };
  const shape = (po: Row) => ({
    id: po.id,
    number: po.number,
    status: po.status,
    vendorId: po.vendorId,
    subtotalCents: po.subtotalCents,
    lineCount: po._count.lines,
  });

  let po: Row | null = await prisma.purchaseOrder.findFirst({
    where: { tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] },
    select,
  });
  if (!po) {
    const padded = padNumberDigits(trimmed);
    if (padded) {
      po = await prisma.purchaseOrder.findFirst({
        where: { tenantId, deletedAt: null, number: { equals: `PO-${padded}`, mode: 'insensitive' } },
        select,
      });
    }
  }
  if (!po) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 2) {
      const candidates = await prisma.purchaseOrder.findMany({
        where: { tenantId, deletedAt: null, number: { endsWith: digits, mode: 'insensitive' } },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select,
      });
      const only = candidates.length === 1 ? candidates[0] : undefined;
      if (only) po = only;
      else if (candidates.length > 1) {
        return { error: `Several purchase orders match "${ref}" (${candidates.map((c) => c.number).join(', ')}) — tell me the full PO number.` };
      }
    }
  }
  if (!po) return { error: `No purchase order found matching "${ref}". Give a PO number like PO-000022.` };
  return shape(po);
}

/// Estimate counterpart to resolvePurchaseOrderRef. Number-based only.
async function resolveEstimateRef(
  tenantId: string,
  ref: string,
): Promise<{ id: string; number: string; status: string } | { error: string }> {
  const trimmed = String(ref ?? '').trim();
  if (!trimmed) return { error: 'Which estimate? Give a number like EST-000021.' };
  const select = { id: true, number: true, status: true } as const;
  type Row = { id: string; number: string; status: string };

  let est: Row | null = await prisma.estimate.findFirst({
    where: { tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] },
    select,
  });
  if (!est) {
    const padded = padNumberDigits(trimmed);
    if (padded) {
      est = await prisma.estimate.findFirst({
        where: { tenantId, deletedAt: null, number: { equals: `EST-${padded}`, mode: 'insensitive' } },
        select,
      });
    }
  }
  if (!est) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 2) {
      const candidates = await prisma.estimate.findMany({
        where: { tenantId, deletedAt: null, number: { endsWith: digits, mode: 'insensitive' } },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select,
      });
      const only = candidates.length === 1 ? candidates[0] : undefined;
      if (only) est = only;
      else if (candidates.length > 1) {
        return { error: `Several estimates match "${ref}" (${candidates.map((c) => c.number).join(', ')}) — tell me the full estimate number.` };
      }
    }
  }
  if (!est) return { error: `No estimate found matching "${ref}". Give a number like EST-000021.` };
  return est;
}

/// Find a purchase order by number (exact, or lenient — "22" / "po-22"
/// matches PO-000022) or by vendor name, for the assistant to describe
/// AND for the frontend to open the PO page right away. Read-only.
export async function getPurchaseOrder(
  me: { tenantId: string },
  args: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      purchaseOrderId: string;
      number: string;
      url: string;
      status: string;
      vendor: string | null;
      notes: string | null;
      qboPoNumber: string | null;
      estimateNumber: string | null;
      subtotalCents: number;
      subtotal: string;
      lineCount: number;
      lines: Array<{ description: string; qty: number; unit: string; unitCost: string; total: string; vendor: string | null }>;
      updatedAt: string;
    }
  | { error: string; candidates?: Array<{ number: string; status: string; vendor: string | null; subtotal: string }> }
> {
  const ref = String(args.reference ?? args.number ?? args.po ?? '').trim();
  if (!ref) return { error: 'Which purchase order? Give a PO number like PO-000022.' };

  const detailSelect = {
    id: true,
    number: true,
    status: true,
    notes: true,
    qboPoNumber: true,
    subtotalCents: true,
    updatedAt: true,
    vendor: { select: { name: true } },
    estimate: { select: { number: true } },
    lines: {
      orderBy: [{ sortOrder: 'asc' as const }],
      select: { description: true, qtyMilli: true, unit: true, unitCostCents: true, computedCostCents: true, vendor: { select: { name: true } } },
    },
  };

  let po = await prisma.purchaseOrder.findFirst({
    where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { number: { equals: ref, mode: 'insensitive' } }] },
    select: detailSelect,
  });

  if (!po) {
    const padded = padNumberDigits(ref);
    if (padded) {
      po = await prisma.purchaseOrder.findFirst({
        where: { tenantId: me.tenantId, deletedAt: null, number: { equals: `PO-${padded}`, mode: 'insensitive' } },
        select: detailSelect,
      });
    }
  }

  if (!po) {
    const digits = ref.replace(/\D/g, '');
    const orClauses: Array<Record<string, unknown>> = [];
    if (digits.length >= 2) orClauses.push({ number: { endsWith: digits, mode: 'insensitive' } });
    if (ref.length >= 2) orClauses.push({ vendor: { name: { contains: ref, mode: 'insensitive' } } });
    const candidates =
      orClauses.length > 0
        ? await prisma.purchaseOrder.findMany({
            where: { tenantId: me.tenantId, deletedAt: null, OR: orClauses },
            orderBy: { updatedAt: 'desc' },
            take: 6,
            select: { number: true, status: true, subtotalCents: true, vendor: { select: { name: true } } },
          })
        : [];
    const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined;
    if (onlyCandidate) {
      po = await prisma.purchaseOrder.findFirst({
        where: { tenantId: me.tenantId, deletedAt: null, number: onlyCandidate.number },
        select: detailSelect,
      });
    } else if (candidates.length > 1) {
      return {
        error: `Found ${candidates.length} purchase orders matching "${ref}" — tell me which one (by full number).`,
        candidates: candidates.map((c) => ({
          number: c.number,
          status: c.status,
          vendor: c.vendor?.name ?? null,
          subtotal: `$${(c.subtotalCents / 100).toFixed(2)}`,
        })),
      };
    }
  }

  if (!po) return { error: `No purchase order found matching "${ref}".` };

  return {
    ok: true,
    purchaseOrderId: po.id,
    number: po.number,
    url: `/purchase-orders/${po.id}`,
    status: po.status,
    vendor: po.vendor?.name ?? null,
    notes: po.notes,
    qboPoNumber: po.qboPoNumber,
    estimateNumber: po.estimate?.number ?? null,
    subtotalCents: po.subtotalCents,
    subtotal: `$${(po.subtotalCents / 100).toFixed(2)}`,
    lineCount: po.lines.length,
    lines: po.lines.map((l) => ({
      description: l.description,
      qty: l.qtyMilli / 1000,
      unit: l.unit,
      unitCost: `$${(l.unitCostCents / 100).toFixed(2)}`,
      total: `$${(l.computedCostCents / 100).toFixed(2)}`,
      vendor: l.vendor?.name ?? null,
    })),
    updatedAt: po.updatedAt.toISOString(),
  };
}

/// Find an estimate by number (exact, or lenient — "21" matches
/// EST-000021), customer name, or title, for the assistant to describe
/// AND for the frontend to open the estimate right away. Read-only.
export async function getEstimate(
  me: { tenantId: string },
  args: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      estimateId: string;
      number: string;
      url: string;
      title: string;
      status: string;
      customer: string | null;
      markupPercent: number;
      finalPriceCents: number;
      total: string;
      lineCount: number;
      lines: Array<{ line: number; description: string; qty: number; unitCost: string; total: string; kind: string; markupExempt: boolean }>;
      updatedAt: string;
    }
  | { error: string; candidates?: Array<{ number: string; title: string; status: string; total: string }> }
> {
  const ref = String(args.reference ?? args.estimate ?? args.number ?? '').trim();
  if (!ref) return { error: 'Which estimate? Give a number like EST-000021.' };

  const detailSelect = {
    id: true,
    number: true,
    title: true,
    status: true,
    multiplierMilli: true,
    finalPriceCents: true,
    updatedAt: true,
    client: { select: { companyName: true } },
    lines: {
      orderBy: [{ sortOrder: 'asc' as const }],
      select: { description: true, qtyMilli: true, unitCostCents: true, computedCostCents: true, kind: true, markupExempt: true },
    },
  };

  let est = await prisma.estimate.findFirst({
    where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { number: { equals: ref, mode: 'insensitive' } }] },
    select: detailSelect,
  });

  if (!est) {
    const padded = padNumberDigits(ref);
    if (padded) {
      est = await prisma.estimate.findFirst({
        where: { tenantId: me.tenantId, deletedAt: null, number: { equals: `EST-${padded}`, mode: 'insensitive' } },
        select: detailSelect,
      });
    }
  }

  if (!est) {
    const digits = ref.replace(/\D/g, '');
    const orClauses: Array<Record<string, unknown>> = [];
    if (digits.length >= 2) orClauses.push({ number: { endsWith: digits, mode: 'insensitive' } });
    if (ref.length >= 2) {
      orClauses.push({ title: { contains: ref, mode: 'insensitive' } });
      orClauses.push({ client: { companyName: { contains: ref, mode: 'insensitive' } } });
    }
    const candidates =
      orClauses.length > 0
        ? await prisma.estimate.findMany({
            where: { tenantId: me.tenantId, deletedAt: null, OR: orClauses },
            orderBy: { updatedAt: 'desc' },
            take: 6,
            select: { number: true, title: true, status: true, finalPriceCents: true },
          })
        : [];
    const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined;
    if (onlyCandidate) {
      est = await prisma.estimate.findFirst({
        where: { tenantId: me.tenantId, deletedAt: null, number: onlyCandidate.number },
        select: detailSelect,
      });
    } else if (candidates.length > 1) {
      return {
        error: `Found ${candidates.length} estimates matching "${ref}" — tell me which one (by full number).`,
        candidates: candidates.map((c) => ({
          number: c.number,
          title: c.title,
          status: c.status,
          total: `$${(c.finalPriceCents / 100).toFixed(2)}`,
        })),
      };
    }
  }

  if (!est) return { error: `No estimate found matching "${ref}".` };

  return {
    ok: true,
    estimateId: est.id,
    number: est.number,
    url: `/estimates/${est.id}`,
    title: est.title,
    status: est.status,
    customer: est.client?.companyName ?? null,
    markupPercent: Math.round((est.multiplierMilli / 1000 - 1) * 100),
    finalPriceCents: est.finalPriceCents,
    total: `$${(est.finalPriceCents / 100).toFixed(2)}`,
    lineCount: est.lines.length,
    lines: est.lines.map((l, i) => ({
      line: i + 1,
      description: l.description,
      qty: l.qtyMilli / 1000,
      unitCost: `$${(l.unitCostCents / 100).toFixed(2)}`,
      total: `$${(l.computedCostCents / 100).toFixed(2)}`,
      kind: l.kind,
      markupExempt: l.markupExempt,
    })),
    updatedAt: est.updatedAt.toISOString(),
  };
}

/* --------------------- delete (approval-gated) --------------------- */

/// Resolve the record the operator wants to delete and build a PendingAction
/// for approval. Does NOT delete anything.
export async function prepareDelete(
  me: { tenantId: string },
  entity: RecyclableEntity,
  ref: string,
): Promise<PendingAction | { error: string }> {
  const trimmed = ref.trim();
  if (!trimmed) return { error: 'Which record should I delete? Give a name or number.' };

  let recordId: string | null = null;
  let label = '';

  if (entity === 'estimate') {
    const r = await prisma.estimate.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, number: true, title: true },
    });
    if (r) { recordId = r.id; label = `${r.number} — ${r.title}`; }
  } else if (entity === 'customer') {
    const r = await prisma.client.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { companyName: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, companyName: true },
    });
    if (r) { recordId = r.id; label = r.companyName; }
  } else if (entity === 'vendor') {
    const r = await prisma.vendor.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { name: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    });
    if (r) { recordId = r.id; label = r.name; }
  } else if (entity === 'purchase_order') {
    const r = await prisma.purchaseOrder.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, number: true },
    });
    if (r) { recordId = r.id; label = r.number; }
  } else if (entity === 'catalog_item') {
    const r = await prisma.shopMaterialItem.findFirst({
      where: { tenantId: me.tenantId, isActive: true, OR: [{ id: trimmed }, { name: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    });
    if (r) { recordId = r.id; label = r.name; }
  }

  if (!recordId) return { error: `No ${ENTITY_LABEL[entity].toLowerCase()} found matching "${trimmed}".` };

  return {
    token: newToken(),
    kind: 'delete',
    entity,
    recordId,
    label: `${ENTITY_LABEL[entity]} ${label}`,
    detail: `Moves to the Recycle Bin — recoverable for ${RECYCLE_RETENTION_DAYS} days.`,
    question: 'Approve delete?',
    confirmLabel: 'Approve delete',
  };
}

/* ------------------- create / edit (immediate) ------------------- */

export async function createCustomer(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const companyName = String(args.companyName ?? args.name ?? '').trim().slice(0, 200);
  if (!companyName) return { error: 'A company/customer name is required.' };
  const created = await prisma.client.create({
    data: {
      tenantId: me.tenantId,
      companyName,
      contactName: String(args.contactName ?? '').trim().slice(0, 200) || null,
      email: String(args.email ?? '').trim().slice(0, 200) || null,
      phone: String(args.phone ?? '').trim().slice(0, 60) || null,
    },
    select: { id: true, companyName: true },
  });
  await writeAuditLog({ action: 'client_created', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: created.id, metadata: { via: 'ai_assistant', name: created.companyName } });
  return { ok: true, id: created.id, name: created.companyName };
}

export async function createVendor(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const name = String(args.name ?? '').trim().slice(0, 200);
  if (!name) return { error: 'A vendor name is required.' };
  const existing = await prisma.vendor.findFirst({ where: { tenantId: me.tenantId, name: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
  if (existing) return { error: `A vendor named "${name}" already exists.` };
  const created = await prisma.vendor.create({
    data: {
      tenantId: me.tenantId,
      name,
      email: String(args.email ?? '').trim().slice(0, 200) || null,
      phone: String(args.phone ?? '').trim().slice(0, 60) || null,
    },
    select: { id: true, name: true },
  });
  await writeAuditLog({ action: 'vendor_created', userId: me.id, tenantId: me.tenantId, targetType: 'vendor', targetId: created.id, metadata: { via: 'ai_assistant', name: created.name } });
  return { ok: true, id: created.id, name: created.name };
}

export async function updateCustomer(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const ref = String(args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which customer? Give their name.' };
  const rec = await prisma.client.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { companyName: { equals: ref, mode: 'insensitive' } }] }, select: { id: true } });
  if (!rec) return { error: `No customer found matching "${ref}".` };
  const data: Record<string, string> = {};
  if (args.newName != null && String(args.newName).trim()) data.companyName = String(args.newName).trim().slice(0, 200);
  if (args.contactName != null) data.contactName = String(args.contactName).trim().slice(0, 200);
  if (args.email != null) data.email = String(args.email).trim().slice(0, 200);
  if (args.phone != null) data.phone = String(args.phone).trim().slice(0, 60);
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (name, contact, email, phone).' };
  const updated = await prisma.client.update({ where: { id: rec.id }, data, select: { companyName: true } });
  await writeAuditLog({ action: 'client_updated', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, name: updated.companyName };
}

export async function updateVendor(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const ref = String(args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which vendor? Give their name.' };
  const rec = await prisma.vendor.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { name: { equals: ref, mode: 'insensitive' } }] }, select: { id: true } });
  if (!rec) return { error: `No vendor found matching "${ref}".` };
  const data: Record<string, string> = {};
  if (args.newName != null && String(args.newName).trim()) data.name = String(args.newName).trim().slice(0, 200);
  if (args.email != null) data.email = String(args.email).trim().slice(0, 200);
  if (args.phone != null) data.phone = String(args.phone).trim().slice(0, 60);
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (name, email, phone).' };
  const updated = await prisma.vendor.update({ where: { id: rec.id }, data, select: { name: true } });
  await writeAuditLog({ action: 'vendor_updated', userId: me.id, tenantId: me.tenantId, targetType: 'vendor', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, name: updated.name };
}

export async function updateCatalogItem(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const ref = String(args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which catalog item? Give its name.' };
  const rec = await prisma.shopMaterialItem.findFirst({ where: { tenantId: me.tenantId, isActive: true, OR: [{ id: ref }, { name: { equals: ref, mode: 'insensitive' } }] }, select: { id: true } });
  if (!rec) return { error: `No catalog item found matching "${ref}".` };
  const data: Record<string, unknown> = {};
  if (args.newName != null && String(args.newName).trim()) {
    data.name = String(args.newName).trim().slice(0, 400);
    data.nameNormalized = normalizeVendorItemName(String(args.newName));
  }
  if (args.internalCostCents != null) data.internalCostCents = Math.max(0, Math.round(Number(args.internalCostCents) || 0));
  if (args.markupPercent != null) data.markupPercentMilli = Math.max(0, Math.round((Number(args.markupPercent) || 0) * 1000));
  if (args.category != null && String(args.category).trim()) data.categories = [String(args.category).trim().slice(0, 120)];
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (name, cost, markup, category).' };
  const updated = await prisma.shopMaterialItem.update({ where: { id: rec.id }, data, select: { name: true } });
  await writeAuditLog({ action: 'shop_material_item_saved', userId: me.id, tenantId: me.tenantId, targetType: 'shop_material_item', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, name: updated.name };
}

export async function updateEstimate(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; number: string } | { error: string }> {
  const ref = String(args.estimate ?? args.reference ?? args.id ?? '').trim();
  const rec = await resolveEstimateRef(me.tenantId, ref);
  if ('error' in rec) return rec;
  if (rec.status === EstimateStatus.FINALIZED) return { error: `${rec.number} is finalized and locked.` };
  const data: Record<string, unknown> = {};
  if (args.title != null && String(args.title).trim()) data.title = String(args.title).trim().slice(0, 200);
  if (args.markupPercent != null) data.multiplierMilli = Math.round((1 + (Number(args.markupPercent) || 0) / 100) * 1000);
  if (args.customerName != null && String(args.customerName).trim()) {
    const name = String(args.customerName).trim().slice(0, 200);
    let client = await prisma.client.findFirst({ where: { tenantId: me.tenantId, companyName: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
    if (!client) client = await prisma.client.create({ data: { tenantId: me.tenantId, companyName: name }, select: { id: true } });
    data.clientId = client.id;
  }
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (title, markup %, customer).' };
  await prisma.estimate.update({ where: { id: rec.id }, data });
  await writeAuditLog({ action: 'estimate_saved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, number: rec.number };
}

/// Edit a purchase order's notes, PO-level vendor, or QuickBooks PO
/// number — reversible, so it runs immediately. (Status and lines are
/// separate tools: set_purchase_order_status / add_purchase_order_line.)
export async function updatePurchaseOrder(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; number: string } | { error: string }> {
  const ref = String(args.reference ?? args.purchaseOrder ?? args.id ?? '').trim();
  const rec = await resolvePurchaseOrderRef(me.tenantId, ref);
  if ('error' in rec) return rec;

  const data: Record<string, unknown> = {};
  if (args.notes != null) data.notes = String(args.notes).trim().slice(0, 2000) || null;
  if (args.qboPoNumber != null) data.qboPoNumber = String(args.qboPoNumber).trim().slice(0, 100) || null;
  if (args.vendorName != null && String(args.vendorName).trim()) {
    const name = String(args.vendorName).trim().slice(0, 200);
    let vendor = await prisma.vendor.findFirst({ where: { tenantId: me.tenantId, name: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
    if (!vendor) vendor = await prisma.vendor.create({ data: { tenantId: me.tenantId, name }, select: { id: true } });
    data.vendorId = vendor.id;
  }
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (notes, vendor, QBO number).' };

  await prisma.purchaseOrder.update({ where: { id: rec.id }, data });
  await writeAuditLog({ action: 'po_saved', userId: me.id, tenantId: me.tenantId, targetType: 'purchase_order', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, number: rec.number };
}

/// Append a line to an existing purchase order (by number or id).
/// Reversible (the operator can remove it in the PO editor), so it runs
/// immediately — mirrors add_estimate_line. Links to the shop catalog by
/// exact material name, same as create_purchase_order, so vendor +
/// pricing context show up on the PO.
export async function addPurchaseOrderLine(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; purchaseOrderId: string; number: string } | { error: string }> {
  const ref = String(args.purchaseOrder ?? args.reference ?? args.number ?? '').trim();
  const po = await resolvePurchaseOrderRef(me.tenantId, ref);
  if ('error' in po) return po;

  const description = String(args.description ?? '').trim().slice(0, 400);
  if (!description) return { error: 'The line needs a description.' };
  const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(args.kind))
    ? String(args.kind)
    : 'MATERIAL') as POLineKind;
  const unit = (['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'].includes(String(args.unit))
    ? String(args.unit)
    : 'EACH') as ShopCatalogUnit;
  const qtyMilli = Math.max(1, Math.round((Number(args.qty) || 1) * 1000));
  const unitCostCents = Math.max(0, Math.round(Number(args.unitCostCents) || 0));
  const computedCostCents = Math.round((unitCostCents * qtyMilli) / 1000);

  const materialName = String(args.materialName ?? '').trim().slice(0, 400);
  const catalog =
    kind === POLineKind.MATERIAL && materialName
      ? await prisma.shopMaterialItem.findFirst({
          where: {
            tenantId: me.tenantId,
            isActive: true,
            OR: [{ sheetKey: sheetItemKey(materialName) }, { name: { equals: materialName, mode: 'insensitive' } }],
          },
          select: { id: true, preferredVendorId: true, selectedVendorId: true },
        })
      : null;

  const vendorNameArg = String(args.vendorName ?? '').trim().slice(0, 200);
  let vendorId: string | null = null;
  if (vendorNameArg) {
    let vendor = await prisma.vendor.findFirst({ where: { tenantId: me.tenantId, name: { equals: vendorNameArg, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
    if (!vendor) vendor = await prisma.vendor.create({ data: { tenantId: me.tenantId, name: vendorNameArg }, select: { id: true } });
    vendorId = vendor.id;
  } else {
    vendorId = catalog?.preferredVendorId ?? catalog?.selectedVendorId ?? po.vendorId ?? null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.pOLineItem.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: po.id,
        sortOrder: po.lineCount,
        kind,
        description,
        qtyMilli,
        unitCostCents,
        computedCostCents,
        catalogItemId: catalog?.id ?? null,
        vendorId,
        unit,
      },
    });
    // Atomic increment, not read-then-write — safe even if another save
    // races this one (e.g. the operator editing the PO in another tab).
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { subtotalCents: { increment: computedCostCents } } });
    if (vendorId) {
      await tx.purchaseOrderVendor.upsert({
        where: { purchaseOrderId_vendorId: { purchaseOrderId: po.id, vendorId } },
        create: { tenantId: me.tenantId, purchaseOrderId: po.id, vendorId },
        update: {},
      });
    }
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: po.id,
        kind: POEventKind.LINES_SAVED,
        message: `Assistant added line: ${description}`,
        metadata: { via: 'ai_assistant', description, computedCostCents },
        actorId: me.id,
      },
    });
  });

  await writeAuditLog({ action: 'po_saved', userId: me.id, tenantId: me.tenantId, targetType: 'purchase_order', targetId: po.id, metadata: { via: 'ai_assistant', addedLine: description } });
  return { ok: true, purchaseOrderId: po.id, number: po.number };
}

/* ------------- approval-gated: estimate status change ------------- */

const STATUS_QUESTION: Record<string, string> = {
  APPROVED: 'Approve this estimate?',
  SENT: 'Mark this estimate as sent?',
  REJECTED: 'Mark this estimate rejected?',
  DRAFT: 'Move this estimate back to draft?',
};

export async function prepareStatusChange(
  me: { tenantId: string },
  ref: string,
  targetStatus: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED',
): Promise<PendingAction | { error: string }> {
  const rec = await resolveEstimateRef(me.tenantId, ref);
  if ('error' in rec) return rec;
  if (rec.status === EstimateStatus.FINALIZED) return { error: `${rec.number} is finalized and locked.` };
  const meta = await prisma.estimate.findUnique({ where: { id: rec.id }, select: { title: true } });
  return {
    token: newToken(),
    kind: 'set_estimate_status',
    recordId: rec.id,
    targetStatus,
    label: meta?.title ? `${rec.number} — ${meta.title}` : rec.number,
    detail: `Status will change to ${targetStatus}.`,
    question: STATUS_QUESTION[targetStatus] ?? 'Approve this change?',
    confirmLabel: 'Approve',
  };
}

/* -------------- approval-gated: PO status change -------------- */

const PO_STATUS_QUESTION: Record<string, string> = {
  DRAFT: 'Move this PO back to draft?',
  ORDERED: 'Mark this PO as ordered?',
  PARTIALLY_RECEIVED: 'Mark this PO as partially received?',
  RECEIVED: 'Mark this PO as received?',
  CANCELED: 'Cancel this PO?',
};

/// Resolve the PO and build a PendingAction for a status change approval.
/// Deliberately does NOT accept 'SENT' — that only happens for real when
/// the operator presses "Send PO" themselves, which emails the vendor.
export async function preparePoStatusChange(
  me: { tenantId: string },
  ref: string,
  targetStatus: string,
): Promise<PendingAction | { error: string }> {
  const trimmed = ref.trim();
  if (!trimmed) return { error: 'Which purchase order? Give its number.' };
  if (!Object.prototype.hasOwnProperty.call(PO_STATUS_QUESTION, targetStatus)) {
    return { error: 'That status change has to go through the PO page — e.g. "Send PO" (emails the vendor) on the Purchase Orders page.' };
  }
  const rec = await resolvePurchaseOrderRef(me.tenantId, ref);
  if ('error' in rec) return rec;
  if (rec.status === targetStatus) return { error: `${rec.number} is already ${targetStatus}.` };
  return {
    token: newToken(),
    kind: 'set_po_status',
    recordId: rec.id,
    targetStatus: targetStatus as PendingAction['targetStatus'],
    label: rec.number,
    detail: `Status will change to ${targetStatus}.`,
    question: PO_STATUS_QUESTION[targetStatus] ?? 'Approve this change?',
    confirmLabel: 'Approve',
  };
}

/// Execute a delete the operator approved. Soft delete only (recoverable).
export async function executeConfirmedAction(
  me: { id: string; tenantId: string },
  action: PendingAction,
): Promise<{ ok: true; label: string } | { error: string }> {
  if (action.kind === 'set_estimate_status') {
    const target = action.targetStatus;
    if (!target) return { error: 'No target status.' };
    const r = await prisma.estimate.updateMany({
      where: { id: action.recordId, tenantId: me.tenantId, deletedAt: null, status: { not: EstimateStatus.FINALIZED } },
      data: { status: target as EstimateStatus },
    });
    if (r.count === 0) return { error: 'That estimate can no longer change status.' };
    await writeAuditLog({ action: 'estimate_status_changed', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: action.recordId, metadata: { via: 'ai_assistant', status: target } });
    return { ok: true, label: action.label };
  }

  if (action.kind === 'set_po_status') {
    const target = action.targetStatus;
    if (!target) return { error: 'No target status.' };
    const r = await prisma.purchaseOrder.updateMany({
      where: { id: action.recordId, tenantId: me.tenantId, deletedAt: null },
      data: { status: target as POStatus },
    });
    if (r.count === 0) return { error: 'That purchase order no longer exists.' };
    await writeAuditLog({ action: 'po_status_changed', userId: me.id, tenantId: me.tenantId, targetType: 'purchase_order', targetId: action.recordId, metadata: { via: 'ai_assistant', status: target } });
    return { ok: true, label: action.label };
  }

  if (action.kind !== 'delete') return { error: 'Unsupported action.' };
  const { entity, recordId } = action;
  if (!entity) return { error: 'No entity to delete.' };
  const now = new Date();

  // Every branch re-checks tenant ownership — the confirm request is a
  // separate call, so never trust the client-supplied id blindly.
  if (entity === 'estimate') {
    const r = await prisma.estimate.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That estimate no longer exists.' };
    await writeAuditLog({ action: 'estimate_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'customer') {
    const r = await prisma.client.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That customer no longer exists.' };
    await writeAuditLog({ action: 'clients_bulk_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'vendor') {
    const r = await prisma.vendor.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That vendor no longer exists.' };
    await writeAuditLog({ action: 'vendors_bulk_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'vendor', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'purchase_order') {
    const r = await prisma.purchaseOrder.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That purchase order no longer exists.' };
    await writeAuditLog({ action: 'po_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'purchase_order', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'catalog_item') {
    const r = await prisma.shopMaterialItem.updateMany({ where: { id: recordId, tenantId: me.tenantId, isActive: true }, data: { isActive: false } });
    if (r.count === 0) return { error: 'That catalog item no longer exists.' };
    await writeAuditLog({ action: 'shop_material_items_bulk_deactivated', userId: me.id, tenantId: me.tenantId, targetType: 'shop_material_item', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else {
    return { error: 'Unsupported entity.' };
  }

  return { ok: true, label: action.label };
}
